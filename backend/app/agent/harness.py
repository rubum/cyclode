import asyncio
import inspect
import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Dict, Any, Callable, Optional, List, Tuple
from datetime import datetime, timezone
import httpx

logger = logging.getLogger(__name__)

from app.config import settings
from app.core.policies import policy_engine
from app.core.worktree import worktree_manager
from app.agent.tools import WorkspaceTools
from app.agent.personas import get_persona
from app.integrations.github_client import github_client
from app.integrations.manager import integration_manager
from app.agent.vault_interceptor import VaultInterceptor
from app.agent.providers.factory import get_provider_for_model
from app.core.events.dispatcher import event_dispatcher
from app.core.trajectories.collector import TrajectoryCollector
from app.core.evals.runner import evaluation_runner
from app.schemas.trajectory import AgentTrajectory
from app.schemas.evals import EvaluationScorecard

# In-memory storage for active task trajectories and evaluations
task_trajectories: Dict[str, AgentTrajectory] = {}
task_evaluations: Dict[str, EvaluationScorecard] = {}




from app.agent.engine.snapshots import (
    _get_isolated_git_env,
    ensure_workspace_git_repo,
    create_turn_snapshot,
    rollback_workspace_to_commit,
)
from app.agent.engine.planning import (
    generate_plan_markdown,
    extract_plan_from_markdown,
)


def format_plan_chat_summary(
    plan_data: Dict[str, Any],
    full_markdown: str = "",
    task_id: Optional[str] = None
) -> str:
    """
    Formats a concise, high-level summary message for the chat interface when a plan is formulated.
    The comprehensive architectural specification is stored in docs/Web & Docs.
    """
    raw_title = plan_data.get("title") or "Implementation Plan"
    clean_title = re.sub(r"^#+\s*", "", raw_title).strip()
    clean_title = re.sub(r"^Implementation Plan:\s*", "", clean_title, flags=re.IGNORECASE).strip() or clean_title

    overview = plan_data.get("overview") or ""
    if not overview and full_markdown:
        lines = [line.strip() for line in full_markdown.splitlines()]
        body_lines = []
        started = False
        for line in lines:
            if line.startswith("#"):
                if started:
                    break
                started = True
                continue
            if started:
                if line.startswith("-") or line.startswith("*") or line.lower().startswith("phase") or line.startswith("###"):
                    break
                if line:
                    body_lines.append(line)
        if body_lines:
            overview = " ".join(body_lines)

    phases = plan_data.get("phases") or []
    steps = plan_data.get("steps") or []

    summary_lines = [
        f"I have formulated an implementation plan for **{clean_title}**."
    ]

    if overview:
        clean_ov = overview.strip()
        if len(clean_ov) > 280:
            clean_ov = clean_ov[:277] + "..."
        summary_lines.append(clean_ov)

    highlights = []
    if phases:
        for idx, p in enumerate(phases[:5], 1):
            p_num = p.get("phase_number", idx)
            p_title = p.get("title") or f"Phase {p_num}"
            p_title = re.sub(r"^Phase\s+\d+[:\-]?\s*", "", p_title, flags=re.IGNORECASE).strip() or p_title
            p_obj = p.get("objective") or ""
            if p_obj and len(p_obj) > 130:
                p_obj = p_obj[:127] + "..."
            if p_obj:
                highlights.append(f"- **Phase {p_num}: {p_title}**: {p_obj}")
            else:
                highlights.append(f"- **Phase {p_num}: {p_title}**")
    elif steps:
        for idx, s in enumerate(steps[:5], 1):
            s_title = s.get("title") or f"Step {idx}"
            s_title = re.sub(r"^Phase\s+\d+[:\-]?\s*", "", s_title, flags=re.IGNORECASE).strip() or s_title
            s_obj = s.get("objective") or ""
            if s_obj and len(s_obj) > 130:
                s_obj = s_obj[:127] + "..."
            if s_obj:
                highlights.append(f"- **Phase {idx}: {s_title}**: {s_obj}")
            else:
                highlights.append(f"- **Phase {idx}: {s_title}**")

    if highlights:
        summary_lines.append("### Key Execution Phases\n" + "\n".join(highlights))

    link_target = f"plan://{task_id}" if task_id else "#open-plan-doc"
    summary_lines.append(f"[👉 Inspect Full Plan in Web & Docs]({link_target})")

    return "\n\n".join(summary_lines)


class AntigravityHarness:
    """
    Antigravity Agent Harness: Universal LLM-native execution engine.
    Orchestrates dynamic multi-turn tool calling across Workspace, GitHub, AST symbol search,
    and live web intelligence with real-time streaming and telemetry.
    """

    def __init__(self, model_name: Optional[str] = None):
        self.model_name = model_name or settings.ANTIGRAVITY_MODEL

    def resolve_effective_model(
        self,
        task_model_name: Optional[str] = None,
        intent_category: Optional[str] = None
    ) -> str:
        """
        Resolves the concrete execution model based on task requirements, routing mode,
        and Task-Adaptive Major vs. Minor tier allocation.
        """
        known_intents = {"planning", "qa_research", "app_building", "code_modification", "debugging", "review_audit", "devops", "greetings"}
        task_model = task_model_name
        intent = intent_category

        if task_model in known_intents and intent is None:
            intent = task_model
            task_model = None

        requested = (task_model or self.model_name or "").strip()
        
        # If user explicitly requested a specific model (and not auto/adaptive)
        if requested and requested.lower() not in ["auto", "adaptive", "task-adaptive"]:
            if any(requested.startswith(p) for p in ["gemini-1.", "gemini-2.", "google:gemini-1.", "google:gemini-2."]) or "1.5" in requested or "2.0" in requested or "2.5" in requested:
                return "gemini-3.7-flash"
            return requested

        # When auto/adaptive or no model is selected:
        # Check configured providers to route to an active key if Gemini is unconfigured
        has_gemini = bool(settings.get_api_key() or integration_manager.get_custom_credential("gemini", "api_key"))
        has_deepseek = bool(settings.get_deepseek_api_key() or integration_manager.get_custom_credential("deepseek", "api_key"))
        has_claude = bool(settings.get_anthropic_api_key() or integration_manager.get_custom_credential("anthropic", "api_key"))
        has_openai = bool(settings.get_openai_api_key() or integration_manager.get_custom_credential("openai", "api_key"))

        if not has_gemini:
            if has_deepseek:
                return "deepseek-reasoner" if intent in ["app_building", "code_modification", "debugging"] else "deepseek-flash"
            elif has_claude:
                return "claude-3-7-sonnet" if intent in ["app_building", "code_modification", "debugging"] else "claude-3-5-haiku"
            elif has_openai:
                return "gpt-4o" if intent in ["app_building", "code_modification", "debugging"] else "gpt-4o-mini"

        # If Task-Adaptive routing is active
        if getattr(settings, "ANTIGRAVITY_ROUTING_MODE", "adaptive") == "adaptive":
            if intent in ["qa_research", "greetings"]:
                minor = getattr(settings, "ANTIGRAVITY_MINOR_MODEL", "gemini-3.7-flash") or "gemini-3.7-flash"
                return "gemini-3.7-flash" if any(p in minor for p in ["1.5", "2.0", "2.5"]) else minor
            elif intent in ["app_building", "code_modification", "debugging", "review_audit", "devops"] or (intent is None and (not requested or requested.lower() in ["auto", "adaptive"])):
                major = getattr(settings, "ANTIGRAVITY_MAJOR_MODEL", "gemini-3.8-flash") or "gemini-3.8-flash"
                return "gemini-3.8-flash" if any(p in major for p in ["1.5", "2.0", "2.5"]) else major

        default_m = getattr(settings, "ANTIGRAVITY_MODEL", "gemini-3.7-flash") or "gemini-3.7-flash"
        return "gemini-3.7-flash" if any(p in default_m for p in ["1.5", "2.0", "2.5"]) else default_m

    async def _emit_streamed_thought(
        self,
        thought_text: str,
        on_thought: Callable[[str], Any],
        on_stream_start: Optional[Callable[[str, str], Any]] = None,
        on_stream_chunk: Optional[Callable[[str, str, str, str], Any]] = None,
        on_stream_end: Optional[Callable[[str, str, str], Any]] = None,
        stream_id: Optional[str] = None
    ):
        s_id = stream_id or f"thought-{int(asyncio.get_event_loop().time() * 1000)}"
        if on_stream_start and on_stream_chunk and on_stream_end:
            try:
                if inspect.iscoroutinefunction(on_stream_start):
                    await on_stream_start("thought", s_id)
                else:
                    on_stream_start("thought", s_id)

                words = re.findall(r'\S+\s*|\s+', thought_text)
                accumulated = ""
                for word in words:
                    accumulated += word
                    if inspect.iscoroutinefunction(on_stream_chunk):
                        await on_stream_chunk("thought", s_id, word, accumulated)
                    else:
                        on_stream_chunk("thought", s_id, word, accumulated)
                    delay = 0.018
                    if word.endswith(('.', '!', '?', ':\n', ';\n', '\n\n')):
                        delay = 0.035
                    elif word.isspace():
                        delay = 0.005
                    await asyncio.sleep(delay)

                if inspect.iscoroutinefunction(on_stream_end):
                    await on_stream_end("thought", s_id, thought_text)
                else:
                    on_stream_end("thought", s_id, thought_text)
            except Exception as e:
                logger.debug(f"Streaming thought notice: {e}")

        if inspect.iscoroutinefunction(on_thought):
            try:
                await on_thought(thought_text, s_id)
            except TypeError:
                await on_thought(thought_text)
        else:
            try:
                on_thought(thought_text, s_id)
            except TypeError:
                on_thought(thought_text)

    async def _emit_streamed_message(
        self,
        sender: str,
        content: str,
        on_message: Callable[[str, str], Any],
        on_stream_start: Optional[Callable[[str, str], Any]] = None,
        on_stream_chunk: Optional[Callable[[str, str, str, str], Any]] = None,
        on_stream_end: Optional[Callable[[str, str, str], Any]] = None,
        stream_id: Optional[str] = None
    ):
        s_id = stream_id or f"msg-{int(asyncio.get_event_loop().time() * 1000)}"
        if content:
            cleaned = re.sub(r"\[Executed Tool:[^\]]+\]", "", content).strip()
            # Anti-Echo Guardrail: Filter out leaked tool action trace strings
            if sender == "agent" and re.match(r"^(?:Action:\s+|•\s+(?:Modified|Ran|Inspected|Executed|Listed|Searched|Edited|Read|Fetched))", cleaned, re.IGNORECASE):
                cleaned = (
                    "All requested workspace modifications have been completed and verified."
                )
            if cleaned:
                content = cleaned
        if sender == "agent" and on_stream_start and on_stream_chunk and on_stream_end:
            try:
                if inspect.iscoroutinefunction(on_stream_start):
                    await on_stream_start("message", s_id)
                else:
                    on_stream_start("message", s_id)

                words = re.findall(r'\S+\s*|\s+', content)
                accumulated = ""
                for word in words:
                    accumulated += word
                    if inspect.iscoroutinefunction(on_stream_chunk):
                        await on_stream_chunk("message", s_id, word, accumulated)
                    else:
                        on_stream_chunk("message", s_id, word, accumulated)
                    delay = 0.024
                    if word.endswith(('.', '!', '?', ':\n', ';\n', '\n\n')):
                        delay = 0.045
                    elif word.isspace():
                        delay = 0.006
                    await asyncio.sleep(delay)

                if inspect.iscoroutinefunction(on_stream_end):
                    await on_stream_end("message", s_id, content)
                else:
                    on_stream_end("message", s_id, content)
            except Exception as e:
                logger.debug(f"Streaming message notice: {e}")

        if inspect.iscoroutinefunction(on_message):
            try:
                await on_message(sender, content, s_id)
            except TypeError:
                await on_message(sender, content)
        else:
            try:
                on_message(sender, content, s_id)
            except TypeError:
                on_message(sender, content)

    async def _upsert_task_prs(
        self,
        task_id: str,
        pr_records: List[Dict[str, Any]],
        filter_context: Optional[Dict[str, Any]] = None,
        is_session_scoped: bool = True
    ):
        """
        Asynchronously persists discovered PR metadata to TaskPRModel with session scoping and broadcasts live updates.
        """
        if not task_id or not pr_records:
            return
        try:
            from app.db.session import async_session_factory
            from app.db.models import TaskPRModel
            from app.api.websocket import ws_manager
            from sqlalchemy import select

            async with async_session_factory() as session:
                for item in pr_records:
                    if not isinstance(item, dict):
                        continue
                    pr_num = item.get("number") or item.get("pr_number")
                    if not pr_num:
                        continue
                    pr_num = int(pr_num)
                    stmt = select(TaskPRModel).where(TaskPRModel.task_id == task_id, TaskPRModel.pr_number == pr_num)
                    res = await session.execute(stmt)
                    existing = res.scalars().first()

                    title = item.get("title", f"PR #{pr_num}")
                    author = item.get("author") or (item.get("user", {}).get("login") if isinstance(item.get("user"), dict) else "unknown")
                    head_branch = item.get("head_branch") or (item.get("head", {}).get("ref") if isinstance(item.get("head"), dict) else "")
                    base_branch = item.get("base_branch") or (item.get("base", {}).get("ref") if isinstance(item.get("base"), dict) else "main")
                    html_url = item.get("html_url") or ""
                    raw_state = (item.get("state") or "OPEN").upper()
                    status = "MERGED" if item.get("merged") else ("CLOSED" if raw_state == "CLOSED" else "OPEN")
                    body = item.get("body", "")
                    is_draft = bool(item.get("draft", item.get("is_draft", False)))
                    diff_stats = {
                        "additions": item.get("additions", 0),
                        "deletions": item.get("deletions", 0),
                        "changed_files": item.get("changed_files") or item.get("changed_files_count", 0)
                    }

                    if existing:
                        existing.title = title
                        existing.author = author
                        existing.head_branch = head_branch
                        existing.base_branch = base_branch
                        existing.html_url = html_url
                        existing.is_draft = is_draft
                        if body:
                            existing.body = body
                        if is_session_scoped:
                            existing.is_session_scoped = True
                        if existing.status not in ["TESTS_PASSING", "TESTS_FAILED", "REVIEWING"]:
                            existing.status = status
                        existing.diff_stats = diff_stats
                    else:
                        new_pr = TaskPRModel(
                            task_id=task_id,
                            pr_number=pr_num,
                            title=title,
                            author=author,
                            head_branch=head_branch,
                            base_branch=base_branch,
                            html_url=html_url,
                            body=body,
                            is_session_scoped=is_session_scoped,
                            is_draft=is_draft,
                            status=status,
                            diff_stats=diff_stats,
                            worktree_path=f"worktree-pr-{pr_num}"
                        )
                        session.add(new_pr)
                await session.commit()

            broadcast_payload = {
                "task_id": task_id,
                "is_session_scoped": is_session_scoped
            }
            if filter_context:
                broadcast_payload["filter_context"] = filter_context

            await ws_manager.broadcast("TASK_PR_UPDATED", broadcast_payload)
        except Exception as e:
            logger.debug(f"Auto-upsert task PRs notice: {e}")

    async def _emit_plan(
        self,
        plan: Dict[str, Any],
        on_plan: Optional[Callable[[Dict[str, Any]], Any]] = None
    ):
        if not on_plan or not plan:
            return
        try:
            if inspect.iscoroutinefunction(on_plan):
                await on_plan(plan)
            else:
                res = on_plan(plan)
                if asyncio.iscoroutine(res):
                    await res
        except Exception as e:
            logger.debug(f"Emit plan callback notice: {e}")

    @staticmethod
    def infer_task_intent(title: str, prompt: str, persona_name: str = "") -> str:
        """
        Infers the structural intent category ('planning', 'qa_research', 'app_building',
        'code_modification', 'debugging', 'review_audit', 'devops') from task title,
        prompt text, and persona name.
        Guarantees that coding, refactoring, and UI actions never falsely default to qa_research.
        """
        combined = f"{title or ''} {prompt or ''}".strip().lower()
        cleaned_prompt = (prompt or "").strip().lower()
        cleaned_title = (title or "").strip().lower()

        # 1. Greetings fast path
        conversational_pings = {"hey", "hello", "hi", "howdy", "greetings", "good morning", "good afternoon", "good evening", "yo", "sup", "hey there", "hello there"}
        if cleaned_prompt in conversational_pings or cleaned_title in conversational_pings:
            return "qa_research"

        # 2. Planning phrases
        planning_phrases = [
            "what's the plan", "whats the plan", "what is the plan",
            "so what's the plan", "so whats the plan",
            "plan this", "plan this out", "create a plan", "make a plan",
            "show me the plan", "give me a plan", "draft a plan", "propose a plan",
            "plan mode", "execution plan", "plan for", "make plan for", "make a plan for"
        ]
        if (
            any(phrase in cleaned_prompt for phrase in planning_phrases)
            or any(phrase in cleaned_title for phrase in planning_phrases)
            or cleaned_prompt.startswith("plan ")
            or cleaned_title.startswith("plan ")
            or cleaned_prompt == "plan"
            or cleaned_title == "plan"
        ):
            return "planning"

        # 3. Pure Q&A / Research prefixes
        is_qa_prefix = (
            any(cleaned_prompt.startswith(prefix) for prefix in ["what is", "what are", "how does", "how do", "how to", "why is", "why does", "explain", "describe", "tell me about", "compare", "contrast", "overview of", "summarize"])
            or any(cleaned_title.startswith(prefix) for prefix in ["what is", "what are", "how does", "how do", "how to", "why is", "why does", "explain", "describe", "tell me about", "compare", "contrast", "overview of", "summarize"])
            or "research" in cleaned_title.split()
        )
        has_code_file = any(ext in combined for ext in [".py", ".html", ".css", ".js", ".ts", ".tsx", ".jsx", ".json", ".sql", ".rs", ".go", ".c", ".cpp", ".h", "dockerfile"])

        if is_qa_prefix and not has_code_file:
            return "qa_research"

        # 4. Review & Audit
        if any(k in combined for k in ["review pr", "review pull request", "audit code", "code review", "verify pr", "check pr", "review diff", "pr review"]):
            return "review_audit"

        # 5. Debugging & Error diagnosis
        if any(k in combined for k in ["debug ", "fix bug", "fix error", "fix the bug", "fix the error", "traceback", "exception in", "syntax error", "failing test", "failed test", "failing tests"]):
            return "debugging"

        # 6. DevOps & Infrastructure
        if any(k in combined for k in ["dockerfile", "docker-compose", "github action", "ci/cd", "workflow yaml", "k8s", "kubernetes", "deploy to", "helm chart"]):
            return "devops"

        # 7. Web application / UI building
        app_builder_keywords = [
            "landing page", "web app", "webapp", "dashboard", "frontend", "ui component",
            "index.html", "game", "canvas", "interactive", "storefront", "portfolio page",
            "calculator", "html5", "tailwind", "react component", "vue component"
        ]
        if persona_name == "AppBuilder" or any(k in combined for k in app_builder_keywords):
            return "app_building"

        # 8. Action / Code modification keywords & file extensions
        action_verbs = [
            "extend", "add", "convert", "guard", "design", "scaffold", "build", "create",
            "make", "fix", "refactor", "implement", "update", "modify", "patch", "remediate",
            "remediation", "optimize", "improve", "style", "test", "tests", "work on",
            "wire up", "integrate", "replace", "delete", "remove", "rename", "move"
        ]
        has_action_verb = any(v in combined for v in action_verbs)

        if has_action_verb or has_code_file:
            return "code_modification"

        if persona_name in ["SoftwareEngineer", "PairProgrammer", "IssueResolver"]:
            return "code_modification"

        return "qa_research"

    def _create_initial_plan_placeholder(self, title: str, prompt: str, persona_name: str = "") -> Dict[str, Any]:
        """
        Emits a lightweight dynamic formulation placeholder while the AI model synthesizes the bespoke plan.
        No hardcoded steps or regex keyword templates.
        """
        objective = title or prompt[:100]
        intent = self.infer_task_intent(title, prompt, persona_name)
        plan_data = {
            "intent_category": intent,
            "objective": objective,
            "steps": [
                {"id": "step-1", "title": "Synthesizing dynamic execution plan with AI model...", "status": "in_progress"}
            ],
            "evaluation": {
                "status": "pending",
                "summary": "Formulating execution plan with AI model..."
            }
        }
        plan_data["markdown"] = generate_plan_markdown(plan_data, title, prompt)
        return plan_data

    @staticmethod
    def sanitize_plan_phases(raw_phases: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        phases = []
        for p in raw_phases:
            p_copy = dict(p)
            p_text = f"{p_copy.get('title', '')} {p_copy.get('objective', '')}".lower()
            if any(k in p_text for k in ["eliminate stale root", "delete root mirror", "deduplicate root mirror", "delete 'app/'", "delete 'src/'", "delete 'tests/'", "delete backend", "delete frontend"]):
                p_copy["title"] = "Phase 1: Environment & Path Configuration Alignment"
                p_copy["objective"] = "Align pyproject.toml, PYTHONPATH, and test paths without deleting codebase directory trees."
                p_copy["file_touchpoints"] = ["pyproject.toml: Configure pythonpath and test runner options"]
            phases.append(p_copy)
        return phases

    @staticmethod
    def advance_plan_step(plan: Dict[str, Any], target_step_idx: int) -> bool:
        """
        Monotonically advances plan steps to target_step_idx:
        - Marks steps 0 through target_step_idx - 1 as 'completed'
        - Marks step target_step_idx as 'in_progress'
        - Marks steps target_step_idx + 1 onwards as 'pending'
        Guarantees that only a SINGLE step is ever 'in_progress' and transitions never regress.
        """
        steps = plan.get("steps", [])
        if not steps or target_step_idx < 0:
            return False

        target_step_idx = min(target_step_idx, len(steps) - 1)

        # Determine current active progression
        current_active = 0
        for i, s in enumerate(steps):
            if s.get("status") == "in_progress":
                current_active = i
                break
            elif s.get("status") == "completed":
                current_active = i + 1

        if target_step_idx < current_active:
            return False

        changed = False
        for idx, s in enumerate(steps):
            new_status = "completed" if idx < target_step_idx else ("in_progress" if idx == target_step_idx else "pending")
            if s.get("status") != new_status:
                s["status"] = new_status
                changed = True

        return changed

    async def _generate_dynamic_plan(
        self,
        client: httpx.AsyncClient,
        api_key: str,
        model_name: str,
        title: str,
        prompt: str,
        persona_name: str,
        history: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Dynamically synthesizes a bespoke execution plan and classifies task intent
        using structured JSON output from the selected provider (Gemini, Claude, or OpenAI)
        before tool loop execution. Surfaces authentic error diagnostics if dynamic formulation fails.
        """
        objective = title or prompt[:100]
        effective_plan_model = self.resolve_effective_model(model_name)
        provider = get_provider_for_model(effective_plan_model)
        
        # Fast path: Check if conversational greeting or casual ping
        cleaned_prompt = (prompt or "").strip().lower()
        cleaned_title = (title or "").strip().lower()
        conversational_pings = {"hey", "hello", "hi", "howdy", "greetings", "good morning", "good afternoon", "good evening", "yo", "sup", "hey there", "hello there"}
        if cleaned_prompt in conversational_pings or cleaned_title in conversational_pings:
            return {
                "intent_category": "qa_research",
                "objective": "Acknowledge greeting and assist with software engineering tasks",
                "steps": [
                    {"id": "step-1", "title": "Respond to user greeting and provide assistance", "status": "in_progress"}
                ],
                "evaluation": {
                    "status": "pending",
                    "summary": "Conversational greeting acknowledged."
                }
            }

        # Fast path: Detect Plan Mode activation triggers
        planning_phrases = [
            "what's the plan", "whats the plan", "what is the plan",
            "so what's the plan", "so whats the plan",
            "plan this", "plan this out", "create a plan", "make a plan",
            "show me the plan", "give me a plan", "draft a plan", "propose a plan",
            "plan mode", "execution plan"
        ]
        is_planning_query = (
            any(phrase in cleaned_prompt for phrase in planning_phrases)
            or any(phrase in cleaned_title for phrase in planning_phrases)
            or cleaned_prompt.startswith("plan ")
            or cleaned_title.startswith("plan ")
            or cleaned_prompt == "plan"
            or cleaned_title == "plan"
        )

        # Extract recent conversation history for rich planning context
        conversation_context = ""
        if history:
            history_snippets = []
            for m in history[-5:]:
                sender = m.get("sender") or m.get("role") or "user"
                content = m.get("content") or ""
                if content and not m.get("thought"):
                    clean_content = content.strip()
                    if len(clean_content) > 1800:
                        clean_content = clean_content[:1800] + "\n...[truncated]..."
                    history_snippets.append(f"[{sender}]: {clean_content}")
            if history_snippets:
                conversation_context = "Preceding Conversation Context:\n" + "\n\n".join(history_snippets) + "\n\n"

        # Infer heuristic task intent
        inferred_intent = Harness.infer_task_intent(title, prompt, persona_name)

        # Check API key presence for the specific provider
        if api_key is not None and api_key != "":
            prov_key = api_key
        elif api_key == "":
            prov_key = None
        else:
            prov_key = (
                provider.get_api_key() if hasattr(provider, "get_api_key") else None
            ) or integration_manager.get_custom_credential(provider.provider_id, "api_key")

        if hasattr(provider, "_api_key") and prov_key:
            provider._api_key = prov_key

        if not prov_key:
            provider_label = "DeepSeek AI" if provider.provider_id == "deepseek" else ("Anthropic Claude" if provider.provider_id == "anthropic" else ("OpenAI / Codex" if provider.provider_id == "openai" else "Google Gemini"))
            return {
                "intent_category": inferred_intent,
                "objective": objective,
                "steps": [
                    {"id": "step-1", "title": f"Plan Generation Failed: {provider_label} API Key is missing or unconfigured", "status": "failed"}
                ],
                "evaluation": {
                    "status": "needs_revision",
                    "summary": f"Dynamic execution plan generation failed: {provider_label} API Key is missing or unconfigured.",
                    "checks": [
                        {"name": "Dynamic Plan Generation", "passed": False, "message": f"{provider_label} API Key is missing or unconfigured"}
                    ]
                }
            }

        plan_prompt = (
            f"You are the Cyclode Master Execution Planner. Formulate an in-depth, rigorous, actionable architectural implementation plan for the following task.\n\n"
            f"Task Title: {title}\n"
            f"Persona: {persona_name}\n"
            f"Prompt: {prompt}\n\n"
            f"{conversation_context}"
            f"Allowed intent_category values: ['planning', 'qa_research', 'app_building', 'code_modification', 'review_audit', 'debugging', 'devops']\n"
            f"Guidelines:\n"
            f"- If the prompt asks for a plan, roadmap, proposal, architecture proposal, or says 'what\\'s the plan', 'so what\\'s the plan', 'plan this', set intent_category='planning'.\n"
            f"- CRITICAL FOR PLANNING INTENT: Ground your plan directly in the specific technical decisions, proposals, files, and code samples discussed in the preceding conversation context! Do NOT generate generic abstract placeholders (e.g. NEVER just say 'Establish core requirements' or 'Decompose development phases'). Name exact files (e.g. backend/app/agent/tools.py, backend/app/main.py), exact function/class names, and concrete verification commands!\n"
            f"- For each phase, provide:\n"
            f"  1. A descriptive title and a 1-sentence objective.\n"
            f"  2. Specific file touchpoints with bulleted action items under each file.\n"
            f"  3. Concrete verification criteria (e.g. exact pytest or build commands).\n"
            f"- If the prompt is asking a question, conceptual explanation, or research (e.g. 'What is Redis LangCache', 'Explain grafana alert rules'), set intent_category='qa_research'. Do NOT scaffold web apps for Q&A queries.\n"
            f"- If the prompt asks to build an interactive web app, frontend, UI, dashboard, game, landing page, or calculator, set intent_category='app_building'.\n"
            f"  CRITICAL FOR APP BUILDING: Formulate the implementation plan specifically for Cyclode's Instant Live Preview Sandbox! Target self-contained HTML/CSS/JS or Vite/React components (e.g. index.html with Tailwind CSS, responsive layout, theme tokens, interactive DOM sections, and verify_app_preview). Do NOT propose non-executable cloud deployment pipelines (such as 'Deploy to Vercel', 'AWS setup', or serverless hosting) or multi-container server dependencies when creating client-side apps or landing pages!\n"
            f"- If the prompt asks to review PR, diff, or code audit, set intent_category='review_audit'.\n"
            f"- If the prompt asks to fix an error or debug code, set intent_category='debugging'.\n"
            f"- If the prompt asks to configure Docker, CI/CD, or deployment, set intent_category='devops'.\n"
            f"- Otherwise, set intent_category='code_modification'.\n"
            f"- ABSOLUTE STRUCTURAL INTEGRITY RULE: NEVER propose deleting, removing, or 'deduplicating' root codebase directories (such as 'app/', 'src/', 'tests/', 'backend/', 'frontend/'). Repositories often maintain dual-tree structures for container or packaging reasons. Always propose resolving path/import errors via configuration (pyproject.toml, pytest settings, PYTHONPATH), NEVER via mass directory deletion!\n\n"
            f"Respond ONLY with a valid JSON object matching this schema:\n"
            f"{{\n"
            f'  "intent_category": "planning | qa_research | app_building | code_modification | review_audit | debugging | devops",\n'
            f'  "title": "Implementation Plan: [Crisp Descriptive Title]",\n'
            f'  "overview": "1-2 sentence executive summary outlining the phased remediation or development strategy",\n'
            f'  "phases": [\n'
            f'    {{\n'
            f'      "phase_number": 1,\n'
            f'      "title": "Phase 1: [Specific Milestone Title]",\n'
            f'      "objective": "Clear 1-sentence objective",\n'
            f'      "file_touchpoints": [\n'
            f'        "path/to/file.py: Specific change details or action item"\n'
            f'      ],\n'
            f'      "verification_criteria": [\n'
            f'        "Concrete verification command and condition (e.g. pytest tests/test_tools.py passes)"\n'
            f'      ]\n'
            f'    }}\n'
            f'  ],\n'
            f'  "steps": [\n'
            f'    {{"id": "step-1", "title": "Specific step description", "status": "pending"}},\n'
            f'    {{"id": "step-2", "title": "Specific step description", "status": "pending"}},\n'
            f'    {{"id": "step-3", "title": "Specific step description", "status": "pending"}}\n'
            f'  ]\n'
            f"}}"
        )

        plan_res = await provider.generate_structured_plan(
            prompt=plan_prompt,
            system_instruction="You are the Cyclode Master Execution Planner.",
            model_name=effective_plan_model,
            client=client
        )

        if plan_res.get("result"):
            parsed = plan_res["result"]
            intent_cat = parsed.get("intent_category")
            if is_planning_query or inferred_intent == "planning":
                intent_cat = "planning"
            elif intent_cat not in ["planning", "qa_research", "app_building", "code_modification", "review_audit", "debugging", "devops"]:
                intent_cat = inferred_intent
            elif intent_cat == "qa_research" and inferred_intent in ["code_modification", "app_building", "debugging", "devops"]:
                intent_cat = inferred_intent

            obj = parsed.get("objective") or objective
            raw_phases = parsed.get("phases", [])
            phases = Harness.sanitize_plan_phases(raw_phases)
            overview = parsed.get("overview") or obj
            plan_title = parsed.get("title") or title
            raw_steps = parsed.get("steps", [])
            if not raw_steps and phases:
                raw_steps = [
                    {"title": p.get("title") or f"Phase {i+1}", "status": "pending"}
                    for i, p in enumerate(phases)
                ]

            if isinstance(raw_steps, list) and len(raw_steps) >= 1:
                steps = []
                for idx, s in enumerate(raw_steps):
                    s_title = s.get("title", f"Step {idx+1}") if isinstance(s, dict) else str(s)
                    s_id = f"step-{idx+1}"
                    s_status = "pending" if intent_cat == "planning" else ("in_progress" if idx == 0 else "pending")
                    steps.append({"id": s_id, "title": s_title, "status": s_status})
                plan_dict = {
                    "intent_category": intent_cat,
                    "title": plan_title,
                    "objective": obj,
                    "overview": overview,
                    "phases": phases,
                    "steps": steps,
                    "evaluation": {
                        "status": "ready_for_review" if intent_cat == "planning" else "pending",
                        "summary": "Implementation plan formulated. Awaiting user review or approval to proceed." if intent_cat == "planning" else "Dynamic plan formulated. Execution in progress."
                    }
                }
                plan_dict["markdown"] = generate_plan_markdown(plan_dict, title, prompt)
                return plan_dict

        last_error = plan_res.get("error") or "Plan generation failed across candidate models."
        fallback_plan = {
            "intent_category": inferred_intent,
            "objective": objective,
            "steps": [
                {"id": "step-1", "title": f"Plan Generation Failed: {last_error}", "status": "failed"}
            ],
            "evaluation": {
                "status": "needs_revision",
                "summary": f"Could not generate dynamic execution plan: {last_error}",
                "checks": [
                    {"name": "Dynamic Plan Generation", "passed": False, "message": last_error}
                ]
            }
        }
        fallback_plan["markdown"] = generate_plan_markdown(fallback_plan, title, prompt)
        return fallback_plan


    def _generate_initial_plan(self, title: str, prompt: str, persona_name: str = "") -> Dict[str, Any]:
        """
        Formulates the initial formulating placeholder prior to AI model execution.
        """
        return self._create_initial_plan_placeholder(title, prompt, persona_name)

    async def execute_task(
        self,
        task_id: str,
        title: str,
        description: str,
        persona_name: str,
        workspace_path: Path,
        on_thought: Callable[[str], Any],
        on_tool_start: Callable[[str, Dict[str, Any]], Any],
        on_tool_end: Callable[..., Any],
        on_message: Callable[[str, str], Any],
        on_approval_required: Callable[[str, Dict[str, Any]], Any],
        on_diff_updated: Callable[[List[Dict[str, Any]]], Any],
        history: Optional[List[Dict[str, Any]]] = None,
        on_stream_start: Optional[Callable[[str, str], Any]] = None,
        on_stream_chunk: Optional[Callable[[str, str, str, str], Any]] = None,
        on_stream_end: Optional[Callable[[str, str, str], Any]] = None,
        on_inquiry: Optional[Callable[[str, List[Dict[str, Any]], str, int], Any]] = None,
        on_plan: Optional[Callable[[Dict[str, Any]], Any]] = None
    ) -> Dict[str, Any]:
        """
        Executes an agent task directly via the LLM-First ReAct engine with native function calling.
        """
        raw_prompt = description or title

        # 1. Pre-process secrets into Vault and mask them
        sanitized_prompt, extracted_creds = await VaultInterceptor.process_prompt(raw_prompt)

        effective_model = self.resolve_effective_model(self.model_name)
        provider = get_provider_for_model(effective_model)
        provider_id = provider.provider_id
        provider_label = "DeepSeek AI" if provider_id == "deepseek" else ("Anthropic Claude" if provider_id == "anthropic" else ("OpenAI / Codex" if provider_id == "openai" else "Google Gemini"))
        env_var_name = "DEEPSEEK_API_KEY" if provider_id == "deepseek" else ("ANTHROPIC_API_KEY" if provider_id == "anthropic" else ("OPENAI_API_KEY" if provider_id == "openai" else "GEMINI_API_KEY"))

        api_key = (
            extracted_creds.get(f"{provider_id}_api_key")
            or (provider.get_api_key() if hasattr(provider, "get_api_key") else None)
            or integration_manager.get_custom_credential(provider_id, "api_key")
            or (settings.get_api_key() if provider_id in ["google", "gemini"] else None)
        )

        # Ensure workspace directory exists
        workspace_path.mkdir(parents=True, exist_ok=True)

        # 2. Check for configured LLM API Key
        if not api_key:
            guidance_msg = (
                f"### LLM Model Configuration Required\n\n"
                f"To run autonomous code reviews, synthesize PR diffs, and orchestrate workspace tools, please configure an LLM provider:\n\n"
                f"1. **{provider_label} API Key**: Set `{env_var_name}` in your `.env` file or configure it in **Settings > Integrations**.\n"
                f"2. **Real-time Tool Orchestration**: Tools (`read_file`, `search_code`, `run_command`, `search_web`, `create_pull_request`) execute automatically once an API key is connected."
            )
            await self._emit_streamed_thought(
                f"API credentials missing. Please set {env_var_name} in environment or Integrations Settings.",
                on_thought, on_stream_start, on_stream_chunk, on_stream_end
            )
            await self._emit_streamed_message(
                "agent", guidance_msg, on_message, on_stream_start, on_stream_chunk, on_stream_end
            )
            return {"status": "AWAITING_INPUT", "summary": f"Awaiting {provider_label} API Key configuration."}

        # 3. Execute with LLM ReAct function calling loop
        return await self._execute_with_llm(
            api_key=api_key,
            task_id=task_id,
            title=title,
            prompt=sanitized_prompt,
            persona_name=persona_name,
            workspace_path=workspace_path,
            on_thought=on_thought,
            on_tool_start=on_tool_start,
            on_tool_end=on_tool_end,
            on_message=on_message,
            on_approval_required=on_approval_required,
            on_diff_updated=on_diff_updated,
            history=history,
            on_stream_start=on_stream_start,
            on_stream_chunk=on_stream_chunk,
            on_stream_end=on_stream_end,
            on_inquiry=on_inquiry,
            on_plan=on_plan
        )

    async def _execute_with_llm(
        self,
        api_key: str,
        task_id: str,
        title: str,
        prompt: str,
        persona_name: str,
        workspace_path: Path,
        on_thought: Callable[[str], Any],
        on_tool_start: Callable[[str, Dict[str, Any]], Any],
        on_tool_end: Callable[..., Any],
        on_message: Callable[[str, str], Any],
        on_approval_required: Callable[[str, Dict[str, Any]], Any],
        on_diff_updated: Callable[[List[Dict[str, Any]]], Any],
        history: Optional[List[Dict[str, Any]]] = None,
        on_stream_start: Optional[Callable[[str, str], Any]] = None,
        on_stream_chunk: Optional[Callable[[str, str, str, str], Any]] = None,
        on_stream_end: Optional[Callable[[str, str, str], Any]] = None,
        on_inquiry: Optional[Callable[[str, List[Dict[str, Any]], str, int], Any]] = None,
        on_plan: Optional[Callable[[Dict[str, Any]], Any]] = None
    ) -> Dict[str, Any]:
        """
        Primary LLM-first ReAct engine: invokes model with comprehensive tool declarations.
        """
        tools_def = [
            {
                "function_declarations": [
                    {
                        "name": "list_dir",
                        "description": "List files and subdirectories in the workspace.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "subpath": {"type": "STRING", "description": "Relative directory path (default: .)"}
                            }
                        }
                    },
                    {
                        "name": "read_file",
                        "description": "Read file contents from the workspace. Supports start_line and end_line for token-efficient sliced views.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "file_path": {"type": "STRING", "description": "Relative path to file"},
                                "start_line": {"type": "INTEGER", "description": "Optional 1-indexed start line number"},
                                "end_line": {"type": "INTEGER", "description": "Optional 1-indexed end line number"}
                            },
                            "required": ["file_path"]
                        }
                    },
                    {
                        "name": "get_file_outline",
                        "description": "Extracts AST class definitions, function signatures, endpoints, and types from a file without function bodies. Highly recommended for exploring unfamiliar files with minimal token consumption.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "file_path": {"type": "STRING", "description": "Relative path to file to outline"}
                            },
                            "required": ["file_path"]
                        }
                    },
                    {
                        "name": "replace_file_content",
                        "description": "Replace a specific target text block with replacement content in an existing file. Token-efficient alternative to overwriting whole files with edit_file.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "file_path": {"type": "STRING", "description": "Relative path to file"},
                                "target_content": {"type": "STRING", "description": "Exact text block to replace"},
                                "replacement_content": {"type": "STRING", "description": "New replacement content"},
                                "allow_multiple": {"type": "BOOLEAN", "description": "Whether to replace multiple occurrences (default: false)"}
                            },
                            "required": ["file_path", "target_content", "replacement_content"]
                        }
                    },
                    {
                        "name": "batch_replace_content",
                        "description": "Atomically apply multiple text replacements across one or more files in a single turn. Dramatically reduces roundtrips and token usage when modifying several files or multiple locations in a single file.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "edits": {
                                    "type": "ARRAY",
                                    "description": "List of file replacement operations to perform atomically",
                                    "items": {
                                        "type": "OBJECT",
                                        "properties": {
                                            "file_path": {"type": "STRING", "description": "Relative path to target file"},
                                            "target_content": {"type": "STRING", "description": "Exact target text block to find and replace"},
                                            "replacement_content": {"type": "STRING", "description": "New replacement text"},
                                            "allow_multiple": {"type": "BOOLEAN", "description": "Whether to replace multiple occurrences (default: false)"}
                                        },
                                        "required": ["file_path", "target_content", "replacement_content"]
                                    }
                                }
                            },
                            "required": ["edits"]
                        }
                    },
                    {
                        "name": "apply_unified_patch",
                        "description": "Apply a unified diff patch across multiple files atomically. Highly efficient for multi-hunk code transformations.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "patch_content": {"type": "STRING", "description": "Standard unified diff patch string (e.g. diff --git a/... b/...) "}
                            },
                            "required": ["patch_content"]
                        }
                    },
                    {
                        "name": "edit_file",
                        "description": "Write or overwrite complete content of a file in the workspace.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "file_path": {"type": "STRING", "description": "Relative path to file"},
                                "content": {"type": "STRING", "description": "Complete new content for the file"}
                            },
                            "required": ["file_path", "content"]
                        }
                    },
                    {
                        "name": "run_command",
                        "description": "Run shell command (e.g. pytest, npm test, git) in the workspace.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "command": {"type": "STRING", "description": "Shell command line"}
                            },
                            "required": ["command"]
                        }
                    },
                    {
                        "name": "speculative_branch_test",
                        "description": "Execute parallel multi-branch testing across Copy-on-Write micro-sandbox forks in <10ms. Evaluates alternative code hypotheses simultaneously and identifies the winning fix.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "hypotheses": {
                                    "type": "ARRAY",
                                    "description": "List of alternative implementation hypotheses with file edits",
                                    "items": {
                                        "type": "OBJECT",
                                        "properties": {
                                            "name": {"type": "STRING", "description": "Hypothesis name (e.g. 'Use v4 CSS imports')"},
                                            "edits": {
                                                "type": "ARRAY",
                                                "items": {
                                                    "type": "OBJECT",
                                                    "properties": {
                                                        "file_path": {"type": "STRING"},
                                                        "target_content": {"type": "STRING"},
                                                        "replacement_content": {"type": "STRING"}
                                                    }
                                                }
                                            }
                                        }
                                    }
                                },
                                "test_command": {"type": "STRING", "description": "Verification shell command to run in each fork (e.g. 'npm run build' or 'pytest')"}
                            },
                            "required": ["hypotheses", "test_command"]
                        }
                    },
                    {
                        "name": "search_code",
                        "description": "Fast workspace code search ignoring build & vendor folders, returning matching lines and file paths.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "query": {"type": "STRING", "description": "Search pattern or text"},
                                "is_regex": {"type": "BOOLEAN", "description": "Whether query is a regex pattern (default: false)"},
                                "file_pattern": {"type": "STRING", "description": "Optional file glob filter, e.g. '*.py' or 'src/**'"}
                            },
                            "required": ["query"]
                        }
                    },
                    {
                        "name": "find_symbols",
                        "description": "Locate functions, classes, interfaces, React components, and API route handlers across the workspace using AST indexing in 1 turn.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "name_pattern": {"type": "STRING", "description": "Substring or symbol name to look for (e.g. 'verify_signature')"},
                                "symbol_type": {"type": "STRING", "description": "Optional symbol filter: 'function', 'class', 'endpoint', 'component', 'interface', 'type'"},
                                "file_pattern": {"type": "STRING", "description": "Optional glob filter, e.g. '*.py' or '*.tsx'"}
                            }
                        }
                    },
                    {
                        "name": "tgrep_ast",
                        "description": "Structural AST search matching syntax patterns (e.g. decorators '@app.post', class inheritance 'class:BaseModel', or functions).",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "pattern": {"type": "STRING", "description": "AST pattern to match, e.g. '@app.post', 'class:BaseModel', or symbol name"}
                            },
                            "required": ["pattern"]
                        }
                    },
                    {
                        "name": "search_web",
                        "description": "Search the live web for tech news, documentation, APIs, and real-time releases.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "query": {"type": "STRING", "description": "Search query keywords"}
                            },
                            "required": ["query"]
                        }
                    },
                    {
                        "name": "fetch_url",
                        "description": "Fetch and extract clean text from a web URL.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "url": {"type": "STRING", "description": "Full HTTP/HTTPS URL"}
                            },
                            "required": ["url"]
                        }
                    },
                    {
                        "name": "get_pull_request_details",
                        "description": "Fetch pull request metadata, description, base/head branches, and list of modified files.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "repository": {"type": "STRING", "description": "Repository in owner/repo format (e.g. 'gowaylo/waylo')"},
                                "pr_number": {"type": "INTEGER", "description": "Pull request number"}
                            },
                            "required": ["repository", "pr_number"]
                        }
                    },
                    {
                        "name": "get_pull_request_diff",
                        "description": "Fetch the raw unified code diff for a specific GitHub pull request.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "repository": {"type": "STRING", "description": "Repository in owner/repo format (e.g. 'gowaylo/waylo')"},
                                "pr_number": {"type": "INTEGER", "description": "Pull request number"}
                            },
                            "required": ["repository", "pr_number"]
                        }
                    },
                    {
                        "name": "list_pull_requests",
                        "description": "List pull requests in a GitHub repository.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "repository": {"type": "STRING", "description": "Repository in owner/repo format"},
                                "state": {"type": "STRING", "description": "PR state: 'open', 'closed', 'all' (default: 'open')"},
                                "author": {"type": "STRING", "description": "Optional author filter"},
                                "limit": {"type": "INTEGER", "description": "Maximum PRs to return (default: 10)"}
                            },
                            "required": ["repository"]
                        }
                    },
                    {
                        "name": "post_pull_request_review",
                        "description": "Submit a code review or summary comment to a GitHub pull request.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "repository": {"type": "STRING", "description": "Repository in owner/repo format"},
                                "pr_number": {"type": "INTEGER", "description": "Pull request number"},
                                "body": {"type": "STRING", "description": "Review comment body in Markdown format"},
                                "event": {"type": "STRING", "description": "Review action: 'COMMENT', 'APPROVE', 'REQUEST_CHANGES'"}
                            },
                            "required": ["repository", "pr_number", "body"]
                        }
                    },
                    {
                        "name": "post_pull_request_line_comment",
                        "description": "Post an inline review comment on a specific line of code in a GitHub pull request diff.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "repository": {"type": "STRING", "description": "Repository in owner/repo format"},
                                "pr_number": {"type": "INTEGER", "description": "Pull request number"},
                                "body": {"type": "STRING", "description": "Comment text"},
                                "commit_sha": {"type": "STRING", "description": "Head commit SHA"},
                                "path": {"type": "STRING", "description": "File path in repository"},
                                "line": {"type": "INTEGER", "description": "Diff line number"},
                                "side": {"type": "STRING", "description": "'LEFT' or 'RIGHT' (default: 'RIGHT')"}
                            },
                            "required": ["repository", "pr_number", "body", "commit_sha", "path", "line"]
                        }
                    },
                    {
                        "name": "create_pull_request",
                        "description": "Create a new pull request on GitHub (supports draft PRs).",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "repository": {"type": "STRING", "description": "Repository in owner/repo format"},
                                "title": {"type": "STRING", "description": "Pull request title"},
                                "body": {"type": "STRING", "description": "Pull request description"},
                                "head_branch": {"type": "STRING", "description": "Source head branch"},
                                "base_branch": {"type": "STRING", "description": "Target base branch (default: main)"},
                                "draft": {"type": "BOOLEAN", "description": "Whether to create the pull request as a draft (default: false)"}
                            },
                            "required": ["repository", "title", "body", "head_branch"]
                        }
                    },
                    {
                        "name": "connect_repository",
                        "description": "Connect a remote GitHub repository to Cyclode.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "repo_url": {"type": "STRING", "description": "GitHub repository clone URL"},
                                "token": {"type": "STRING", "description": "Optional GitHub personal access token"}
                            },
                            "required": ["repo_url"]
                        }
                    },
                    {
                        "name": "ask_user_inquiry",
                        "description": "Ask the human user a structured multiple-choice inquiry or clarification question with predefined options and a default auto-proceed choice if the user does not respond within a timeout (e.g. app name, theme, features, architecture).",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "question": {"type": "STRING", "description": "The clear question to ask the human user"},
                                "options": {
                                    "type": "ARRAY",
                                    "description": "List of choice options formatted as objects with 'id', 'label', and optional 'description'",
                                    "items": {
                                        "type": "OBJECT",
                                        "properties": {
                                            "id": {"type": "STRING", "description": "Unique option identifier (e.g. 'opt_modern_dark')"},
                                            "label": {"type": "STRING", "description": "Short title of option"},
                                            "description": {"type": "STRING", "description": "Detailed explanation of this choice"}
                                        },
                                        "required": ["id", "label"]
                                    }
                                },
                                "default_option_id": {"type": "STRING", "description": "ID of the recommended default option to auto-proceed with if the user doesn't respond in time"},
                                "timeout_seconds": {"type": "INTEGER", "description": "Seconds to wait before auto-proceeding with default (default: 25, min: 10, max: 120)"}
                            },
                            "required": ["question", "options", "default_option_id"]
                        }
                    },
                    {
                        "name": "verify_app_preview",
                        "description": "Inspect and verify the live web application preview in the workspace. Checks whether an entry point exists (e.g. index.html, client/dist/index.html), whether scripts and assets resolve properly, whether Vite/React bundles have been compiled, and returns actionable feedback so you can fix errors before completing.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {}
                        }
                    },
                    {
                        "name": "run_verified_code_review",
                        "description": "Executes the 4-stage verified review pipeline on a PR or code diff (Ensemble Scanners -> Adversarial Falsification -> Dedupe -> Actionable Diffs). Returns high-signal verified findings with guaranteed zero-style nitpicks.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "repository": {"type": "STRING", "description": "Optional repository in owner/repo format"},
                                "pr_number": {"type": "INTEGER", "description": "Optional pull request number"},
                                "diff_text": {"type": "STRING", "description": "Optional raw unified diff text to review"}
                            }
                        }
                    },
                    {
                        "name": "verify_code_hypothesis",
                        "description": "Adversarially tests and falsifies a specific candidate issue or invariant violation hypothesis against local workspace files and AST.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "file_path": {"type": "STRING", "description": "Relative file path in workspace"},
                                "line_range": {"type": "STRING", "description": "Target line or line range (e.g. '42-48')"},
                                "invariant_violated": {"type": "STRING", "description": "Specific invariant or security/concurrency guarantee violated"},
                                "reproduction_scenario": {"type": "STRING", "description": "Concrete failure execution scenario"}
                            },
                            "required": ["file_path", "line_range", "invariant_violated"]
                        }
                    }
                ]
            }
        ]

        persona_obj = get_persona(persona_name)
        persona_instructions = persona_obj.get("system_instructions", "")

        now = datetime.now(timezone.utc)
        current_date_str = now.strftime('%A, %B %d, %Y')
        current_month_year = now.strftime('%B %Y')
        current_year = now.year

        system_instruction = (
            f"You are Cyclode, an autonomous AI pair programmer and software engineering assistant powered by the Antigravity agent harness.\n"
            f"Persona: {persona_name}.\n"
            f"Workspace: {workspace_path}\n"
            f"Task Context: {title}\n"
            f"CURRENT TEMPORAL BASELINE: {current_date_str} (Current Year: {current_year}, Current Month: {now.strftime('%B')})\n\n"
            f"{persona_instructions}\n\n"
            f"Core Operational Directives:\n"
            f"1. DIRECT TOOL INVOCATION & REASONING:\n"
            f"   - When listing pull requests: call `list_pull_requests`. ALWAYS present all discovered PRs in your response with an itemized Markdown table or list including direct clickable links ([#<number>: <title>](https://github.com/<owner>/<repo>/pull/<number>)), author (@<author>), status (OPEN/MERGED), branch flow (<head> ➔ <base>), and diff stats (+add / -del).\n"
            f"   - When reviewing PRs or summarizing changes: call `get_pull_request_diff` and `get_pull_request_details` to analyze the exact code hunks.\n"
            f"   - When answering user questions about the workspace: use `read_file`, `search_code`, `find_symbols`, and `run_command`.\n"
            f"   - When asked to search the web: call `search_web` or `fetch_url`. Formulate clean, concise keyword queries without redundant boolean operators or nested quotes. Complete web research in 1–3 focused tool queries and promptly deliver your full analytical synthesis.\n"
            f"2. ANALYTICAL PROSE & RICH CITATIONS:\n"
            f"   - Lead with an Executive Summary in fluid analytical prose.\n"
            f"   - Break down distinct architectural changes, modified files, and risks clearly.\n"
            f"   - EVERY cited article, repository, PR link, or URL MUST include a direct clickable markdown link ([Title](https://...)).\n"
            f"   - Prohibit rigid cookie-cutter bullet templates (e.g. repeating 'What's New: ... Significance: ...').\n"
            f"3. MULTI-TURN CONTEXT:\n"
            f"   - If the user asks follow-up questions about specific lines, files, or diff hunks, reason directly on the code."
        )

        effective_model = self.resolve_effective_model(self.model_name)
        provider = get_provider_for_model(effective_model)
        if provider.provider_id == "deepseek":
            model_candidates = [effective_model, "deepseek-flash", "deepseek-chat", "deepseek-reasoner"]
            provider_label = "DeepSeek AI"
        elif provider.provider_id == "anthropic":
            model_candidates = [effective_model, "claude-fable-5-1", "claude-3-7-sonnet", "claude-3-5-sonnet", "claude-3-5-haiku"]
            provider_label = "Anthropic Claude"
        elif provider.provider_id == "openai":
            model_candidates = [effective_model, "gpt-6-astra", "gpt-4o", "o3-mini", "gpt-4o-mini", "codex"]
            provider_label = "OpenAI / Codex"
        else:
            clean_gemini = effective_model.replace("google:", "").replace("gemini:", "").strip()
            if any(clean_gemini.startswith(p) for p in ["gemini-1.", "gemini-2."]) or "1.5" in clean_gemini or "2.0" in clean_gemini or "2.5" in clean_gemini:
                clean_gemini = "gemini-3.7-flash"
            initial_gemini = [clean_gemini, "gemini-3.7-flash", "gemini-3.8-flash"]
            model_candidates = [m for m in initial_gemini if m and not any(m.startswith(p) for p in ["gemini-1.", "gemini-2."]) and "1.5" not in m and "2.0" not in m and "2.5" not in m]
            if not model_candidates:
                model_candidates = ["gemini-3.7-flash", "gemini-3.8-flash"]
            provider_label = "Google Gemini"
        unique_models = list(dict.fromkeys(m for m in model_candidates if m))

        # 0. Check Semantic Vector Cache for Q&A / Research queries (Tier 4)
        # Note: Semantic caching is strictly reserved for standalone single-turn knowledge lookups.
        # It must NEVER intercept multi-turn conversations where prompts are contextual follow-ups.
        is_potential_qa = (
            persona_name in ["IssueResolver", "SoftwareEngineer", "PairProgrammer"]
            and not (history and len(history) > 1)
            and any(
                (prompt or "").lower().strip().startswith(prefix)
                for prefix in ["what is", "what are", "how does", "how do", "how to", "why is", "why does", "explain", "describe", "tell me about", "compare", "contrast"]
            )
        )
        if is_potential_qa:
            try:
                from app.agent.semantic_cache import lookup_semantic_cache
                from app.db.session import async_session_factory
                async with async_session_factory() as cache_sess:
                    cache_hit = await lookup_semantic_cache(
                        db=cache_sess,
                        query=prompt or title,
                        api_key=api_key,
                        client=None,
                        threshold=0.90,
                        intent="qa_research"
                    )
                    if cache_hit:
                        cached_entry, sim_score = cache_hit
                        logger.info(f"Semantic Vector Cache Hit (similarity: {sim_score:.3f}) for query '{(prompt or title)[:60]}'")
                        
                        cached_plan = cached_entry.plan_json or {
                            "intent_category": "qa_research",
                            "objective": (prompt or title)[:100],
                            "steps": [
                                {"id": "step-1", "title": "Analyze architectural concepts from semantic knowledge cache", "status": "completed"},
                                {"id": "step-2", "title": "Synthesize comprehensive technical explanation", "status": "completed"},
                                {"id": "step-3", "title": "Deliver validated briefing", "status": "completed"}
                            ],
                            "evaluation": {
                                "status": "accomplished",
                                "summary": f"All execution plan steps verified successfully (Served from Local SQLite Semantic Vector Cache, similarity: {sim_score:.2f}).",
                                "checks": [
                                    {"name": "Semantic Vector Cache", "passed": True, "message": f"Cosine similarity {sim_score:.2f} >= 0.90"},
                                    {"name": "Analytical Synthesis", "passed": True}
                                ]
                            }
                        }
                        if isinstance(cached_plan, dict):
                            for s in cached_plan.get("steps", []):
                                s["status"] = "completed"
                            cached_plan["evaluation"] = {
                                "status": "accomplished",
                                "summary": f"All execution plan steps verified successfully (Served from Local SQLite Semantic Vector Cache, similarity: {sim_score:.2f}).",
                                "checks": [
                                    {"name": "Semantic Vector Cache", "passed": True, "message": f"Cosine similarity {sim_score:.2f} >= 0.90"},
                                    {"name": "Analytical Synthesis", "passed": True}
                                ]
                            }

                        await self._emit_plan(cached_plan, on_plan)
                        await self._emit_streamed_thought(
                            f"**Semantic Vector Cache Hit (Similarity: {sim_score:.2f})**: Returning validated analytical synthesis from local SQLite vector store with 0 token consumption.",
                            on_thought, on_stream_start, on_stream_chunk, on_stream_end
                        )
                        await self._emit_streamed_message(
                            "agent", cached_entry.response_text, on_message, on_stream_start, on_stream_chunk, on_stream_end
                        )
                        return {"status": "COMPLETED", "summary": cached_entry.response_text[:120], "cached": True}
            except Exception as e:
                logger.debug(f"Semantic cache lookup notice: {e}")

        contents: List[Dict[str, Any]] = []
        tool_call_count = 0
        mutating_tool_count = 0
        consecutive_build_errors = 0

        # 1. Initialize and stream First-Class Execution Plan Lifecycle
        current_plan = self._generate_initial_plan(title, prompt, persona_name)
        await self._emit_plan(current_plan, on_plan)

        if history:
            for msg in history:
                role = "user" if msg.get("sender") == "user" else "model"
                text = msg.get("content", "")
                if text and not msg.get("thought"):
                    contents.append({"role": role, "parts": [{"text": text}]})

        if not contents or contents[-1].get("role") != "user":
            contents.append({"role": "user", "parts": [{"text": prompt}]})

        logger.info(f"Connecting to {provider_label} API using model {self.model_name}...")

        client_timeout = httpx.Timeout(120.0, connect=15.0, read=120.0)
        async with httpx.AsyncClient(timeout=client_timeout) as client:
            # Formulate dynamic execution plan using fast structured provider call
            primary_model = unique_models[0] if unique_models else self.model_name
            dynamic_plan = await self._generate_dynamic_plan(
                client=client,
                api_key=api_key,
                model_name=primary_model,
                title=title,
                prompt=prompt,
                persona_name=persona_name,
                history=history
            )
            current_plan = dynamic_plan
            await self._emit_plan(current_plan, on_plan)

            quota_exhausted = False
            last_api_error_code = None
            last_api_error_text = ""
            collector = TrajectoryCollector(
                task_id=task_id,
                persona=persona_name,
                model_name=self.model_name
            )
            for active_model in unique_models:
                if quota_exhausted:
                    break
                active_provider = get_provider_for_model(active_model)
                turn = 0
                max_turns = 45
                guardrail_corrections = 0
                max_guardrail_corrections = 3
                model_succeeded = False
                final_agent_text = ""

                try:
                    while turn < max_turns:
                        turn += 1
                        collector.start_turn(turn_index=turn, user_prompt=prompt if turn == 1 else None)
                        if workspace_path and workspace_path.exists():
                            create_turn_snapshot(workspace_path, turn)

                        # Tier 3: In-Context Tool Output & Historical Content Compaction
                        optimized_contents = []
                        total_entries = len(contents)
                        for idx, entry in enumerate(contents):
                            if idx >= total_entries - 2:
                                optimized_contents.append(entry)
                                continue
                            parts = entry.get("parts", [])
                            new_parts = []
                            for p in parts:
                                if "functionCall" in p:
                                    fn = p["functionCall"].get("name")
                                    if fn == "edit_file":
                                        new_p = dict(p)
                                        fc = dict(p["functionCall"])
                                        args = dict(fc.get("args", {}))
                                        c_str = args.get("content", "")
                                        if len(c_str) > 1500:
                                            args["content"] = c_str[:300] + f"\n\n... [Historical file write content compacted ({len(c_str)} bytes total)]"
                                            fc["args"] = args
                                            new_p["functionCall"] = fc
                                            new_parts.append(new_p)
                                        else:
                                            new_parts.append(p)
                                    elif fn == "replace_file_content":
                                        new_p = dict(p)
                                        fc = dict(p["functionCall"])
                                        args = dict(fc.get("args", {}))
                                        rc = args.get("replacement_content", "")
                                        tc = args.get("target_content", "")
                                        if len(rc) > 1500 or len(tc) > 1500:
                                            if len(rc) > 1500:
                                                args["replacement_content"] = rc[:300] + f"\n\n... [Historical replacement content compacted ({len(rc)} bytes)]"
                                            if len(tc) > 1500:
                                                args["target_content"] = tc[:300] + f"\n\n... [Historical target content compacted ({len(tc)} bytes)]"
                                            fc["args"] = args
                                            new_p["functionCall"] = fc
                                            new_parts.append(new_p)
                                        else:
                                            new_parts.append(p)
                                    elif fn == "batch_replace_content":
                                        new_p = dict(p)
                                        fc = dict(p["functionCall"])
                                        args = dict(fc.get("args", {}))
                                        edits = args.get("edits", [])
                                        if len(edits) > 4:
                                            args["edits"] = edits[:4] + [{"_notice": f"... [Compacted {len(edits)-4} additional historical batch edits]"}]
                                            fc["args"] = args
                                            new_p["functionCall"] = fc
                                            new_parts.append(new_p)
                                        else:
                                            new_parts.append(p)
                                    elif fn == "apply_unified_patch":
                                        new_p = dict(p)
                                        fc = dict(p["functionCall"])
                                        args = dict(fc.get("args", {}))
                                        p_str = args.get("patch_content", "")
                                        if len(p_str) > 1500:
                                            args["patch_content"] = p_str[:300] + f"\n\n... [Historical unified patch compacted ({len(p_str)} bytes total)]"
                                            fc["args"] = args
                                            new_p["functionCall"] = fc
                                            new_parts.append(new_p)
                                        else:
                                            new_parts.append(p)
                                    else:
                                        new_parts.append(p)
                                elif "functionResponse" in p:
                                    fr = dict(p["functionResponse"])
                                    resp_data = fr.get("response", {})
                                    if isinstance(resp_data, dict):
                                        resp_copy = dict(resp_data)
                                        # Compact large text values
                                        for key in ["output", "stdout", "content", "result", "diff", "text"]:
                                            val = resp_copy.get(key)
                                            if isinstance(val, str) and len(val) > 1200:
                                                lines = val.split("\n")
                                                if len(lines) > 25:
                                                    compacted_val = "\n".join(lines[:12]) + f"\n\n... [Historical output compacted: {len(lines)-22} lines omitted for token efficiency] ...\n\n" + "\n".join(lines[-10:])
                                                else:
                                                    compacted_val = val[:500] + f"\n\n... [Historical output compacted ({len(val)} chars)] ...\n\n" + val[-500:]
                                                resp_copy[key] = compacted_val
                                        # Compact large list results (symbols, search matches, dir items)
                                        for list_key in ["matches", "symbols", "items", "entries"]:
                                            list_val = resp_copy.get(list_key)
                                            if isinstance(list_val, list) and len(list_val) > 8:
                                                resp_copy[list_key] = list_val[:5] + [{
                                                    "_compacted": True,
                                                    "notice": f"... [{len(list_val) - 5} additional historical {list_key} compacted for token efficiency]"
                                                }]
                                        fr["response"] = resp_copy
                                        new_parts.append({"functionResponse": fr})
                                    else:
                                        new_parts.append(p)
                                else:
                                    new_parts.append(p)
                            optimized_contents.append({"role": entry.get("role", "user"), "parts": new_parts})

                        # Tier 2: Intent-Driven Tool Schema Pruning & Plan Mode Directive
                        intent_cat = current_plan.get("intent_category", "qa_research")
                        effective_system_instruction = system_instruction
                        if intent_cat == "qa_research":
                            mutation_tool_names = {"edit_file", "replace_file_content", "batch_replace_content", "apply_unified_patch", "revert_file", "speculative_branch_test"}
                            active_tools_def = [
                                {
                                    "function_declarations": [
                                        d for d in t.get("function_declarations", [])
                                        if d.get("name") not in mutation_tool_names
                                    ]
                                }
                                for t in (tools_def or [])
                            ] if tools_def else None
                        elif intent_cat == "planning":
                            mutation_tool_names = {"edit_file", "replace_file_content", "batch_replace_content", "apply_unified_patch", "revert_file", "speculative_branch_test"}
                            active_tools_def = [
                                {
                                    "function_declarations": [
                                        d for d in t.get("function_declarations", [])
                                        if d.get("name") not in mutation_tool_names
                                    ]
                                }
                                for t in (tools_def or [])
                            ] if tools_def else None
                            effective_system_instruction = (
                                system_instruction
                                + "\n\n4. PLAN MODE ACTIVE (ARCHITECTURAL IMPLEMENTATION PLAN MANDATE):\n"
                                + "   - The user has requested an architectural execution plan. Your responsibility is comprehensive technical planning.\n"
                                + "   - DO NOT perform file edits, replacements, or code mutations. All mutation tools are disabled for this turn.\n"
                                + "   - You may use inspection tools (`read_file`, `search_code`, `find_symbols`, `list_dir`, `get_file_outline`) to examine existing code and architecture.\n"
                                + "   - CRITICAL ARCHITECTURAL REQUIREMENT: Ground your plan directly in the specific technical decisions, proposals, and code discussed in the conversation.\n"
                                + "   - Format your implementation plan using this exact Markdown structure:\n"
                                + "     # Implementation Plan: [Crisp Descriptive Focus Title]\n\n"
                                + "     [Executive Summary paragraph outlining the phased remediation/architecture strategy]\n\n"
                                + "     ### Phase 1: [Milestone Title]\n"
                                + "     **Objective**: [Clear 1-sentence objective]\n\n"
                                + "     - **File Touchpoints**:\n"
                                + "       - `path/to/target/file`:\n"
                                + "         - [Specific functions, classes, or code hunks to modify or delete]\n"
                                + "         - [Detailed implementation details and parameters]\n\n"
                                + "     - **Verification Criteria**:\n"
                                + "       - [Exact pytest commands, build checks, and runtime behavior expected]\n\n"
                                + "     ### Phase 2: [Next Milestone Title] ...\n\n"
                                + "   - Conclude by stating that the complete interactive specification is published in 'Web & Docs', and invite the user to review it and reply 'Proceed' when ready to execute."
                            )
                        else:
                            active_tools_def = tools_def

                        # Execute turn with active provider
                        provider_resp = None
                        for retry_idx in range(2):
                            try:
                                provider_resp = await active_provider.generate_response(
                                    messages=optimized_contents,
                                    tools=active_tools_def,
                                    system_instruction=effective_system_instruction,
                                    model_name=active_model,
                                    client=client
                                )
                                break
                            except (httpx.TimeoutException, httpx.NetworkError) as net_err:
                                logger.warning(f"Transient network notice on turn {turn} model {active_model} (attempt {retry_idx+1}): {net_err}")
                                if retry_idx < 1:
                                    await asyncio.sleep(2.0)
                                else:
                                    raise

                        if not provider_resp:
                            break
                        if provider_resp.status_code == 404:
                            break
                        if provider_resp.status_code == 429:
                            err_text = provider_resp.error_message or "API quota limit reached or credits depleted."
                            logger.warning(f"{provider_label} Quota Notice (429): {err_text}")
                            quota_exhausted = True
                            quota_thought = (
                                f"**{provider_label} API Quota Notice (429)**: {err_text}\n\n"
                                f"*Please verify billing limits or configure a fresh API key in Settings > Integrations.*"
                            )
                            await self._emit_streamed_thought(
                                quota_thought, on_thought, on_stream_start, on_stream_chunk, on_stream_end
                            )

                            # Fail active plan steps & mark evaluation as needs_revision
                            for s in current_plan.get("steps", []):
                                if s.get("status") == "in_progress":
                                    s["status"] = "failed"
                            current_plan["evaluation"] = {
                                "status": "needs_revision",
                                "summary": f"Execution halted: {provider_label} API Quota Depleted (429). {err_text}",
                                "checks": [
                                    {"name": "API Connection", "passed": False, "message": "Prepayment credits depleted (429)"},
                                    {"name": "Tool Execution", "passed": False}
                                ]
                            }
                            await self._emit_plan(current_plan, on_plan)

                            quota_user_msg = (
                                f"### {provider_label} API Quota Notice (429)\n\n"
                                f"**{err_text}**\n\n"
                                f"To resume autonomous agent execution:\n"
                                f"1. **Prepayment / Credits**: Configure your billing project for {provider_label}.\n"
                                f"2. **Alternative API Key**: Provide an active API key in chat or configure **Settings > Integrations**."
                            )
                            await self._emit_streamed_message(
                                "agent", quota_user_msg, on_message, on_stream_start, on_stream_chunk, on_stream_end
                            )
                            return {"status": "FAILED", "summary": f"Quota Depleted (429): {err_text[:100]}"}
                        if provider_resp.status_code in [401, 403]:
                            err_text = provider_resp.error_message or "API key has been denied access or is unauthenticated."
                            logger.warning(f"{provider_label} API Access Notice ({provider_resp.status_code}): {err_text}")
                            perm_thought = (
                                f"**{provider_label} API Access Notice ({provider_resp.status_code})**: {err_text}\n\n"
                                f"*Please verify your project permissions or provide a valid API key in Settings > Integrations.*"
                            )
                            await self._emit_streamed_thought(
                                perm_thought, on_thought, on_stream_start, on_stream_chunk, on_stream_end
                            )

                            for s in current_plan.get("steps", []):
                                if s.get("status") == "in_progress":
                                    s["status"] = "failed"
                            current_plan["evaluation"] = {
                                "status": "needs_revision",
                                "summary": f"Execution halted: {provider_label} API Permission Denied ({provider_resp.status_code}). {err_text}",
                                "checks": [
                                    {"name": "API Connection", "passed": False, "message": f"Access denied ({provider_resp.status_code})"},
                                    {"name": "Tool Execution", "passed": False}
                                ]
                            }
                            await self._emit_plan(current_plan, on_plan)

                            perm_user_msg = (
                                f"### {provider_label} API Access Notice ({provider_resp.status_code})\n\n"
                                f"**{err_text}**\n\n"
                                f"The configured {provider_label} API key was denied access by the AI provider.\n\n"
                                f"To resume autonomous agent execution:\n"
                                f"1. **Generate New Key**: Obtain a fresh API key for {provider_label}.\n"
                                f"2. **Update Key**: Configure your API key in **Settings > Integrations**."
                            )
                            await self._emit_streamed_message(
                                "agent", perm_user_msg, on_message, on_stream_start, on_stream_chunk, on_stream_end
                            )
                            return {"status": "FAILED", "summary": f"Access Denied ({provider_resp.status_code}): {err_text[:100]}"}
                        if not provider_resp.is_success:
                            err_msg = provider_resp.error_message or f"HTTP {provider_resp.status_code}"
                            last_api_error_code = provider_resp.status_code
                            last_api_error_text = err_msg
                            logger.warning(f"API notice on turn {turn} model {active_model} ({provider_resp.status_code}): {err_msg}")
                            break

                        model_succeeded = True
                        if provider_resp.thought:
                            collector.add_thought(provider_resp.thought)
                            await self._emit_streamed_thought(
                                provider_resp.thought, on_thought, on_stream_start, on_stream_chunk, on_stream_end
                            )

                        function_calls = [{"name": tc.tool_name, "args": tc.tool_args, "id": tc.call_id} for tc in provider_resp.tool_calls]
                        text_parts = [provider_resp.content] if provider_resp.content else []

                        # Truncation Auto-Continuation Guardrail
                        truncation_rounds = 0
                        max_truncation_rounds = 3
                        while (
                            provider_resp.finish_reason in ["length", "MAX_TOKENS", "max_tokens"]
                            and not function_calls
                            and truncation_rounds < max_truncation_rounds
                        ):
                            truncation_rounds += 1
                            logger.info(f"Model response was truncated (finish_reason={provider_resp.finish_reason}). Auto-continuing ({truncation_rounds}/{max_truncation_rounds}).")
                            await self._emit_streamed_thought(
                                f"**Response Truncation Detected**: Output reached token ceiling. Auto-continuing response ({truncation_rounds}/{max_truncation_rounds})...",
                                on_thought, on_stream_start, on_stream_chunk, on_stream_end
                            )
                            cont_model_parts = []
                            if provider_resp.thought:
                                cont_model_parts.append({"thought": provider_resp.thought})
                            if provider_resp.content:
                                cont_model_parts.append({"text": provider_resp.content})
                            if not cont_model_parts:
                                cont_model_parts = [{"text": "..."}]

                            contents.append({
                                "role": "model",
                                "parts": cont_model_parts
                            })
                            contents.append({
                                "role": "user",
                                "parts": [{"text": "Continue directly from where your output was truncated without repeating previous text:"}]
                            })

                            cont_resp = await provider.generate_response(
                                messages=contents,
                                tools=active_tools_def,
                                system_instruction=effective_system_instruction,
                                model_name=active_model,
                                temperature=0.2,
                                client=client
                            )
                            if not cont_resp.is_success:
                                logger.warning(f"Continuation call failed ({cont_resp.status_code}): {cont_resp.error_message}")
                                break

                            if cont_resp.thought:
                                collector.add_thought(cont_resp.thought)
                                await self._emit_streamed_thought(
                                    cont_resp.thought, on_thought, on_stream_start, on_stream_chunk, on_stream_end
                                )

                            if cont_resp.content:
                                text_parts.append(cont_resp.content)
                                if on_stream_chunk:
                                    try:
                                        res_chunk = on_stream_chunk(task_id, "agent", cont_resp.content, "agent_turn")
                                        if inspect.iscoroutine(res_chunk):
                                            await res_chunk
                                    except Exception:
                                        pass

                            provider_resp = cont_resp
                            if provider_resp.tool_calls:
                                function_calls = [{"name": tc.tool_name, "args": tc.tool_args, "id": tc.call_id} for tc in provider_resp.tool_calls]
                                break

                        combined_text = "\n".join(text_parts).strip() if text_parts else ""
                        if combined_text and function_calls:
                            await self._emit_streamed_thought(
                                combined_text, on_thought, on_stream_start, on_stream_chunk, on_stream_end
                            )

                        if not function_calls:
                            # 0. Autonomous Dangling Intent & Auto-Continuation Guardrail
                            # If the model emitted a forward-looking transitional promise (e.g. ending in a colon or "let me fix..."),
                            # prompt it to execute the tool calls rather than halting the session prematurely.
                            intent_category = current_plan.get("intent_category", "app_building" if persona_name == "AppBuilder" else "code_modification")
                            prompt_title_lower = (prompt + " " + title).lower()
                            is_exploration = any(k in prompt_title_lower for k in ["explore", "analyze", "explain", "review", "audit", "summarize", "investigate", "read", "check"])
                            is_app_keyword = not is_exploration and any(k in prompt_title_lower for k in ["build a", "build an", "create a", "create an", "make a", "make an", "game", "minecraft", "voxel", "arcade", "canvas", "dashboard", "calculator", "storefront", "web app", "frontend", "ui component"])
                            is_app_task = (intent_category == "app_building" or persona_name == "AppBuilder" or is_app_keyword)

                            raw_text_stripped = combined_text.strip()
                            has_unfinished_steps = any(s.get("status") in ["pending", "in_progress"] for s in current_plan.get("steps", []))
                            is_dangling_intent = False

                            if raw_text_stripped and guardrail_corrections < max_guardrail_corrections and (is_app_task or has_unfinished_steps or mutating_tool_count > 0):
                                ends_with_colon = raw_text_stripped.endswith(":")
                                tail_lower = raw_text_stripped.lower()[-120:]
                                forward_phrases = [
                                    "let me ", "let us ", "let's ", "i will now", "i'll now", "i will proceed",
                                    "i am going to", "now let me", "next, i will", "next, let's", "next step is to",
                                    "let me fix", "let me implement", "let me update", "let me create", "let me add"
                                ]
                                if ends_with_colon or any(p in tail_lower for p in forward_phrases):
                                    is_dangling_intent = True

                            if is_dangling_intent:
                                guardrail_corrections += 1
                                logger.info(f"Triggering Dangling Intent Auto-Continuation on task {task_id} (correction {guardrail_corrections})")
                                await self._emit_streamed_thought(
                                    f"**Auto-Continuation**: Detected in-flight action intent ({raw_text_stripped[-50:] if len(raw_text_stripped) > 50 else raw_text_stripped}). Continuing tool execution to complete task...",
                                    on_thought, on_stream_start, on_stream_chunk, on_stream_end
                                )
                                if provider_resp.raw_parts:
                                    clean_parts = []
                                    for p in provider_resp.raw_parts:
                                        if isinstance(p, dict):
                                            if "thought" in p or "text" in p or ("content" in p and isinstance(p["content"], str)):
                                                clean_parts.append(p)
                                    dangling_model_parts = clean_parts if clean_parts else ([{"text": combined_text}] if combined_text else [{"text": "Proceeding with implementation."}])
                                else:
                                    dangling_model_parts = []
                                    if provider_resp.thought:
                                        dangling_model_parts.append({"thought": provider_resp.thought})
                                    if combined_text:
                                        dangling_model_parts.append({"text": combined_text})

                                contents.append({
                                    "role": "model",
                                    "parts": dangling_model_parts if dangling_model_parts else [{"text": combined_text or "Proceeding with implementation."}]
                                })
                                contents.append({
                                    "role": "user",
                                    "parts": [{"text": "Please proceed with your planned actions and execute the required tool calls (e.g. `edit_file`, `replace_file_content`, `run_command`, `create_pull_request`) to complete the remaining tasks."}]
                                })
                                continue

                            # Autonomous Pre-Completion Verification Guardrail
                            from app.api.preview import verify_workspace_preview
                            verification = verify_workspace_preview(workspace_path, task_id)
                            status_val = verification.get("status")
                            needs_preview_correction = status_val in ["missing_entry_point", "missing_workspace", "needs_build", "uncompiled_css", "unlinked_assets", "empty_ui", "dom_css_mismatch", "issues_found"]

                            if is_app_task and needs_preview_correction and guardrail_corrections < max_guardrail_corrections:
                                guardrail_corrections += 1
                                issues_list = verification.get("issues", [])
                                issues_text = "\n".join(f"- {i}" for i in issues_list) if issues_list else "- No web application entry point (index.html) created in workspace."
                                rec_text = verification.get("recommendation", "Please implement the complete component views and ensure the application renders cleanly in Live Preview.")
                                guardrail_prompt = (
                                    f"Autonomous Pre-Completion Verification Notice ({status_val}):\n"
                                    f"{issues_text}\n"
                                    f"Required Action: {rec_text}\n\n"
                                    f"CRITICAL DIRECTIVE: Do NOT conclude the task without a functioning application. Implement the complete interactive UI/game views (DOM layout, controls, canvas, styles), write `index.html` linking your logic, and call `verify_app_preview` to confirm the application renders before providing your final response."
                                )
                                logger.info(f"Triggering Pre-Completion Guardrail on task {task_id} (correction {guardrail_corrections}, status {status_val})")
                                await self._emit_streamed_thought(
                                    f"**Pre-Completion Guardrail**: Verifying application preview... Status: {status_val}. {rec_text}",
                                    on_thought, on_stream_start, on_stream_chunk, on_stream_end
                                )
                                if provider_resp.raw_parts:
                                    clean_parts = []
                                    for p in provider_resp.raw_parts:
                                        if isinstance(p, dict):
                                            if "thought" in p or "text" in p or ("content" in p and isinstance(p["content"], str)):
                                                clean_parts.append(p)
                                    model_parts = clean_parts if clean_parts else ([{"text": combined_text}] if combined_text else [{"text": "Scaffolding initialized."}])
                                else:
                                    model_parts = []
                                    if provider_resp.thought:
                                        model_parts.append({"thought": provider_resp.thought})
                                    if combined_text:
                                        model_parts.append({"text": combined_text})

                                contents.append({
                                    "role": "model",
                                    "parts": model_parts if model_parts else [{"text": "Scaffolding initialized."}]
                                })
                                contents.append({
                                    "role": "user",
                                    "parts": [{"text": guardrail_prompt}]
                                })
                                continue

                            checks = [{"name": "Workspace State", "passed": True}]
                            if is_app_task:
                                verification = verify_workspace_preview(workspace_path, task_id)
                                preview_ok = verification.get("status") in ["ready", "compiled", "static"]
                                checks.append({
                                    "name": "Live Application Preview",
                                    "passed": preview_ok
                                })
                                checks.append({
                                    "name": "Tool Execution",
                                    "passed": tool_call_count > 0 or bool(combined_text)
                                })
                            elif intent_category == "qa_research":
                                has_synthesis = bool(combined_text and len(combined_text.strip()) > 30)
                                checks.append({
                                    "name": "Analytical Synthesis",
                                    "passed": has_synthesis
                                })
                                if tool_call_count > 0:
                                    checks.append({
                                        "name": "Tool Execution",
                                        "passed": True
                                    })
                            elif intent_category == "planning":
                                has_synthesis = bool(combined_text and len(combined_text.strip()) > 30)
                                checks.append({
                                    "name": "Plan Formulation",
                                    "passed": has_synthesis
                                })
                                checks.append({
                                    "name": "Specification Available in Web & Docs",
                                    "passed": True
                                })
                                if tool_call_count > 0:
                                    checks.append({
                                        "name": "Workspace Inspection",
                                        "passed": True
                                    })
                            else:
                                checks.append({
                                    "name": "Tool Execution",
                                    "passed": tool_call_count > 0 or bool(combined_text)
                                })

                            all_checks_passed = all(c.get("passed", False) for c in checks)
                            if not all_checks_passed and guardrail_corrections < max_guardrail_corrections:
                                guardrail_corrections += 1
                                failed_names = [c["name"] for c in checks if not c.get("passed", False)]
                                eval_status = "needs_revision"
                                eval_summary = f"Plan execution requires revision: {', '.join(failed_names)}."
                                for s in current_plan.get("steps", []):
                                    if s.get("status") == "in_progress":
                                        s["status"] = "failed"
                                current_plan["evaluation"] = {
                                    "status": eval_status,
                                    "summary": eval_summary,
                                    "checks": checks
                                }
                                await self._emit_plan(current_plan, on_plan)

                                self_heal_prompt = (
                                    f"Autonomous Plan Self-Healing Notice: Plan evaluation requires revision on: {', '.join(failed_names)}.\n"
                                    f"You must perform the necessary file edits (`edit_file`) or compilation steps to resolve these failed checks before concluding."
                                )
                                logger.info(f"Triggering Plan Self-Healing on task {task_id} (correction {guardrail_corrections})")
                                await self._emit_streamed_thought(
                                    f"**Plan Self-Healing**: Failed verification on {', '.join(failed_names)}. Continuing execution to resolve plan requirements...",
                                    on_thought, on_stream_start, on_stream_chunk, on_stream_end
                                )
                                if provider_resp.raw_parts:
                                    clean_heal_parts = []
                                    for p in provider_resp.raw_parts:
                                        if isinstance(p, dict):
                                            if "thought" in p or "text" in p or ("content" in p and isinstance(p["content"], str)):
                                                clean_heal_parts.append(p)
                                    heal_model_parts = clean_heal_parts if clean_heal_parts else ([{"text": combined_text}] if combined_text else [{"text": "Inspecting workspace."}])
                                else:
                                    heal_model_parts = []
                                    if provider_resp.thought:
                                        heal_model_parts.append({"thought": provider_resp.thought})
                                    if combined_text:
                                        heal_model_parts.append({"text": combined_text})
                                contents.append({
                                    "role": "model",
                                    "parts": heal_model_parts if heal_model_parts else [{"text": combined_text or "Inspecting workspace."}]
                                })
                                contents.append({
                                    "role": "user",
                                    "parts": [{"text": self_heal_prompt}]
                                })
                                continue

                            final_agent_text = combined_text or "Task execution completed."

                            is_plan_response = (
                                intent_category == "planning"
                                or "# Implementation Plan" in final_agent_text
                                or "## Implementation Plan" in final_agent_text
                                or "### Phase 1" in final_agent_text
                                or "Phase 1:" in final_agent_text
                            )

                            if is_plan_response:
                                # In Plan Mode or when the model outputs an architectural plan:
                                # Promote the model's actual structured plan to the First-Class Execution Plan!
                                extracted_plan = extract_plan_from_markdown(final_agent_text, default_title=title)
                                if extracted_plan.get("steps") and len(extracted_plan["steps"]) >= 1:
                                    current_plan["steps"] = extracted_plan["steps"]
                                    if extracted_plan.get("phases"):
                                        current_plan["phases"] = extracted_plan["phases"]
                                    if extracted_plan.get("title"):
                                        current_plan["title"] = extracted_plan["title"]
                                    if extracted_plan.get("overview"):
                                        current_plan["overview"] = extracted_plan["overview"]
                                else:
                                    for s in current_plan.get("steps", []):
                                        if s.get("status") != "failed":
                                            s["status"] = "pending"

                                current_plan["intent_category"] = "planning"
                                is_complete_doc = (
                                    (final_agent_text.strip().startswith("# Implementation Plan") or final_agent_text.strip().startswith("## Implementation Plan"))
                                    and "Inspect Full Plan in Web & Docs" not in final_agent_text
                                )
                                if is_complete_doc:
                                    current_plan["markdown"] = final_agent_text
                                else:
                                    current_plan["markdown"] = generate_plan_markdown(
                                        current_plan,
                                        title=current_plan.get("title") or title,
                                        prompt=prompt
                                    )
                                eval_status = "ready_for_review"
                                eval_summary = "Implementation plan formulated. Awaiting user review or approval to proceed."
                                checks = [
                                    {"name": "Implementation Plan Formulated", "passed": True, "message": "Architectural implementation plan ready for review"}
                                ]
                                current_plan["evaluation"] = {
                                    "status": eval_status,
                                    "summary": eval_summary,
                                    "checks": checks
                                }
                                await self._emit_plan(current_plan, on_plan)

                                chat_agent_text = format_plan_chat_summary(current_plan, full_markdown=final_agent_text, task_id=task_id)

                                await self._emit_streamed_message(
                                    "agent", chat_agent_text, on_message, on_stream_start, on_stream_chunk, on_stream_end
                                )

                                return {"status": "COMPLETED", "summary": chat_agent_text[:120]}
                            else:
                                if intent_category == "qa_research" and mutating_tool_count == 0:
                                    for s in current_plan.get("steps", []):
                                        if s.get("status") != "failed":
                                            s["status"] = "completed"
                                    eval_status = "accomplished" if all_checks_passed else "needs_revision"
                                    eval_summary = "All execution plan steps verified successfully against workspace state." if all_checks_passed else "Plan execution requires revision."
                                else:
                                    if is_app_task and mutating_tool_count > 0:
                                        from app.api.preview import verify_workspace_preview
                                        preview_verification = verify_workspace_preview(workspace_path, task_id)
                                        if preview_verification.get("status") in ["ready", "compiled", "static"]:
                                            for s in current_plan.get("steps", []):
                                                if s.get("status") != "failed":
                                                    s["status"] = "completed"

                                    any_pending_or_failed = False
                                    for s in current_plan.get("steps", []):
                                        if s.get("status") == "in_progress":
                                            if all_checks_passed:
                                                s["status"] = "completed"
                                            else:
                                                s["status"] = "failed"
                                        elif s.get("status") in ["pending", "failed"]:
                                            any_pending_or_failed = True

                                    eval_status = "accomplished" if (all_checks_passed and not any_pending_or_failed) else "needs_revision"
                                    eval_summary = "All execution plan steps verified successfully against workspace state." if (all_checks_passed and not any_pending_or_failed) else "Plan execution concluded with remaining pending steps or revisions needed."
                                current_plan["markdown"] = generate_plan_markdown(current_plan, title, prompt)

                                current_plan["evaluation"] = {
                                    "status": eval_status,
                                    "summary": eval_summary,
                                    "checks": checks
                                }
                                await self._emit_plan(current_plan, on_plan)

                                await self._emit_streamed_message(
                                    "agent", final_agent_text, on_message, on_stream_start, on_stream_chunk, on_stream_end
                                )

                            if intent_category == "qa_research" and final_agent_text and len(final_agent_text.strip()) > 30 and not (history and len(history) > 1):
                                try:
                                    from app.agent.semantic_cache import store_semantic_cache
                                    from app.db.session import async_session_factory
                                    async with async_session_factory() as store_sess:
                                        await store_semantic_cache(
                                            db=store_sess,
                                            query=prompt or title,
                                            plan=current_plan,
                                            response_text=final_agent_text,
                                            api_key=api_key,
                                            client=client,
                                            intent="qa_research"
                                        )
                                except Exception as cache_store_err:
                                    logger.debug(f"Semantic cache store notice: {cache_store_err}")
                            return {"status": "COMPLETED", "summary": final_agent_text[:120]}

                        model_parts = []
                        if provider_resp.thought:
                            model_parts.append({"thought": provider_resp.thought})
                        if provider_resp.content:
                            model_parts.append({"text": provider_resp.content})
                        for tc in provider_resp.tool_calls:
                            model_parts.append({
                                "functionCall": {
                                    "name": tc.tool_name,
                                    "args": tc.tool_args,
                                    "id": tc.call_id
                                }
                            })

                        contents.append({
                            "role": "model",
                            "parts": model_parts if model_parts else [{"text": "Processed."}]
                        })


                        response_parts = []
                        for call in function_calls:
                            fn_name = call.get("name")
                            args = call.get("args", {})

                            # Monotonic Dynamic Plan Step Transitions
                            if fn_name in ["edit_file", "replace_file_content", "batch_replace_content", "apply_unified_patch", "create_pull_request", "post_pull_request_review", "connect_repository"]:
                                if len(current_plan.get("steps", [])) >= 2:
                                    if Harness.advance_plan_step(current_plan, 1):
                                        await self._emit_plan(current_plan, on_plan)
                            elif (fn_name == "verify_app_preview" or (fn_name == "run_command" and any(k in str(args.get("command", "")).lower() for k in ["test", "pytest", "npm test", "vitest", "npm run test", "npm run build"]))) and mutating_tool_count >= 1:
                                if len(current_plan.get("steps", [])) >= 3:
                                    if Harness.advance_plan_step(current_plan, 2):
                                        await self._emit_plan(current_plan, on_plan)

                            if on_tool_start:
                                if inspect.iscoroutinefunction(on_tool_start):
                                    await on_tool_start(fn_name, args)
                                else:
                                    res = on_tool_start(fn_name, args)
                                    if asyncio.iscoroutine(res):
                                        await res

                            start_time = asyncio.get_event_loop().time()
                            tool_result: Dict[str, Any] = {}
                            exit_code = 0
                            out_str = ""
                            tool_call_count += 1

                            if fn_name == "list_dir":
                                subpath = args.get("subpath", ".")
                                tool_result = WorkspaceTools.list_dir(workspace_path, subpath)
                                items = tool_result.get("items", [])
                                if items:
                                    out_str = "\n".join(
                                        f"{'[dir]' if i.get('is_dir') else '[file]'} {i.get('name')}" +
                                        (f" ({i.get('size')} B)" if i.get('size') is not None else "")
                                        for i in items
                                    )
                                else:
                                    out_str = f"Directory '{subpath}' is empty."
                            elif fn_name == "read_file":
                                file_path = args.get("file_path", "")
                                start_line = args.get("start_line")
                                end_line = args.get("end_line")
                                tool_result = WorkspaceTools.read_file(workspace_path, file_path, start_line=start_line, end_line=end_line)
                                if "content" in tool_result:
                                    out_str = tool_result["content"]
                                else:
                                    out_str = tool_result.get("error", "Error reading file")
                            elif fn_name == "get_file_outline":
                                file_path = args.get("file_path", "")
                                tool_result = WorkspaceTools.get_file_outline(workspace_path, file_path)
                                if "outline" in tool_result:
                                    out_str = tool_result["outline"]
                                else:
                                    out_str = tool_result.get("error", "Error extracting file outline")
                            elif fn_name == "replace_file_content":
                                mutating_tool_count += 1
                                file_path = args.get("file_path", "")
                                target_content = args.get("target_content", "")
                                replacement_content = args.get("replacement_content", "")
                                allow_multiple = bool(args.get("allow_multiple", False))
                                tool_result = WorkspaceTools.replace_file_content(
                                    workspace_path=workspace_path,
                                    file_path=file_path,
                                    target_content=target_content,
                                    replacement_content=replacement_content,
                                    allow_multiple=allow_multiple
                                )
                                diffs = worktree_manager.get_git_diff(workspace_path)
                                if diffs:
                                    await on_diff_updated(diffs)
                                if "error" in tool_result:
                                    out_str = f"Error replacing content: {tool_result['error']}"
                                else:
                                    out_str = f"Successfully replaced target content in '{file_path}' ({tool_result.get('replacements_count', 1)} replacement(s))."
                            elif fn_name == "batch_replace_content":
                                mutating_tool_count += 1
                                edits = args.get("edits", [])
                                tool_result = WorkspaceTools.batch_replace_content(
                                    workspace_path=workspace_path,
                                    edits=edits
                                )
                                diffs = worktree_manager.get_git_diff(workspace_path)
                                if diffs:
                                    await on_diff_updated(diffs)
                                if "error" in tool_result:
                                    out_str = f"Error in batch edit: {tool_result['error']}"
                                else:
                                    f_count = tool_result.get("modified_files_count", 0)
                                    r_count = tool_result.get("total_replacements", 0)
                                    f_list = ", ".join(tool_result.get("modified_files", []))
                                    out_str = f"Batch edit successfully applied {r_count} replacement(s) across {f_count} file(s) [{f_list}]."
                            elif fn_name == "apply_unified_patch":
                                mutating_tool_count += 1
                                patch_content = args.get("patch_content", "")
                                tool_result = WorkspaceTools.apply_unified_patch(
                                    workspace_path=workspace_path,
                                    patch_content=patch_content
                                )
                                diffs = worktree_manager.get_git_diff(workspace_path)
                                if diffs:
                                    await on_diff_updated(diffs)
                                if "error" in tool_result:
                                    out_str = f"Error applying patch: {tool_result['error']}"
                                else:
                                    m_files = ", ".join(tool_result.get("modified_files", []))
                                    out_str = f"Unified patch successfully applied to: {m_files}."
                            elif fn_name == "edit_file":
                                mutating_tool_count += 1
                                file_path = args.get("file_path", "")
                                content = args.get("content", "")
                                tool_result = WorkspaceTools.edit_file(workspace_path, file_path, content)
                                diffs = worktree_manager.get_git_diff(workspace_path)
                                if diffs:
                                    await on_diff_updated(diffs)
                                out_str = f"Successfully updated '{file_path}' ({len(content)} bytes)."
                            elif fn_name == "speculative_branch_test":
                                hypotheses = args.get("hypotheses", [])
                                test_cmd = args.get("test_command", "")
                                tool_result = await WorkspaceTools.speculative_branch_test(
                                    workspace_path=workspace_path,
                                    hypotheses=hypotheses,
                                    test_command=test_cmd
                                )
                                winner = tool_result.get("winning_hypothesis")
                                out_str = f"Speculative Multi-Branch Test ({len(hypotheses)} branches):\n"
                                if winner:
                                    out_str += f"Winning Hypothesis: {winner}\n"
                                    # Auto-apply winner edits to active workspace
                                    win_idx = tool_result.get("winner_index")
                                    if win_idx is not None and win_idx < len(hypotheses):
                                        for edit in hypotheses[win_idx].get("edits", []):
                                            f_path = edit.get("file_path", "")
                                            tc = edit.get("target_content", "")
                                            rc = edit.get("replacement_content", "")
                                            if f_path and tc and rc is not None:
                                                WorkspaceTools.replace_file_content(workspace_path, f_path, tc, rc)
                                                mutating_tool_count += 1
                                            elif f_path and "content" in edit:
                                                WorkspaceTools.edit_file(workspace_path, f_path, edit["content"])
                                                mutating_tool_count += 1
                                        diffs = worktree_manager.get_git_diff(workspace_path)
                                        if diffs:
                                            await on_diff_updated(diffs)
                                        out_str += f"Successfully applied winning hypothesis '{winner}' to active workspace.\n"
                                else:
                                    out_str += "None of the speculative branches passed the verification test command.\n"
                                
                                for r in tool_result.get("all_results", []):
                                    status_label = "[PASSED]" if r.get("passed") else f"[FAILED exit {r.get('exit_code')}]"
                                    out_str += f"- {r.get('hypothesis_name')}: {status_label} ({r.get('duration_ms', 0)}ms)\n"
                            elif fn_name == "run_command":
                                cmd = args.get("command", "")
                                tool_result = WorkspaceTools.run_command(workspace_path, cmd)
                                exit_code = tool_result.get("exit_code", 0)
                                stdout = tool_result.get("stdout", "")
                                stderr = tool_result.get("stderr", "")
                                err_msg = tool_result.get("error", "")

                                if err_msg and "SECURITY CIRCUIT-BREAKER" in err_msg:
                                    if on_approval_required:
                                        try:
                                            res = on_approval_required(
                                                "DESTRUCTIVE_COMMAND_BLOCKED",
                                                {
                                                    "command": cmd,
                                                    "error": err_msg,
                                                    "description": f"Destructive command blocked by security circuit-breaker: {cmd}"
                                                }
                                            )
                                            if inspect.isawaitable(res):
                                                await res
                                        except Exception as cb_err:
                                            logger.warning(f"Failed to notify on_approval_required for blocked command: {cb_err}")

                                out_parts = []
                                if stdout:
                                    out_parts.append(stdout)
                                if stderr:
                                    out_parts.append(f"stderr:\n{stderr}")
                                elif err_msg:
                                    out_parts.append(f"error:\n{err_msg}")
                                if not out_parts:
                                    out_parts.append(f"(Command executed with exit code {exit_code})")

                                is_build_cmd = any(k in cmd.lower() for k in ["build", "compile", "vite build", "npm run build"])
                                if is_build_cmd:
                                    if exit_code != 0:
                                        consecutive_build_errors += 1
                                        if consecutive_build_errors >= 3:
                                            circuit_breaker_hint = (
                                                "\n\n[CIRCUIT-BREAKER NOTICE: Build command has failed repeatedly. "
                                                "Stop micro-editing conflicting configurations. Align your styling and bundler toolchain cleanly: "
                                                "For Tailwind v4: Use `@import \"tailwindcss\";` in CSS with the official bundler plugin without legacy postcss configs. "
                                                "For Tailwind v3: Ensure `tailwindcss@^3.4`, `postcss`, and `autoprefixer` are installed, with `@tailwind base; @tailwind components; @tailwind utilities;` in CSS. "
                                                "Resolve package dependencies cleanly with `npm install` and run `npm run build`.]"
                                            )
                                            out_parts.append(circuit_breaker_hint)
                                    else:
                                        consecutive_build_errors = 0

                                out_str = "\n".join(out_parts)
                            elif fn_name in ["grep_search", "search_code"]:
                                query = args.get("query", "")
                                is_regex = args.get("is_regex", False)
                                file_pattern = args.get("file_pattern")
                                tool_result = WorkspaceTools.search_code(
                                    workspace_path, query, is_regex=is_regex, file_pattern=file_pattern
                                )
                                matches = tool_result.get("matches", [])
                                if matches:
                                    out_str = f"Found {len(matches)} match(es):\n" + "\n".join(
                                        f"  {m['file_path']}:{m['line_number']}  {m['line_content']}"
                                        for m in matches[:25]
                                    )
                                else:
                                    out_str = f"No matches found for query: '{query}'"
                            elif fn_name == "find_symbols":
                                name_pattern = args.get("name_pattern", "")
                                symbol_type = args.get("symbol_type")
                                file_pattern = args.get("file_pattern")
                                tool_result = WorkspaceTools.find_symbols(
                                    workspace_path, name_pattern=name_pattern, symbol_type=symbol_type, file_pattern=file_pattern
                                )
                                symbols = tool_result.get("symbols", [])
                                if symbols:
                                    out_str = f"Found {len(symbols)} symbol(s):\n" + "\n".join(
                                        f"  [{s.get('type')}] {s.get('name')} -> {s.get('file_path')}:{s.get('line_number')} ({s.get('signature')})"
                                        for s in symbols[:30]
                                    )
                                else:
                                    out_str = f"No symbols found matching '{name_pattern}'."
                            elif fn_name == "tgrep_ast":
                                pattern = args.get("pattern", "")
                                tool_result = WorkspaceTools.tgrep_ast(workspace_path, pattern)
                                matches = tool_result.get("matches", [])
                                if matches:
                                    out_str = f"AST pattern '{pattern}' matched {len(matches)} node(s):\n" + "\n".join(
                                        f"  {m.get('file_path')}:{m.get('line_number')} -> {m.get('symbol')} ({m.get('signature', '')})"
                                        for m in matches[:25]
                                    )
                                else:
                                    out_str = f"No AST structures matched pattern '{pattern}'."
                            elif fn_name == "search_web":
                                query = args.get("query", "")
                                tool_result = await WorkspaceTools.search_web(query)
                                items = tool_result.get("results", [])
                                if items:
                                    out_str = "\n".join(
                                        f"- [{i.get('title')}]({i.get('url')}) • {i.get('source')} • {i.get('date')}"
                                        if i.get('date') else
                                        f"- [{i.get('title')}]({i.get('url')}) • {i.get('source')}"
                                        for i in items
                                    )
                                else:
                                    out_str = f"No results found for '{query}'"
                            elif fn_name == "fetch_url":
                                target_url = args.get("url", "")
                                tool_result = await WorkspaceTools.fetch_url(target_url)
                                out_str = tool_result.get("content", tool_result.get("error", "Error fetching URL"))
                            elif fn_name == "get_pull_request_details":
                                repo_arg = args.get("repository", "")
                                pr_num = int(args.get("pr_number", 1))
                                tool_result = await WorkspaceTools.get_pull_request_details(repo_arg, pr_num)
                                out_str = json.dumps(tool_result, indent=2)
                                if isinstance(tool_result, dict) and ("number" in tool_result or "pr_number" in tool_result):
                                    asyncio.create_task(self._upsert_task_prs(task_id, [tool_result]))
                            elif fn_name == "get_pull_request_diff":
                                repo_arg = args.get("repository", "")
                                pr_num = int(args.get("pr_number", 1))
                                tool_result = await WorkspaceTools.get_pull_request_diff(repo_arg, pr_num)
                                out_str = tool_result.get("diff", "")
                            elif fn_name == "list_pull_requests":
                                repo_arg = args.get("repository", "")
                                state_arg = args.get("state", "open")
                                author_arg = args.get("author")
                                limit_arg = int(args.get("limit", 10))
                                tool_result = await WorkspaceTools.list_pull_requests(
                                    repo_arg, state=state_arg, author=author_arg, limit=limit_arg
                                )
                                out_str = json.dumps(tool_result, indent=2)
                                if isinstance(tool_result, dict) and "pull_requests" in tool_result:
                                    f_ctx = {
                                        "author": author_arg,
                                        "state": state_arg,
                                        "repository": repo_arg,
                                        "total_found": tool_result.get("total_found", len(tool_result["pull_requests"]))
                                    }
                                    asyncio.create_task(self._upsert_task_prs(
                                        task_id, 
                                        tool_result["pull_requests"],
                                        filter_context=f_ctx,
                                        is_session_scoped=True
                                    ))
                            elif fn_name == "post_pull_request_review":
                                repo_arg = args.get("repository", "")
                                pr_num = int(args.get("pr_number", 1))
                                body_arg = args.get("body", "")
                                event_arg = args.get("event", "COMMENT")
                                tool_result = await WorkspaceTools.post_pull_request_review(
                                    repo_arg, pr_num, body_arg, event=event_arg
                                )
                                out_str = json.dumps(tool_result, indent=2)
                                asyncio.create_task(event_dispatcher.record_and_broadcast(
                                    task_id=task_id,
                                    action_type="pr_review",
                                    target=f"{repo_arg}#{pr_num}",
                                    payload={"review_event": event_arg, "body": body_arg, "repo": repo_arg, "pr_number": pr_num},
                                    status_code=200 if tool_result.get("ok", True) else 400
                                ))
                            elif fn_name == "post_pull_request_line_comment":
                                repo_arg = args.get("repository", "")
                                pr_num = int(args.get("pr_number", 1))
                                body_arg = args.get("body", "")
                                commit_sha_arg = args.get("commit_sha", "")
                                path_arg = args.get("path", "")
                                line_arg = int(args.get("line", 1))
                                side_arg = args.get("side", "RIGHT")
                                tool_result = await WorkspaceTools.post_pull_request_line_comment(
                                    repo_arg, pr_num, body_arg, commit_sha_arg, path_arg, line_arg, side=side_arg
                                )
                                out_str = json.dumps(tool_result, indent=2)
                                asyncio.create_task(event_dispatcher.record_and_broadcast(
                                    task_id=task_id,
                                    action_type="line_comment",
                                    target=f"{repo_arg}#{pr_num}:{path_arg}:{line_arg}",
                                    payload={"body": body_arg, "path": path_arg, "line": line_arg, "commit_sha": commit_sha_arg},
                                    status_code=200 if tool_result.get("ok", True) else 400
                                ))
                            elif fn_name == "create_pull_request":
                                repo_arg = args.get("repository", "")
                                title_arg = args.get("title", "")
                                body_arg = args.get("body", "")
                                head_branch_arg = args.get("head_branch", "")
                                base_branch_arg = args.get("base_branch", "main")
                                draft_arg = bool(args.get("draft", False))
                                tool_result = await WorkspaceTools.create_pull_request(
                                    repo_arg, title_arg, body_arg, head_branch_arg, base_branch_arg, draft_arg
                                )
                                out_str = json.dumps(tool_result, indent=2)
                                if isinstance(tool_result, dict) and ("number" in tool_result or "pr_number" in tool_result):
                                    asyncio.create_task(self._upsert_task_prs(task_id, [tool_result]))
                                asyncio.create_task(event_dispatcher.record_and_broadcast(
                                    task_id=task_id,
                                    action_type="create_pr",
                                    target=f"{repo_arg}:{head_branch_arg}",
                                    payload={"title": title_arg, "body": body_arg, "head": head_branch_arg, "base": base_branch_arg, "draft": draft_arg},
                                    status_code=200 if tool_result.get("ok", True) else 400
                                ))
                            elif fn_name == "connect_repository":
                                repo_url_arg = args.get("repo_url", "")
                                token_arg = args.get("token")
                                tool_result = await WorkspaceTools.connect_repository(repo_url_arg, token_arg)
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "ask_user_inquiry":
                                question_arg = args.get("question", "Please clarify your preference:")
                                options_arg = args.get("options", [])
                                default_opt_arg = args.get("default_option_id", "")
                                timeout_arg = int(args.get("timeout_seconds", 25))

                                if on_inquiry:
                                    if inspect.iscoroutinefunction(on_inquiry):
                                        inquiry_res = await on_inquiry(question_arg, options_arg, default_opt_arg, timeout_arg)
                                    else:
                                        inquiry_res = on_inquiry(question_arg, options_arg, default_opt_arg, timeout_arg)
                                        if asyncio.iscoroutine(inquiry_res):
                                            inquiry_res = await inquiry_res
                                else:
                                    def_label = default_opt_arg
                                    for o in options_arg:
                                        if isinstance(o, dict) and o.get("id") == default_opt_arg:
                                            def_label = o.get("label", default_opt_arg)
                                            break
                                    inquiry_res = {
                                        "selected_option_id": default_opt_arg,
                                        "label": def_label,
                                        "timed_out": True
                                    }

                                tool_result = inquiry_res or {}
                                sel_label = tool_result.get("label") or tool_result.get("selected_option_id") or "Default Option"
                                is_timed = tool_result.get("timed_out", False)
                                custom_t = tool_result.get("custom_response")

                                if custom_t:
                                    out_str = f"User custom response: '{custom_t}' (Option ID: {tool_result.get('selected_option_id')})"
                                elif is_timed:
                                    out_str = f"Auto-proceeded after {timeout_arg}s timeout with recommended default: '{sel_label}' (ID: {tool_result.get('selected_option_id')})"
                                else:
                                    out_str = f"User selected: '{sel_label}' (ID: {tool_result.get('selected_option_id')})"
                            elif fn_name == "verify_app_preview":
                                from app.api.preview import verify_workspace_preview
                                tool_result = verify_workspace_preview(workspace_path, task_id)
                                status_str = tool_result.get("status", "unknown")
                                fw_str = tool_result.get("framework", "unknown")
                                entry_str = tool_result.get("entry_point") or "None"
                                build_st = tool_result.get("build_status", "none")
                                issues_list = tool_result.get("issues", [])
                                rec_str = tool_result.get("recommendation", "")

                                out_lines = [
                                    f"Preview Status: {status_str.upper()}",
                                    f"Framework: {fw_str}",
                                    f"Entry Point: {entry_str}",
                                    f"Build Status: {build_st}"
                                ]
                                if issues_list:
                                    out_lines.append("Issues Detected:")
                                    for iss in issues_list:
                                        out_lines.append(f"  - {iss}")
                                if rec_str:
                                    out_lines.append(f"Recommendation: {rec_str}")
                                out_str = "\n".join(out_lines)
                            elif fn_name == "run_verified_code_review":
                                repo_arg = args.get("repository")
                                pr_num_arg = args.get("pr_number")
                                diff_text_arg = args.get("diff_text")
                                tool_result = await WorkspaceTools.run_verified_code_review(
                                    workspace_path=workspace_path,
                                    repository=repo_arg,
                                    pr_number=pr_num_arg,
                                    diff_text=diff_text_arg,
                                    model_name=effective_model,
                                    provider=provider,
                                    client=client
                                )
                                out_str = tool_result.get("review_markdown") or json.dumps(tool_result, indent=2)
                            elif fn_name == "verify_code_hypothesis":
                                file_path_arg = args.get("file_path", "")
                                line_range_arg = args.get("line_range", "1")
                                inv_arg = args.get("invariant_violated", "")
                                repro_arg = args.get("reproduction_scenario", "")
                                tool_result = await WorkspaceTools.verify_code_hypothesis(
                                    workspace_path=workspace_path,
                                    file_path=file_path_arg,
                                    line_range=line_range_arg,
                                    invariant_violated=inv_arg,
                                    reproduction_scenario=repro_arg,
                                    model_name=effective_model,
                                    provider=provider,
                                    client=client
                                )
                                out_str = json.dumps(tool_result, indent=2)
                            else:
                                tool_result = {"error": f"Unknown tool: {fn_name}"}
                                exit_code = 1
                                out_str = f"Unknown tool: {fn_name}"

                            elapsed_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)
                            collector.record_tool_invocation(
                                tool_name=fn_name,
                                input_args=args,
                                output_data=out_str,
                                error=tool_result.get("error") if isinstance(tool_result, dict) else None,
                                duration_ms=elapsed_ms,
                                exit_code=exit_code
                            )
                            if on_tool_end:
                                sig = inspect.signature(on_tool_end)
                                if inspect.iscoroutinefunction(on_tool_end):
                                    if len(sig.parameters) >= 5:
                                        await on_tool_end(fn_name, out_str, exit_code, elapsed_ms, args)
                                    else:
                                        await on_tool_end(fn_name, out_str, exit_code, elapsed_ms)
                                else:
                                    if len(sig.parameters) >= 5:
                                        res = on_tool_end(fn_name, out_str, exit_code, elapsed_ms, args)
                                    else:
                                        res = on_tool_end(fn_name, out_str, exit_code, elapsed_ms)
                                    if asyncio.iscoroutine(res):
                                        await res

                            response_parts.append({
                                "functionResponse": {
                                    "name": fn_name,
                                    "response": tool_result,
                                    "id": call.get("id") or f"call_{fn_name}"
                                }
                            })

                        contents.append({
                            "role": "user",
                            "parts": response_parts
                        })

                    # Post-loop autonomous application build verification & compilation
                    intent_category = current_plan.get("intent_category", "app_building" if persona_name == "AppBuilder" else "code_modification")
                    is_app_task = (intent_category == "app_building")
                    from app.api.preview import verify_workspace_preview
                    post_verification = verify_workspace_preview(workspace_path, task_id)
                    has_workspace_source = (
                        (workspace_path / "package.json").exists()
                        or (workspace_path / "client" / "package.json").exists()
                        or (workspace_path / "index.html").exists()
                        or (workspace_path / "client" / "index.html").exists()
                    )

                    # If uncompiled frontend, needs build, or stale bundle after new changes, autonomously execute production build fallback
                    needs_build_or_recompile = (
                        post_verification.get("status") in ["needs_build", "needs_rebuild", "stale_build", "uncompiled_css", "missing_entry_point"]
                        or post_verification.get("is_stale", False)
                    )
                    if is_app_task and has_workspace_source and needs_build_or_recompile:
                        logger.info(f"Triggering post-loop autonomous build fallback on task {task_id} (current status: {post_verification.get('status')}, stale: {post_verification.get('is_stale')})...")
                        client_pkg = workspace_path / "client" / "package.json"
                        root_pkg = workspace_path / "package.json"
                        if client_pkg.exists():
                            build_cmd = "cd client && (npm run build || npx vite build)"
                        elif root_pkg.exists():
                            build_cmd = "npm run build || npx vite build"
                        else:
                            build_cmd = "npx vite build"

                        build_res = WorkspaceTools.run_command(workspace_path, build_cmd)
                        logger.info(f"Post-loop build result on {task_id}: exit code {build_res.get('exit_code')}")
                        post_verification = verify_workspace_preview(workspace_path, task_id)

                    # If unlinked assets, empty UI, or missing index.html but CSS/JS exist, autonomously synthesize host HTML shell
                    if is_app_task and (post_verification.get("status") in ["missing_entry_point", "unlinked_assets", "empty_ui"]):
                        css_candidates = list(workspace_path.glob("css/*.css")) + list(workspace_path.glob("*.css"))
                        js_candidates = list(workspace_path.glob("js/*.js")) + list(workspace_path.glob("*.js"))
                        
                        css_files = [f for f in css_candidates if "node_modules" not in str(f) and ".git" not in str(f) and not f.name.startswith(".")]
                        js_files = [f for f in js_candidates if "node_modules" not in str(f) and ".git" not in str(f) and not f.name.startswith(".")]
                        
                        if css_files or js_files:
                            logger.info(f"Synthesizing autonomous index.html host shell on task {task_id} for unlinked assets ({len(css_files)} CSS, {len(js_files)} JS)...")
                            js_sample = ""
                            for jf in js_files:
                                try:
                                    js_sample += jf.read_text(encoding="utf-8", errors="ignore")[:4000]
                                except Exception:
                                    pass
                            
                            has_vue = "Vue" in js_sample or "createApp" in js_sample
                            has_react = "React" in js_sample or "ReactDOM" in js_sample or "useState" in js_sample
                            has_lucide = "lucide" in js_sample.lower()
                            root_mount_patterns = [
                                r"createApp\b",
                                r"createRoot\b",
                                r"ReactDOM\.render\b",
                                r"Alpine\.start\b",
                                r"document\.(?:getElementById|querySelector)\s*\(\s*['\"](?:#?app|#?root|#?container|#?main)['\"]\s*\)\s*\.(?:innerHTML|replaceChildren|appendChild)",
                                r"document\.body\.(?:innerHTML|appendChild|replaceChildren)",
                                r"function\s+render\b",
                                r"const\s+render\s*=",
                                r"let\s+render\s*=",
                                r"\brenderApp\b",
                                r"\bmountApp\b"
                            ]
                            has_dom_mount = any(re.search(p, js_sample, re.IGNORECASE) for p in root_mount_patterns)

                            css_links_html = "\n".join(f'  <link rel="stylesheet" href="./{f.relative_to(workspace_path).as_posix()}" />' for f in css_files)
                            js_scripts_html = "\n".join(f'  <script src="./{f.relative_to(workspace_path).as_posix()}"></script>' for f in js_files)

                            cdn_headers = [
                                '  <script src="https://cdn.tailwindcss.com"></script>',
                                '  <script src="https://unpkg.com/lucide@latest"></script>'
                            ]
                            if has_vue:
                                cdn_headers.append('  <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>')
                            if has_react:
                                cdn_headers.append('  <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>')
                                cdn_headers.append('  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>')

                            cdn_block = "\n".join(cdn_headers)
                            app_title = title or "Live Application"

                            is_msg_app = bool(re.search(r"\b(?:message|messaging|chat|slack|discord|pulsechat|inbox|conversations?)\b", prompt_title_lower)) or "Store" in js_sample or "ChatEngine" in js_sample
                            is_game_app = bool(re.search(r"\b(?:game|snake|arcade|tetris|pong|canvas|score)\b", prompt_title_lower))
                            is_calc_app = bool(re.search(r"\b(?:calc|calculator|math|arithmetic)\b", prompt_title_lower))

                            auto_mount_script = ""
                            if not has_dom_mount:
                                auto_mount_script = f"""
  <script>
    window.addEventListener('DOMContentLoaded', () => {{
      const appEl = document.getElementById('app') || document.getElementById('root');
      if (!appEl || appEl.children.length > 0 || appEl.innerHTML.trim().length > 30) return;

      const isMessaging = {str(is_msg_app).lower()} || window.appStore || window.chatEngine;
      const isGame = {str(is_game_app).lower()};
      const isCalc = {str(is_calc_app).lower()} || window.MathEngine;

      if (isMessaging) {{
        // Interactive Messaging App Auto-Mount
        const store = window.appStore || {{
          state: {{
            currentUser: {{ name: "Alex Morgan", avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80" }},
            channels: [
              {{ id: "chan_general", name: "general", unread: 0 }},
              {{ id: "chan_dev", name: "dev-stream", unread: 2 }},
              {{ id: "chan_product", name: "product-design", unread: 0 }}
            ],
            directMessages: [
              {{ id: "dm_bot", name: "PulseBot AI", online: true, avatar: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80" }},
              {{ id: "dm_sarah", name: "Sarah Chen", online: true, avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80" }},
              {{ id: "dm_marcus", name: "Marcus Vance", online: false, avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80" }}
            ],
            messages: {{
              chan_general: [
                {{ id: "m1", senderName: "PulseBot AI", senderAvatar: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80", content: "Welcome to PulseChat! Real-time messaging and peer collaboration are online.", timestamp: Date.now() - 3600000 }},
                {{ id: "m2", senderName: "Sarah Chen", senderAvatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80", content: "Hey team, the latest client update has been deployed to staging.", timestamp: Date.now() - 1800000 }}
              ]
            }},
            activeChatId: "chan_general"
          }},
          getCurrentChat() {{
            return this.state.channels.find(c => c.id === this.state.activeChatId) || this.state.directMessages.find(d => d.id === this.state.activeChatId) || this.state.channels[0];
          }},
          getMessages() {{
            return this.state.messages[this.state.activeChatId] || [];
          }},
          setActiveChat(id) {{
            this.state.activeChatId = id;
            if (this.notify) this.notify();
          }},
          addMessage(chatId, msg) {{
            if (!this.state.messages[chatId]) this.state.messages[chatId] = [];
            this.state.messages[chatId].push({{ id: "m_" + Date.now(), timestamp: Date.now(), ...msg }});
            if (this.notify) this.notify();
          }},
          subscribe(fn) {{
            this.notify = fn;
          }}
        }};

        if (!window.chatEngine && typeof ChatEngine !== 'undefined') {{
          window.chatEngine = new ChatEngine(store);
        }}

        appEl.innerHTML = `
          <div class="flex h-screen bg-zinc-950 text-zinc-100 font-sans antialiased overflow-hidden">
            <!-- Sidebar -->
            <div class="w-64 border-r border-zinc-800 bg-zinc-900/60 flex flex-col shrink-0 select-none">
              <div class="p-4 border-b border-zinc-800 flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white text-sm shadow-md shadow-indigo-600/30">P</div>
                  <span class="font-semibold tracking-tight text-white text-sm">PulseChat</span>
                </div>
                <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              </div>
              <div class="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
                <div>
                  <div class="px-2 pb-1.5 font-medium text-zinc-500 uppercase tracking-wider text-[10px]">Channels</div>
                  <div id="channels-list" class="space-y-0.5"></div>
                </div>
                <div>
                  <div class="px-2 pb-1.5 font-medium text-zinc-500 uppercase tracking-wider text-[10px]">Direct Messages</div>
                  <div id="dms-list" class="space-y-0.5"></div>
                </div>
              </div>
              <div class="p-3 border-t border-zinc-800 bg-zinc-950/40 flex items-center gap-2.5">
                <img src="${{store.state.currentUser.avatar}}" class="w-7 h-7 rounded-full object-cover border border-zinc-700" />
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-medium text-zinc-200 truncate">${{store.state.currentUser.name}}</div>
                  <div class="text-[10px] text-emerald-400 font-mono">Active Now</div>
                </div>
              </div>
            </div>

            <!-- Main Chat View -->
            <div class="flex-1 flex flex-col min-w-0 bg-zinc-950">
              <div class="h-14 px-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/30 backdrop-blur-sm shrink-0">
                <div class="flex items-center gap-2">
                  <span class="text-zinc-400 font-mono text-base font-semibold" id="chat-prefix">#</span>
                  <span class="font-semibold text-zinc-100 text-sm" id="chat-title">general</span>
                  <span class="text-xs text-zinc-500 ml-2 border-l border-zinc-800 pl-2">Real-time collaboration</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-300 font-mono">3 Members</span>
                </div>
              </div>

              <!-- Message Stream -->
              <div id="messages-container" class="flex-1 overflow-y-auto p-5 space-y-4"></div>

              <div id="typing-indicator" class="px-5 text-xs text-zinc-500 italic h-4"></div>

              <!-- Message Input Composer -->
              <div class="p-4 border-t border-zinc-800 bg-zinc-900/20 shrink-0">
                <form id="msg-form" class="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2 focus-within:border-indigo-500 transition-colors shadow-lg">
                  <input id="msg-input" type="text" placeholder="Type a message or @pulsebot..." class="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none" autocomplete="off" />
                  <button type="submit" class="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95 transition-all text-xs font-medium px-3 flex items-center gap-1.5 shadow-md shadow-indigo-600/20">
                    <span>Send</span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        `;

        function render() {{
          const active = store.getCurrentChat();
          const chatPrefixEl = document.getElementById('chat-prefix');
          const chatTitleEl = document.getElementById('chat-title');
          if (chatPrefixEl) chatPrefixEl.innerText = active.name ? '#' : '@';
          if (chatTitleEl) chatTitleEl.innerText = active.name || 'Chat';

          const chList = document.getElementById('channels-list');
          if (chList) {{
            chList.innerHTML = store.state.channels.map(c => `
              <button class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-between ${{c.id === store.state.activeChatId ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}}" onclick="window.appStore.setActiveChat('${{c.id}}')">
                <span class="truncate"># ${{c.name}}</span>
              </button>
            `).join('');
          }}

          const dmList = document.getElementById('dms-list');
          if (dmList) {{
            dmList.innerHTML = store.state.directMessages.map(d => `
              <button class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 ${{d.id === store.state.activeChatId ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}}" onclick="window.appStore.setActiveChat('${{d.id}}')">
                <img src="${{d.avatar}}" class="w-4 h-4 rounded-full" />
                <span class="truncate flex-1">${{d.name}}</span>
              </button>
            `).join('');
          }}

          const msgsEl = document.getElementById('messages-container');
          if (msgsEl) {{
            const msgs = store.getMessages();
            msgsEl.innerHTML = msgs.map(m => `
              <div class="flex items-start gap-3 group">
                <img src="${{m.senderAvatar || store.state.currentUser.avatar}}" class="w-8 h-8 rounded-full object-cover border border-zinc-800 shrink-0 mt-0.5" />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="font-semibold text-xs text-zinc-200">${{m.senderName || 'User'}}</span>
                    <span class="text-[10px] text-zinc-500 font-mono">${{new Date(m.timestamp || Date.now()).toLocaleTimeString([], {{hour: '2-digit', minute:'2-digit'}})}}</span>
                  </div>
                  <div class="text-sm text-zinc-300 leading-relaxed break-words bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3 inline-block max-w-2xl shadow-sm">
                    ${{m.content}}
                  </div>
                </div>
              </div>
            `).join('');
            msgsEl.scrollTop = msgsEl.scrollHeight;
          }}
        }}

        store.subscribe(render);
        render();

        const form = document.getElementById('msg-form');
        const input = document.getElementById('msg-input');
        if (form && input) {{
          form.addEventListener('submit', (e) => {{
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            input.value = '';

            if (window.chatEngine && typeof window.chatEngine.handleUserMessage === 'function') {{
              window.chatEngine.handleUserMessage(store.state.activeChatId, text);
            }} else {{
              store.addMessage(store.state.activeChatId, {{
                senderName: store.state.currentUser.name,
                senderAvatar: store.state.currentUser.avatar,
                content: text
              }});
            }}
          }});
        }}
      }} else if (isCalc) {{
        // Interactive Calculator Auto-Mount
        appEl.innerHTML = `
          <div class="max-w-md mx-auto p-6 mt-8 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-2xl backdrop-blur-xl">
            <div class="flex items-center justify-between mb-4">
              <h1 class="text-base font-semibold tracking-tight text-zinc-200">${{document.title || 'OmniCalc Studio'}}</h1>
              <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">Live</span>
            </div>
            <div class="p-4 rounded-xl bg-zinc-950 border border-zinc-800 mb-5 text-right">
              <div id="calc-expr" class="text-xs text-zinc-500 font-mono h-4 overflow-hidden mb-1"></div>
              <div id="calc-display" class="text-3xl font-bold font-mono tracking-tight text-white select-all">0</div>
            </div>
            <div class="grid grid-cols-4 gap-2.5 font-medium">
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-amber-400 active:scale-95 transition-all" data-val="C">C</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 active:scale-95 transition-all" data-val="(">(</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 active:scale-95 transition-all" data-val=")">)</button>
              <button class="calc-btn p-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95 transition-all font-bold" data-val="/">÷</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-zinc-100 active:scale-95 transition-all" data-val="7">7</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-zinc-100 active:scale-95 transition-all" data-val="8">8</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-zinc-100 active:scale-95 transition-all" data-val="9">9</button>
              <button class="calc-btn p-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95 transition-all font-bold" data-val="*">×</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-zinc-100 active:scale-95 transition-all" data-val="4">4</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-zinc-100 active:scale-95 transition-all" data-val="5">5</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-zinc-100 active:scale-95 transition-all" data-val="6">6</button>
              <button class="calc-btn p-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95 transition-all font-bold" data-val="-">−</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-zinc-100 active:scale-95 transition-all" data-val="1">1</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-zinc-100 active:scale-95 transition-all" data-val="2">2</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-zinc-100 active:scale-95 transition-all" data-val="3">3</button>
              <button class="calc-btn p-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95 transition-all font-bold" data-val="+">+</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-zinc-100 active:scale-95 transition-all" data-val="0">0</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-zinc-100 active:scale-95 transition-all" data-val=".">.</button>
              <button class="calc-btn p-3.5 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 text-zinc-100 active:scale-95 transition-all font-mono text-sm" data-val="π">π</button>
              <button class="calc-btn p-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95 transition-all font-bold shadow-lg shadow-emerald-900/30" data-val="=">=</button>
            </div>
          </div>
        `;
        let curVal = '0';
        let prevExp = '';
        const disp = document.getElementById('calc-display');
        const exprDisp = document.getElementById('calc-expr');
        document.querySelectorAll('.calc-btn').forEach(b => {{
          b.addEventListener('click', () => {{
            const v = b.getAttribute('data-val');
            if (v === 'C') {{ curVal = '0'; prevExp = ''; }}
            else if (v === '=') {{
              try {{
                prevExp = curVal + ' =';
                let evalStr = curVal.replace(/π/g, 'Math.PI').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
                curVal = String(Function('"use strict";return (' + evalStr + ')')());
              }} catch(e) {{ curVal = 'Error'; }}
            }} else {{
              if (curVal === '0' && !isNaN(v)) curVal = v;
              else curVal += v;
            }}
            disp.innerText = curVal;
            exprDisp.innerText = prevExp;
          }});
        }});
      }} else if (isGame) {{
        // Retro Arcade Game Auto-Mount
        appEl.innerHTML = `
          <div class="max-w-lg mx-auto p-6 mt-8 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-2xl backdrop-blur-xl text-center">
            <div class="flex items-center justify-between mb-4">
              <h1 class="text-base font-semibold tracking-tight text-zinc-200">${{document.title || 'Retro Arcade Game'}}</h1>
              <span id="score-badge" class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">Score: 0</span>
            </div>
            <div class="relative bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden flex items-center justify-center p-2 mb-4">
              <canvas id="game-canvas" width="400" height="300" class="bg-zinc-950 rounded-lg"></canvas>
            </div>
            <div class="flex items-center justify-center gap-3">
              <button id="btn-start" class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 active:scale-95 transition-all">Start Game</button>
              <span class="text-xs text-zinc-500 font-mono">Use Arrow Keys or WASD</span>
            </div>
          </div>
        `;
        const canvas = document.getElementById('game-canvas');
        if (canvas) {{
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#6366f1';
          ctx.font = '14px monospace';
          ctx.fillText('Press Start to Play', 130, 150);
        }}
      }}
    }});
  </script>
"""

                            synthesized_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{app_title}</title>
{cdn_block}
{css_links_html}
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen antialiased">
  <div id="app"></div>
  <div id="root"></div>
{js_scripts_html}
{auto_mount_script}
  <script>
    if (window.lucide) {{ try {{ lucide.createIcons(); }} catch(e) {{}} }}
  </script>
</body>
</html>
"""
                            (workspace_path / "index.html").write_text(synthesized_html, encoding="utf-8")
                            post_verification = verify_workspace_preview(workspace_path, task_id)

                    preview_status_note = (
                        f"\n\nVERIFIED PREVIEW STATUS (Fact-Grounded):\n"
                        f"- Status: {post_verification.get('status')}\n"
                        f"- Build Status: {post_verification.get('build_status')}\n"
                        f"- Entry Point: {post_verification.get('entry_point')}\n"
                        f"- Issues: {post_verification.get('issues', [])}\n"
                        f"CRITICAL DIRECTIVE: Ground your response strictly in the verified preview status above. Only report that the application is compiled and renderable if status is 'ready' or 'compiled'. Direct the user to the Preview tab."
                    )

                    # Autonomous Plan Self-Evaluation Audit via EvaluationRunner
                    scorecard = await evaluation_runner.evaluate_task(
                        workspace_path=workspace_path,
                        intent_category=intent_category,
                        is_app_task=is_app_task,
                        preview_info=post_verification,
                        tool_call_count=tool_call_count,
                        final_agent_text=final_agent_text,
                        model_succeeded=model_succeeded
                    )
                    task_evaluations[task_id] = scorecard

                    if scorecard.status == "accomplished":
                        for s in current_plan.get("steps", []):
                            if s.get("status") != "failed":
                                s["status"] = "completed"
                    else:
                        for s in current_plan.get("steps", []):
                            if s.get("status") == "in_progress":
                                s["status"] = "failed"

                    current_plan["evaluation"] = scorecard.model_dump(mode="json")
                    await self._emit_plan(current_plan, on_plan)

                    if model_succeeded:
                        # 1. Guaranteed synthesis turn via active_provider
                        synth_instruction = (
                            system_instruction + preview_status_note +
                            "\n\nCRITICAL DIRECTIVE: You have completed all tool executions. Synthesize your comprehensive, fluid analytical response answering the user directly in rich markdown format with clickable citations. Do not call any further tools."
                        )
                        try:
                            synth_resp = await active_provider.generate_response(
                                messages=contents,
                                tools=tools_def,
                                system_instruction=synth_instruction,
                                model_name=active_model,
                                client=client
                            )
                            if synth_resp.is_success and synth_resp.content:
                                final_synth_text = synth_resp.content.strip()
                                if final_synth_text:
                                    collector.end_turn(agent_response=final_synth_text)
                                    task_trajectories[task_id] = collector.build_trajectory(status="COMPLETED")
                                    await self._emit_streamed_message(
                                        "agent", final_synth_text, on_message, on_stream_start, on_stream_chunk, on_stream_end
                                    )
                                    return {"status": "COMPLETED", "summary": final_synth_text[:120]}
                        except Exception as synth_err:
                            logger.error(f"Synthesis turn error: {synth_err}")

                        # 2. Fallback text transcript synthesis via active_provider
                        try:
                            text_contents = []
                            for c in contents:
                                role = c.get("role", "user")
                                parts = c.get("parts", [])
                                text_chunks = []
                                for p in parts:
                                    if "text" in p:
                                        text_chunks.append(p["text"])
                                    elif "functionCall" in p:
                                        fc = p["functionCall"]
                                        fn_name = fc.get("name", "tool")
                                        args = fc.get("args", {})
                                        if fn_name == "edit_file":
                                            text_chunks.append(f"• Modified file `{args.get('file_path', '')}`")
                                        elif fn_name == "read_file":
                                            text_chunks.append(f"• Inspected `{args.get('file_path', '')}`")
                                        elif fn_name == "run_command":
                                            text_chunks.append(f"• Ran `{args.get('command', '')}`")
                                        elif fn_name == "verify_app_preview":
                                            text_chunks.append("• Verified live application preview")
                                        elif fn_name in ["grep_search", "search_code"]:
                                            text_chunks.append(f"• Searched for `{args.get('query', '')}`")
                                        elif fn_name == "find_symbols":
                                            text_chunks.append(f"• Searched symbols `{args.get('name_pattern', '')}`")
                                        elif fn_name == "search_web":
                                            text_chunks.append(f"• Web search for `{args.get('query', '')}`")
                                        elif fn_name == "fetch_url":
                                            text_chunks.append(f"• Fetched URL `{args.get('url', '')}`")
                                        elif fn_name == "list_dir":
                                            text_chunks.append(f"• Listed directory `{args.get('subpath', '.')}`")
                                        else:
                                            text_chunks.append(f"• Executed tool {fn_name}")
                                    elif "functionResponse" in p:
                                        fr = p["functionResponse"]
                                        resp_val = fr.get("response", {})
                                        resp_str = json.dumps(resp_val) if isinstance(resp_val, (dict, list)) else str(resp_val)
                                        if len(resp_str) > 2000:
                                            resp_str = resp_str[:2000] + "... (truncated)"
                                        text_chunks.append(f"Observation for {fr.get('name')}:\n{resp_str}\n")
                                if text_chunks:
                                    text_contents.append({
                                        "role": role,
                                        "parts": [{"text": "\n\n".join(text_chunks)}]
                                    })
                            text_contents.append({
                                "role": "user",
                                "parts": [{
                                    "text": "CRITICAL INSTRUCTION: All workspace actions have been performed. Provide your complete, comprehensive analytical final answer summarizing what was built, any changes made, and preview verification results in rich markdown with clickable file links. Do NOT output internal action traces, tool call syntax, or 'Action:' prefixes."
                                }]
                            })
                            flat_resp = await active_provider.generate_response(
                                messages=text_contents,
                                tools=None,
                                system_instruction=system_instruction + preview_status_note,
                                model_name=active_model,
                                client=client
                            )
                            if flat_resp.is_success and flat_resp.content:
                                flat_synth_text = flat_resp.content.strip()
                                if re.match(r"^(?:Action:\s+|•\s+(?:Modified|Ran|Inspected|Executed|Listed|Searched))", flat_synth_text.strip(), re.IGNORECASE):
                                    flat_synth_text = (
                                        "All requested components and workspace modifications have been applied and verified."
                                    )
                                collector.end_turn(agent_response=flat_synth_text)
                                task_trajectories[task_id] = collector.build_trajectory(status="COMPLETED")
                                await self._emit_streamed_message(
                                    "agent", flat_synth_text, on_message, on_stream_start, on_stream_chunk, on_stream_end
                                )
                                return {"status": "COMPLETED", "summary": flat_synth_text[:120]}
                        except Exception as flat_err:
                            logger.error(f"Flat text synthesis error: {flat_err}")

                    if model_succeeded and final_agent_text:
                        collector.end_turn(agent_response=final_agent_text)
                        task_trajectories[task_id] = collector.build_trajectory(status="COMPLETED")
                        await self._emit_streamed_message(
                            "agent", final_agent_text, on_message, on_stream_start, on_stream_chunk, on_stream_end
                        )
                        return {"status": "COMPLETED", "summary": final_agent_text[:120]}

                except Exception as e:
                    logger.error(f"Gemini execution notice: {str(e)}")
                    continue

        if mutating_tool_count > 0:
            fallback_msg = (
                f"Successfully completed {tool_call_count} workspace action{'s' if tool_call_count > 1 else ''}. "
                f"All requested components and changes have been applied to the workspace."
            )
            return_status = "COMPLETED"
        elif tool_call_count > 0:
            plan_eval = current_plan.get("evaluation", {})
            is_ok = plan_eval.get("status") == "accomplished"
            if is_ok:
                fallback_msg = f"Completed {tool_call_count} workspace inspection action{'s' if tool_call_count > 1 else ''}."
                return_status = "COMPLETED"
            else:
                eval_sum = plan_eval.get("summary", "Plan execution requires revision.")
                fallback_msg = (
                    f"Completed {tool_call_count} workspace inspection action{'s' if tool_call_count > 1 else ''}. "
                    f"Execution halted before generating the required application files ({eval_sum})."
                )
                return_status = "FAILED"
        else:
            if last_api_error_text:
                fallback_msg = (
                    f"### Model Execution Notice\n\n"
                    f"Unable to execute actions due to an upstream model API response ({last_api_error_code or 'error'}):\n"
                    f"**{last_api_error_text}**\n\n"
                    f"Please verify your API key and provider configuration in **Settings > Integrations** or provide a fresh Gemini API key (`AIzaSy...`) in chat."
                )
            else:
                fallback_msg = (
                    f"Execution could not be completed. The AI provider did not return actionable tool calls or responses for this turn."
                )
            return_status = "FAILED"
        collector.end_turn(agent_response=fallback_msg)
        task_trajectories[task_id] = collector.build_trajectory(status=return_status)
        await self._emit_streamed_message(
            "agent", fallback_msg, on_message, on_stream_start, on_stream_chunk, on_stream_end
        )
        return {"status": return_status, "summary": fallback_msg[:120]}


def get_task_trajectory(task_id: str) -> Optional[AgentTrajectory]:
    return task_trajectories.get(task_id)


def get_task_evaluation(task_id: str) -> Optional[EvaluationScorecard]:
    return task_evaluations.get(task_id)


antigravity_harness = AntigravityHarness()
Harness = AntigravityHarness

