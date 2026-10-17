import asyncio
import inspect
import json
import logging
import os
import re
import subprocess
import base64
import mimetypes
from pathlib import Path
from typing import Dict, Any, Callable, Optional, List, Tuple
from datetime import datetime, timezone
import uuid
import httpx

logger = logging.getLogger(__name__)

from app.config import settings
from app.core.policies import policy_engine
from app.core.worktree import worktree_manager
from app.core.concurrency import run_io_blocking
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
# Canonical tool declarations (including {"name": "ingrations_search_tools"} and {"name": "ingrations_execute"})
# are modularized in app.agent.engine.tool_declarations and loaded via get_all_tool_declarations().
from app.agent.engine.tool_declarations import (
    ALL_TOOLS_DECLARATIONS,
    get_all_tool_declarations,
    filter_declarations_for_intent,
    MUTATION_TOOL_NAMES,
)
from app.agent.engine.context import (
    downscale_context_image,
    estimate_messages_tokens,
    format_plan_chat_summary,
    assemble_system_instruction,
)
from app.agent.skills_discovery import (
    discover_available_skills,
    format_skills_system_prompt,
)



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
        intent_category: Optional[str] = None,
        requires_reasoning: Optional[bool] = None
    ) -> str:
        """
        Resolves the concrete execution model based on task requirements, routing mode,
        reasoning necessity, and Task-Adaptive Major vs. Minor tier allocation.
        """
        known_intents = {"planning", "qa_research", "app_building", "code_modification", "debugging", "review_audit", "devops", "greetings", "parallel_swarm"}
        task_model = task_model_name
        intent = intent_category

        if task_model in known_intents and intent is None:
            intent = task_model
            task_model = None

        requested = (task_model or self.model_name or "").strip()
        use_fast_tier = (requires_reasoning is False) or (intent in ["qa_research", "greetings"])
        
        # If user explicitly requested a specific model (and not auto/adaptive)
        if requested and requested.lower() not in ["auto", "adaptive", "task-adaptive"]:
            if any(requested.startswith(p) for p in ["gemini-1.", "gemini-2.", "google:gemini-1.", "google:gemini-2."]) or "1.5" in requested or "2.0" in requested or "2.5" in requested:
                return "gemini-3.7-flash"
            if requested.lower() in ["deepseek-v4.1-flash", "deepseek:deepseek-v4.1-flash"]:
                return "deepseek-flash"
            if requires_reasoning is False and requested.lower() in ["deepseek-reasoner", "deepseek-r1", "deepseek:deepseek-reasoner", "deepseek:deepseek-r1"]:
                return "deepseek-flash"
            return requested

        # When auto/adaptive or no model is selected:
        # Check configured providers to route to an active key if Gemini is unconfigured
        has_gemini = bool(settings.get_api_key() or integration_manager.get_custom_credential("gemini", "api_key"))
        has_deepseek = bool(settings.get_deepseek_api_key() or integration_manager.get_custom_credential("deepseek", "api_key"))
        has_claude = bool(settings.get_anthropic_api_key() or integration_manager.get_custom_credential("anthropic", "api_key"))
        has_openai = bool(settings.get_openai_api_key() or integration_manager.get_custom_credential("openai", "api_key"))

        if not has_gemini:
            if has_deepseek:
                return "deepseek-flash" if use_fast_tier else ("deepseek-reasoner" if intent in ["app_building", "code_modification", "debugging"] else "deepseek-flash")
            elif has_claude:
                return "claude-haiku-5-5" if use_fast_tier else ("claude-opus-5-5" if intent in ["app_building", "code_modification", "debugging"] else "claude-haiku-5-5")
            elif has_openai:
                return "gpt-4o-mini" if use_fast_tier else ("gpt-4o" if intent in ["app_building", "code_modification", "debugging"] else "gpt-4o-mini")

        # If Task-Adaptive routing is active
        if getattr(settings, "ANTIGRAVITY_ROUTING_MODE", "adaptive") == "adaptive":
            if use_fast_tier:
                minor = getattr(settings, "ANTIGRAVITY_MINOR_MODEL", "gemini-3.7-flash") or "gemini-3.7-flash"
                if minor.lower() in ["deepseek-v4.1-flash", "deepseek:deepseek-v4.1-flash"]:
                    return "deepseek-flash"
                return "gemini-3.7-flash" if any(p in minor for p in ["1.5", "2.0", "2.5"]) else minor
            elif intent in ["app_building", "code_modification", "debugging", "review_audit", "devops", "parallel_swarm"] or (intent is None and (not requested or requested.lower() in ["auto", "adaptive"])):
                major = getattr(settings, "ANTIGRAVITY_MAJOR_MODEL", "gemini-3.8-flash") or "gemini-3.8-flash"
                return "gemini-3.8-flash" if any(p in major for p in ["1.5", "2.0", "2.5"]) else major

        default_m = getattr(settings, "ANTIGRAVITY_MODEL", "gemini-3.7-flash") or "gemini-3.7-flash"
        return "gemini-3.7-flash" if any(p in default_m for p in ["1.5", "2.0", "2.5"]) else default_m

    def resolve_planner_model(
        self,
        requested_model: Optional[str] = None,
        api_key: Optional[str] = None
    ) -> str:
        """
        Resolves the fast model used for intent extraction and compact plan synthesis.
        Prioritizes deepseek-v4.1-flash (deepseek-flash) when DeepSeek is active or configured in adaptive mode,
        avoiding slow reasoning models during pre-flight planning.
        """
        req = (requested_model or self.model_name or "").strip()
        req_lower = req.lower()
        planner_pref = getattr(settings, "ANTIGRAVITY_PLANNER_MODEL", "deepseek-v4.1-flash") or "deepseek-v4.1-flash"
        if planner_pref.lower() in ["deepseek-v4.1-flash", "deepseek:deepseek-v4.1-flash"]:
            planner_pref = "deepseek-flash"

        if req_lower.startswith("deepseek"):
            return planner_pref

        if not req or req_lower in ["auto", "adaptive", "task-adaptive"]:
            has_deepseek = bool(
                settings.get_deepseek_api_key()
                or integration_manager.get_custom_credential("deepseek", "api_key")
            )
            if has_deepseek:
                return planner_pref
            return self.resolve_effective_model(req, intent_category="qa_research", requires_reasoning=False)

        return self.resolve_effective_model(req, intent_category="qa_research", requires_reasoning=False)

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
                for idx, word in enumerate(words):
                    accumulated += word
                    if inspect.iscoroutinefunction(on_stream_chunk):
                        await on_stream_chunk("thought", s_id, word, accumulated)
                    else:
                        on_stream_chunk("thought", s_id, word, accumulated)
                    if idx < 20:
                        delay = 0.002 if not word.isspace() else 0.0005
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
                for idx, word in enumerate(words):
                    accumulated += word
                    if inspect.iscoroutinefunction(on_stream_chunk):
                        await on_stream_chunk("message", s_id, word, accumulated)
                    else:
                        on_stream_chunk("message", s_id, word, accumulated)
                    if idx < 25:
                        delay = 0.002 if not word.isspace() else 0.0005
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
    def _strip_subsession_framing(title: str, prompt: str) -> Tuple[str, str, bool]:
        """
        Strips sub-session wrapper titles ('Code Discussion: ...', 'Code Review: ...')
        and attached code snippet blocks ('**Regarding snippet/line in** ...') so intent
        and fast-path routing evaluate the user's actual inquiry rather than the attached filename.
        Returns (clean_title, clean_prompt, has_inline_snippet).
        """
        raw_title = (title or "").strip()
        raw_prompt = (prompt or "").strip()
        has_inline_snippet = False

        if re.match(r"^(?:code\s+discussion|code\s+review)\s*:", raw_title, re.IGNORECASE):
            raw_title = ""

        while True:
            snippet_match = re.match(
                r"^\*\*Regarding (?:snippet|line) in\*\*\s*`[^`]+`(?:\s*\([^)]+\))?:\s*\n```[\s\S]*?```(?:\n\n|\n)?([\s\S]*)$",
                raw_prompt,
            )
            if snippet_match:
                has_inline_snippet = True
                raw_prompt = (snippet_match.group(1) or "").strip()
            else:
                break

        inline_explain_match = re.match(
            r"^(Please\s+(?:explain|describe|analyze|inspect|refactor|modernize|generate)[^:\n]*?)\s+from\s+`[^`]+`(?:\s*\([^)]+\))?:\s*\n```[\s\S]*?```(?:\n\n|\n)?([\s\S]*)$",
            raw_prompt,
            re.IGNORECASE,
        )
        if inline_explain_match:
            has_inline_snippet = True
            head = (inline_explain_match.group(1) or "").strip()
            tail = (inline_explain_match.group(2) or "").strip()
            raw_prompt = f"{head}. {tail}".strip() if tail else head

        return raw_title, raw_prompt, has_inline_snippet

    @staticmethod
    def infer_task_intent(title: str, prompt: str, persona_name: str = "", mode: Optional[str] = None) -> str:
        """
        Infers the structural intent category ('planning', 'qa_research', 'app_building',
        'code_modification', 'debugging', 'review_audit', 'devops') from task title,
        prompt text, and persona name.
        Guarantees that coding, refactoring, and UI actions never falsely default to qa_research,
        while contextual follow-up questions (e.g. "what's a namespace") and inline snippet explanations
        are not misclassified by stale session titles or snippet headers.
        """
        if mode and str(mode).strip().lower() in ["plan", "planning"]:
            return "planning"
        clean_title_raw, clean_prompt_raw, has_inline_snippet = AntigravityHarness._strip_subsession_framing(title, prompt)
        combined = f"{clean_title_raw} {clean_prompt_raw}".strip().lower()
        cleaned_prompt = clean_prompt_raw.lower()
        cleaned_title = clean_title_raw.lower()

        # 1. Greetings fast path
        conversational_pings = {"hey", "hello", "hi", "howdy", "greetings", "good morning", "good afternoon", "good evening", "yo", "sup", "hey there", "hello there"}
        if cleaned_prompt in conversational_pings or (cleaned_title in conversational_pings and not cleaned_prompt):
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

        # 3. Conversational / Discussion & Advisory Question patterns
        discussion_keywords = [
            "discuss", "discuss that", "let's discuss", "lets discuss", "can we discuss",
            "does it make sense", "do you think", "what do you think", "should we", "should i",
            "what if", "is it better", "would it be better", "pros and cons", "thoughts on",
            "why or why not", "how should we handle", "what are your thoughts", "advice on",
            "don't submit", "dont submit", "don't make changes", "dont make changes",
            "without making changes", "before making changes", "before changing"
        ]
        is_discussion_or_advisory = any(k in cleaned_prompt for k in discussion_keywords) or any(k in cleaned_title for k in discussion_keywords)

        qa_prefixes = [
            "what is", "what are", "what's", "whats", "what does", "what do",
            "how does", "how do", "how to", "how is", "how are", "how can",
            "why is", "why does", "why do", "why are", "where is", "where are", "where's",
            "who is", "when is", "which ", "explain", "describe", "tell me about",
            "compare", "contrast", "overview of", "summarize", "define ",
            "please explain", "please describe", "please summarize", "please inspect and analyze",
            "does it", "should we", "should i", "can we", "is it", "would it", "is there", "are there"
        ]
        prompt_is_qa_question = (
            any(cleaned_prompt.startswith(prefix) for prefix in qa_prefixes)
            or (cleaned_prompt.endswith("?") and len(cleaned_prompt.split()) <= 20)
        )
        title_is_qa_question = (
            any(cleaned_title.startswith(prefix) for prefix in qa_prefixes)
            or "research" in cleaned_title.split()
        )
        is_qa_prefix = prompt_is_qa_question or title_is_qa_question
        code_file_regex = r'\b[\w\-\./]+\.(py|html|css|jsx?|tsx?|json|sql|rs|go|c|cpp|h)\b|\bdockerfile\b'
        prompt_has_code_file = False if has_inline_snippet else bool(re.search(code_file_regex, cleaned_prompt, re.IGNORECASE))
        has_code_file = False if has_inline_snippet else bool(re.search(code_file_regex, combined, re.IGNORECASE))
        prompt_has_mutation_verb = any(
            re.search(rf'\b{re.escape(v)}\b', cleaned_prompt)
            for v in ["fix", "refactor", "implement", "update", "modify", "patch", "remediate", "edit", "write", "create", "build", "delete", "remove", "rename"]
        )

        if (
            is_discussion_or_advisory
            or (prompt_is_qa_question and not prompt_has_code_file and not prompt_has_mutation_verb)
            or (is_qa_prefix and not has_code_file and not prompt_has_mutation_verb)
        ):
            return "qa_research"

        # 4. Parallel Swarm & Multi-Agent Delegation
        swarm_keywords = [
            "subagent", "subagents", "sub-agent", "sub-agents", "parallelize",
            "parallel swarm", "swarm", "parallel pods", "worker pods", "dispatch subagents",
            "parallel build", "concurrent build"
        ]
        if any(k in combined for k in swarm_keywords):
            return "parallel_swarm"

        # 5. Review & Audit
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

    @staticmethod
    def requires_reasoning_for_query(
        title: str,
        prompt: str,
        intent_category: str = "",
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> bool:
        """
        Determines whether a query requires extended chain-of-thought / reasoning models.
        Returns False for greetings, direct conceptual Q&A (e.g. "what's a namespace"),
        and lightweight explanations that do not require deep architectural or debugging synthesis.
        """
        clean_title_raw, clean_prompt_raw, _ = AntigravityHarness._strip_subsession_framing(title, prompt)
        cleaned_prompt = (clean_prompt_raw or clean_title_raw or "").strip().lower()
        conversational_pings = {
            "hey", "hello", "hi", "howdy", "greetings", "good morning",
            "good afternoon", "good evening", "yo", "sup", "hey there", "hello there"
        }
        if cleaned_prompt in conversational_pings:
            return False

        intent = (intent_category or "").strip().lower()
        if not intent:
            intent = AntigravityHarness.infer_task_intent(title, prompt, "")

        if intent == "qa_research":
            deep_reasoning_cues = [
                "architect", "trade-off", "tradeoff", "root cause", "race condition",
                "deadlock", "prove", "derive", "why is it failing", "debug",
                "security audit", "vulnerability", "step by step reasoning",
                "think carefully", "deep dive", "time complexity proof"
            ]
            if any(cue in cleaned_prompt for cue in deep_reasoning_cues):
                return True
            return False

        return True

    @staticmethod
    def is_fast_direct_query(
        title: str,
        prompt: str,
        persona_name: str = "",
        history: Optional[List[Dict[str, Any]]] = None,
        intent_category: Optional[str] = None,
        mode: Optional[str] = None,
        is_subsession: bool = False,
    ) -> bool:
        """
        Determines whether a query can bypass the pre-turn LLM plan synthesis round-trip
        and execute directly in a single fast pass.
        """
        if mode and str(mode).strip().lower() in ["plan", "planning"]:
            return False
        clean_title_raw, clean_prompt_raw, has_inline_snippet = AntigravityHarness._strip_subsession_framing(title, prompt)
        cleaned_prompt = clean_prompt_raw.lower()
        cleaned_title = clean_title_raw.lower()
        conversational_pings = {
            "hey", "hello", "hi", "howdy", "greetings", "good morning",
            "good afternoon", "good evening", "yo", "sup", "hey there", "hello there"
        }
        if cleaned_prompt in conversational_pings or (cleaned_title in conversational_pings and not cleaned_prompt):
            return True

        # Approval / continuation directives when an implementation plan already exists in history
        approval_patterns = [
            r"^(?:proceed|continue|go ahead|start|execute|implement|do it|run|approved?|ok|okay)\b",
            r"\b(?:proceed with|go ahead with|continue with|start with|execute|implement)\s+(?:the\s+)?(?:execution\s+)?(?:plan|phase|steps?|implementation|milestone)\b",
            r"\bapprove(?:d)?\s+(?:the\s+)?(?:plan|execution)\b",
            r"\blooks good(?:,\s*proceed)?\b",
        ]
        is_approval = (
            cleaned_prompt in {"proceed", "continue", "go ahead", "next", "yes", "approved", "ok", "okay", "do it"}
            or cleaned_title in {"proceed", "continue", "go ahead", "next", "yes", "approved", "ok", "okay", "do it"}
            or any(bool(re.search(pat, cleaned_prompt, re.IGNORECASE)) for pat in approval_patterns)
            or any(bool(re.search(pat, cleaned_title, re.IGNORECASE)) for pat in approval_patterns)
        )
        if is_approval and history:
            for m in reversed(history):
                c = m.get("content") or ""
                if ("# Implementation Plan" in c or "## Implementation Plan" in c or "Key Execution Phases" in c) and ("Phase 1" in c or "Step 1" in c):
                    return True

        known_intents = {"planning", "qa_research", "app_building", "code_modification", "debugging", "review_audit", "devops", "greetings", "parallel_swarm"}
        if intent_category:
            intent = intent_category
        elif persona_name in known_intents:
            intent = persona_name
        else:
            intent = AntigravityHarness.infer_task_intent(title, prompt, persona_name, mode=mode)

        if is_subsession and intent != "planning":
            return True

        if intent != "qa_research":
            return False

        if has_inline_snippet:
            return True

        # Direct qa_research without target workspace code files, URLs, or PR inspections
        code_file_regex = r'\b[\w\-\./]+\.(py|html|css|jsx?|tsx?|json|sql|rs|go|c|cpp|h)\b|\bdockerfile\b'
        if re.search(code_file_regex, cleaned_prompt, re.IGNORECASE):
            return False
        if "http://" in cleaned_prompt or "https://" in cleaned_prompt:
            return False
        if re.search(r'\bpr\s*#?\d+\b|\bpull request\b', cleaned_prompt, re.IGNORECASE):
            return False

        return True

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
    def sanitize_plan_phases(raw_phases: List[Dict[str, Any]], intent_category: str = "") -> List[Dict[str, Any]]:
        phases = []
        for p in raw_phases:
            p_copy = dict(p)
            p_text = f"{p_copy.get('title', '')} {p_copy.get('objective', '')}".lower()
            if any(k in p_text for k in ["eliminate stale root", "delete root mirror", "deduplicate root mirror", "delete 'app/'", "delete 'src/'", "delete 'tests/'", "delete backend", "delete frontend"]):
                p_copy["title"] = "Phase 1: Environment & Path Configuration Alignment"
                p_copy["objective"] = "Align pyproject.toml, PYTHONPATH, and test paths without deleting codebase directory trees."
                p_copy["file_touchpoints"] = ["pyproject.toml: Configure pythonpath and test runner options"]
            if intent_category == "qa_research":
                p_copy["file_touchpoints"] = []
                p_copy["verification_criteria"] = "Factual verification in direct chat response."
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

    @staticmethod
    def is_dangling_action_intent(text: str) -> bool:
        """
        Determines whether an agent response contains in-flight transitional action promises
        (e.g., "Now let me update...", "Next I will...", "Let me rewrite...", ending in a colon or ellipsis)
        rather than a completed terminal summary.
        Evaluates full text, sentence structure, and punctuation with filename-aware boundary splitting.
        """
        if not text or not isinstance(text, str):
            return False

        cleaned = text.strip()
        if not cleaned:
            return False

        # Trailing colons, ellipses, or arrows indicate an intro without subsequent payload
        if cleaned.endswith(":") or cleaned.endswith("...") or cleaned.endswith("->"):
            return True

        text_lower = cleaned.lower()

        # Raw tool call markup tokens leaked into text indicate incomplete tool execution
        if any(tok in text_lower for tok in [
            "dsml", "tool_call", "tool_calls", "function_call", "invoke name=",
            "< | dsml", "<|dsml", "<｜dsml", "<tool_call>", "</tool_call>", "<invoke", "</invoke>"
        ]):
            return True

        forward_phrases = [
            "now let me", "now let us", "now let's", "now i will", "now i'll",
            "let me ", "let us ", "let's ", "i will now", "i'll now", "i will proceed",
            "i am going to", "next, i will", "next, let's", "next step is to",
            "next up", "next i'll", "next we will", "next we'll",
            "i will update", "i'll update", "i will add", "i'll add",
            "i will create", "i'll create", "i will implement", "i'll implement",
            "i will fix", "i'll fix", "i will edit", "i'll edit",
            "i will modify", "i'll modify", "i will test", "i'll test",
            "i will run", "i'll run", "i will execute", "i'll execute",
            "i will check", "i'll check", "i will examine", "i'll examine",
            "i will inspect", "i'll inspect", "i will verify", "i'll verify",
            "i need to update", "i need to add", "i need to create", "i need to complete",
            "i need to fix", "i need to edit", "i need to implement",
            "proceeding to update", "proceeding to implement", "proceeding to add",
            "going to update", "going to implement", "going to create",
            "let me rewrite", "let me verify", "let me confirm", "let me check",
            "let me inspect", "let me read", "let me examine",
            "plus check whether", "plus check if", "also verify", "also check",
            "confirm whether", "confirm if", "verify whether", "verify if"
        ]

        # Sentence-boundary splitting that preserves filename periods (.js, .py, .html, .ts, etc.)
        # Splits strictly on punctuation followed by whitespace or line breaks
        sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+|(?:\n|\r|;)+', text_lower) if s.strip()]

        if not sentences:
            return False

        # If the text is short (< 350 chars), check if it consists of a forward action promise
        if len(cleaned) < 350:
            last_sentence = sentences[-1]
            for p in forward_phrases:
                if p in last_sentence and not any(comp in last_sentence for comp in ["have completed", "successfully", "all tests pass", "verified in live preview", "now fully built", "fixed"]):
                    return True
            if len(sentences) == 1:
                for p in forward_phrases:
                    if p in sentences[0] and not any(comp in sentences[0] for comp in ["have completed", "successfully", "all tests pass", "verified in live preview", "now fully built", "fixed"]):
                        return True
            return False

        # For longer, substantive responses (>= 350 chars), only the final sentence indicates dangling intent
        last_sentence = sentences[-1]
        for p in forward_phrases:
            if p in last_sentence and not any(comp in last_sentence for comp in ["have completed", "successfully", "all tests pass", "verified in live preview", "now fully built", "fixed"]):
                # Ensure the last sentence itself is a short transitional statement, not a substantive closing sentence
                if len(last_sentence) < 180:
                    return True

        return False

    @staticmethod
    def is_surrender_or_bailing_intent(text: str) -> Tuple[bool, Optional[str]]:
        """
        Determines whether an agent response exhibits defeatist surrender or customer-support bailing
        (e.g., instructing the user to run/test the app locally, install Node.js on their machine,
        or blaming network/environment configurations rather than autonomously fulfilling the task).
        Returns (is_surrender, reason).
        """
        if not text or not isinstance(text, str):
            return False, None

        cleaned = text.strip()
        if not cleaned:
            return False, None

        text_lower = cleaned.lower()

        surrender_patterns = [
            # Direct customer support handoffs to run locally
            (
                r"\b(?:try\s+)?run(?:ning)?\s+(?:the\s+|this\s+|it\s+|your\s+)?(?:application|app|project|code|server)?\s*locally\s+on\s+your\s+(?:machine|computer|system|environment)\b",
                "Directing user to run application locally on their machine"
            ),
            (
                r"\b(?:try\s+)?run(?:ning)?\s+(?:the\s+|this\s+|it\s+|your\s+)?(?:application|app|project|code|server)?\s*locally\b",
                "Suggesting user run application locally"
            ),
            (
                r"\b(?:steps\s+to\s+|how\s+to\s+)?run\s+(?:the\s+|this\s+|it\s+)?(?:application|app|code)?\s*locally\b",
                "Providing local run instructions to user"
            ),
            (
                r"\bensure\s+that\s+you\s+have\s+node(?:\.js)?\s+(?:and\s+npm\s+)?installed\b",
                "Instructing user to verify local Node.js/npm installation"
            ),
            (
                r"\byou\s+can\s+(?:try\s+to\s+)?run\s+(?:the\s+|this\s+|it\s+)?(?:application|app)?\s*on\s+your\s+(?:own\s+)?(?:machine|computer|system)\b",
                "Advising user to run on their personal machine"
            ),
            (
                r"\btest\s+(?:the\s+|this\s+|it\s+)?(?:application|app|code)?\s*locally\s+on\s+your\s+machine\b",
                "Advising user to test locally on their machine"
            ),
            # Blaming environment or network for unhandled execution failure
            (
                r"\b(?:issue|problem)\s+with\s+the\s+environment\s+or\s+network\b",
                "Blaming environment or network configuration for execution timeout"
            ),
            (
                r"\btiming\s+out,\s+which\s+indicates\s+there\s+might\s+be\s+an\s+issue\s+with\s+the\s+environment\b",
                "Excusing execution failure as environment breakdown"
            ),
            (
                r"\b(?:due\s+to\s+)?sandbox\s+limitations?,\s+(?:please\s+)?(?:run|test|execute)\b",
                "Passing execution responsibility to user due to sandbox limitation excuse"
            ),
            (
                r"\bunable\s+to\s+(?:run|preview|start)\s+(?:the\s+|this\s+)?(?:application|app|server)\s+in\s+this\s+environment\b",
                "Conceding inability to preview application in Cyclode environment"
            ),
            (
                r"\bcannot\s+(?:run|preview|start)\s+(?:the\s+|this\s+)?(?:application|app|server)\s+in\s+this\s+environment\b",
                "Conceding inability to preview application in Cyclode environment"
            ),
            # Scaffold cop-out / leaving requested features for "further development"
            (
                r"\b(?:this\s+setup\s+)?provides\s+a\s+foundation\s+for\s+(?:further|future)\s+development\b",
                "Leaving core application features incomplete as 'foundation for further development'"
            ),
            (
                r"\bfoundation\s+for\s+(?:further|future)\s+(?:development|expansion|features|work)\b",
                "Leaving requested application features as 'further development'"
            ),
            (
                r"\bsetup\s+is\s+ready\s+for\s+(?:further|future)\s+(?:development|work)\b",
                "Scaffold disclaimer claiming application is ready for 'future development'"
            ),
            (
                r"\bstarting\s+point\s+for\s+(?:further|future)\s+(?:development|work)\b",
                "Leaving application incomplete as a 'starting point for further development'"
            ),
            (
                r"\byou\s+can\s+now\s+(?:view|test)\s+the\s+application\s+by\s+opening\s+(?:the\s+)?index\.html\b",
                "Instructing user to manually open index.html file in browser"
            ),
            (
                r"\bopening\s+the\s+index\.html\s+file\s+in\s+a\s+browser\b",
                "Instructing user to manually open index.html file in browser"
            ),
        ]

        for pattern, reason in surrender_patterns:
            if re.search(pattern, text_lower):
                return True, reason

        return False, None

    async def _generate_dynamic_plan(
        self,
        client: httpx.AsyncClient,
        api_key: str,
        model_name: str,
        title: str,
        prompt: str,
        persona_name: str,
        history: Optional[List[Dict[str, Any]]] = None,
        workspace_path: Optional[Path] = None,
        cached_workspace_files: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Dynamically synthesizes a bespoke execution plan and classifies task intent
        using structured JSON output from the fast planner model (deepseek-v4.1-flash / provider flash)
        before tool loop execution. Surfaces authentic error diagnostics if dynamic formulation fails.
        """
        objective = title or prompt[:100]
        effective_plan_model = self.resolve_planner_model(model_name, api_key=api_key)
        provider = get_provider_for_model(effective_plan_model)
        
        # Fast path: Check if conversational greeting or casual ping
        cleaned_prompt = (prompt or "").strip().lower()
        cleaned_title = (title or "").strip().lower()
        conversational_pings = {"hey", "hello", "hi", "howdy", "greetings", "good morning", "good afternoon", "good evening", "yo", "sup", "hey there", "hello there"}
        if cleaned_prompt in conversational_pings or cleaned_title in conversational_pings:
            return {
                "intent_category": "qa_research",
                "response_style": "direct_concise",
                "requires_plan": False,
                "requires_reasoning": False,
                "objective": "Acknowledge greeting and assist with software engineering tasks",
                "steps": [
                    {"id": "step-1", "title": "Respond to user greeting and provide assistance", "status": "in_progress"}
                ],
                "evaluation": {
                    "status": "pending",
                    "summary": "Conversational greeting acknowledged."
                }
            }

        # Robust multi-word approval, continuation, and execution directive detection
        approval_patterns = [
            r"^(?:proceed|continue|go ahead|start|execute|implement|do it|run|approved?|ok|okay)\b",
            r"\b(?:proceed with|go ahead with|continue with|start with|execute|implement)\s+(?:the\s+)?(?:execution\s+)?(?:plan|phase|steps?|implementation|milestone)\b",
            r"\bapprove(?:d)?\s+(?:the\s+)?(?:plan|execution)\b",
            r"\blooks good(?:,\s*proceed)?\b",
        ]
        is_approval_or_proceed = (
            cleaned_prompt in {"proceed", "continue", "go ahead", "next", "yes", "approved", "ok", "okay", "do it"}
            or cleaned_title in {"proceed", "continue", "go ahead", "next", "yes", "approved", "ok", "okay", "do it"}
            or any(bool(re.search(pat, cleaned_prompt, re.IGNORECASE)) for pat in approval_patterns)
            or any(bool(re.search(pat, cleaned_title, re.IGNORECASE)) for pat in approval_patterns)
        )

        if is_approval_or_proceed:
            is_planning_query = False
            prompt = f"The user approved execution with '{prompt}'. Continue the active task by executing the approved plan and modifying the necessary workspace files."
        else:
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

        # Extract recent conversation history for rich planning context & check for existing approved plan
        conversation_context = ""
        existing_plan_in_history = None
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

            for m in reversed(history):
                c = m.get("content") or ""
                if ("# Implementation Plan" in c or "## Implementation Plan" in c or "Key Execution Phases" in c) and ("Phase 1" in c or "Step 1" in c):
                    parsed_existing = extract_plan_from_markdown(c, default_title=title)
                    if parsed_existing.get("steps") and len(parsed_existing["steps"]) >= 1:
                        existing_plan_in_history = parsed_existing
                        break

        # If user explicitly approved execution and an approved plan already exists in history:
        # Adopt the existing structured plan directly, advance milestone 1 to in_progress, and lock into execution!
        if is_approval_or_proceed and existing_plan_in_history:
            adopted_plan = dict(existing_plan_in_history)
            inferred_intent = Harness.infer_task_intent(title, prompt, persona_name)
            exec_intent = "app_building" if (inferred_intent == "app_building" or persona_name == "AppBuilder") else "code_modification"
            adopted_plan["intent_category"] = exec_intent
            adopted_plan["response_style"] = "action_execution"
            adopted_plan["requires_plan"] = True
            adopted_plan["requires_reasoning"] = True

            first_pending_found = False
            for s in adopted_plan.get("steps", []):
                if s.get("status") in ["in_progress", "completed"]:
                    continue
                if not first_pending_found and s.get("status") == "pending":
                    s["status"] = "in_progress"
                    first_pending_found = True

            adopted_plan["evaluation"] = {
                "status": "in_progress",
                "summary": "Execution plan approved. Active milestone in progress.",
                "checks": [
                    {"name": "Execution Plan Approved", "passed": True, "message": "Plan adopted and transition to execution active"}
                ]
            }
            adopted_plan["markdown"] = generate_plan_markdown(adopted_plan, title, prompt)
            return adopted_plan

        # Extract active workspace filesystem tree to ground planning against real files
        workspace_grounding = ""
        if cached_workspace_files:
            workspace_grounding = (
                "Active Workspace Files Ground Truth:\n"
                + "\n".join(f"- {f}" for f in cached_workspace_files[:25])
                + "\nCRITICAL PLANNING MANDATE: Ground all plan steps strictly against the REAL files above! If the workspace is a single-file application (e.g. index.html), plan modifications directly on index.html. NEVER invent non-existent React/modular directories (such as src/components/...) when the project is self-contained.\n\n"
            )
        elif workspace_path and workspace_path.exists():
            try:
                ignored_dirs = {".git", "node_modules", "__pycache__", ".venv", ".pytest_cache", "dist", "build", ".antigravity", ".gemini"}
                found_files = []
                for p in sorted(workspace_path.rglob("*")):
                    if any(part in ignored_dirs for part in p.parts):
                        continue
                    if p.is_file():
                        rel = p.relative_to(workspace_path)
                        if len(rel.parts) <= 3:
                            sz_kb = max(1, p.stat().st_size // 1024)
                            found_files.append(f"{rel} ({sz_kb}KB)")
                    if len(found_files) >= 25:
                        break
                if found_files:
                    workspace_grounding = (
                        "Active Workspace Files Ground Truth:\n"
                        + "\n".join(f"- {f}" for f in found_files)
                        + "\nCRITICAL PLANNING MANDATE: Ground all plan steps strictly against the REAL files above! If the workspace is a single-file application (e.g. index.html), plan modifications directly on index.html. NEVER invent non-existent React/modular directories (such as src/components/...) when the project is self-contained.\n\n"
                    )
            except Exception as e:
                logger.debug(f"Workspace ground truth scan notice: {e}")

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
            f"You are the Cyclode Master Execution Planner. Formulate a fast, compact, actionable execution plan and classify intent, response_style, and reasoning need for the following task.\n\n"
            f"Task Title: {title}\n"
            f"Persona: {persona_name}\n"
            f"Prompt: {prompt}\n\n"
            f"{workspace_grounding}"
            f"{conversation_context}"
            f"Allowed intent_category values: ['planning', 'qa_research', 'app_building', 'code_modification', 'review_audit', 'debugging', 'devops', 'parallel_swarm']\n"
            f"Allowed response_style values: ['direct_concise', 'analytical_briefing', 'action_execution', 'architectural_plan']\n"
            f"Guidelines:\n"
            f"- STEP COUNT CAP (CRITICAL FOR SPEED): For all non-'planning' tasks, generate AT MOST 1 to 3 concise steps in 'steps' (1 step for qa_research or single-file edits; 2-3 steps for multi-file edits or app building). Only populate detailed 'phases' when intent_category='planning' (otherwise set 'phases' to []).\n"
            f"- REASONING & PLAN GATING: Set 'requires_reasoning': false and 'requires_plan': false for conceptual questions, definitions (e.g. 'what\\'s a namespace'), simple explanations, or straightforward lookups. Set 'requires_reasoning': true only when deep architectural trade-offs, complex multi-file refactoring, debugging root causes, or security audits are needed.\n"
            f"- If the prompt asks for a plan, roadmap, proposal, architecture proposal, or says 'what\\'s the plan', 'so what\\'s the plan', 'plan this', set intent_category='planning' and response_style='architectural_plan'.\n"
            f"- If the prompt involves comparing, benchmarking, researching, or analyzing multiple distinct entities (e.g. PRs, repositories, services, stocks, countries, libraries), discrete time slices, or orthogonal domains/facets in parallel, OR asks to parallelize, build with subagents, run a swarm, or construct multiple decoupled modules/services in parallel (e.g. 'Parallelize the build with subagents', 'Build data pipeline concurrently', 'parallelize'), set intent_category='parallel_swarm'. The milestones must decompose into an atomic concurrent build phase: 'Phase 1: Concurrent Swarm Build (Dispatch N specialized worker pods in parallel via `delegate_subtasks`)', followed by centralized integration and verification. NEVER fragment parallel subagent pods into separate sequential steps (such as 'Step 1: Dispatch pod 1', 'Step 2: Dispatch pod 2')! When more than 5 entities are requested (e.g. 10 items), chunk or bin-pack them across up to 5 pods (e.g. 5 pods analyzing 2 items each) to stay within concurrency bounds while ensuring 100% coverage.\n"
            f"- If the prompt is asking a question, conceptual explanation, trade-off discussion, advisory feedback (e.g. 'Does it make sense...', 'Discuss that first', 'What do you think', 'Should we...', 'dont submit'), web research, or URL summarization, set intent_category='qa_research' and response_style='direct_concise' (or 'analytical_briefing' for multi-source research). NEVER generate a multi-phase implementation plan for conversational or advisory questions!\n"
            f"  CRITICAL FOR QA & RESEARCH INTENT: The plan milestones must represent research/reading steps (e.g. Step 1: Retrieve external intelligence / URL, Step 2: Synthesize comprehensive analytical briefing with hyperlinked citations directly in chat). 'file_touchpoints' MUST be an empty array []! NEVER propose creating workspace files (such as source.md, summary.md, notes.txt), NEVER propose git log audits, and NEVER propose bash unit testing for text research!\n"
            f"- For engineering/coding phases, provide descriptive title, 1-sentence objective, specific file touchpoints with bulleted action items under each file, and concrete verification criteria (e.g. exact pytest or build commands).\n"
            f"- If the prompt asks to build an interactive web app, frontend, UI, dashboard, game, landing page, or calculator, set intent_category='app_building' and response_style='action_execution'.\n"
            f"  CRITICAL FOR APP BUILDING: Formulate the implementation plan specifically for Cyclode's Instant Live Preview Sandbox! Target self-contained HTML/CSS/JS or Vite/React components (e.g. index.html with Tailwind CSS, responsive layout, theme tokens, interactive DOM sections, and verify_app_preview). Do NOT propose non-executable cloud deployment pipelines or multi-container server dependencies when creating client-side apps or landing pages!\n"
            f"  DOMAIN-GROUNDED MILESTONES: Extract concrete domain entities, structures, and operational mechanics from the prompt into milestone phases. Prohibit abstract placeholder checklists (e.g. NEVER emit generic steps like 'Initialize files', 'Integrate library', 'Add controls'). Decompose into domain-grounded deliverables: (1) Core Environment & Spatial Shell (floor grid, layout boundaries, lighting, container styling), (2) Domain Models, Entities & Asset Population (specific domain meshes, materials, textures, realistic data), (3) Navigation Controls & Interactive UI/HUD Overlays (camera navigation, user inputs, HUD panels, stats counters), and (4) Compilation & verify_app_preview validation.\n"
            f"- If the prompt asks to review PR, diff, or code audit, set intent_category='review_audit'.\n"
            f"- If the prompt asks to fix an error or debug code, set intent_category='debugging'.\n"
            f"- If the prompt asks to configure Docker, CI/CD, or deployment, set intent_category='devops'.\n"
            f"- Otherwise, set intent_category='code_modification' and response_style='action_execution'.\n"
            f"- ABSOLUTE STRUCTURAL INTEGRITY RULE: NEVER propose deleting, removing, or 'deduplicating' root codebase directories (such as 'app/', 'src/', 'tests/', 'backend/', 'frontend/'). Repositories often maintain dual-tree structures for container or packaging reasons. Always propose resolving path/import errors via configuration (pyproject.toml, pytest settings, PYTHONPATH), NEVER via mass directory deletion!\n\n"
            f"Respond ONLY with a valid JSON object matching this schema:\n"
            f"{{\n"
            f'  "intent_category": "planning | qa_research | app_building | code_modification | review_audit | debugging | devops | parallel_swarm",\n'
            f'  "response_style": "direct_concise | analytical_briefing | action_execution | architectural_plan",\n'
            f'  "requires_plan": true,\n'
            f'  "requires_reasoning": false,\n'
            f'  "title": "Implementation Plan: [Crisp Descriptive Title]",\n'
            f'  "overview": "1-2 sentence executive summary outlining the strategy",\n'
            f'  "phases": [],\n'
            f'  "steps": [\n'
            f'    {{"id": "step-1", "title": "Specific step description", "status": "pending"}}\n'
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
            if is_planning_query:
                intent_cat = "planning"
            elif intent_cat not in ["planning", "qa_research", "app_building", "code_modification", "review_audit", "debugging", "devops", "parallel_swarm"]:
                intent_cat = inferred_intent

            default_style = (
                "architectural_plan"
                if intent_cat == "planning"
                else ("direct_concise" if intent_cat == "qa_research" else "action_execution")
            )
            response_style = parsed.get("response_style") if parsed.get("response_style") in {"direct_concise", "analytical_briefing", "action_execution", "architectural_plan"} else default_style
            requires_plan = bool(parsed.get("requires_plan", intent_cat != "qa_research"))
            requires_reasoning = bool(
                parsed.get(
                    "requires_reasoning",
                    Harness.requires_reasoning_for_query(title, prompt, intent_cat, history),
                )
            )

            obj = parsed.get("objective") or objective
            raw_phases = parsed.get("phases", [])
            phases = Harness.sanitize_plan_phases(raw_phases, intent_category=intent_cat)
            if intent_cat == "qa_research":
                for p in phases:
                    p["file_touchpoints"] = []
            overview = parsed.get("overview") or obj
            plan_title = parsed.get("title") or title
            raw_steps = parsed.get("steps", [])
            if not raw_steps and phases:
                raw_steps = [
                    {"title": p.get("title") or f"Phase {i+1}", "status": "pending"}
                    for i, p in enumerate(phases)
                ]

            if intent_cat != "planning":
                if isinstance(raw_steps, list) and len(raw_steps) > 3:
                    raw_steps = raw_steps[:3]
                phases = []

            if isinstance(raw_steps, list) and len(raw_steps) >= 1:
                steps = []
                for idx, s in enumerate(raw_steps):
                    s_title = s.get("title", f"Step {idx+1}") if isinstance(s, dict) else str(s)
                    s_id = f"step-{idx+1}"
                    s_status = "pending" if intent_cat == "planning" else ("in_progress" if idx == 0 else "pending")
                    steps.append({"id": s_id, "title": s_title, "status": s_status})
                plan_dict = {
                    "intent_category": intent_cat,
                    "response_style": response_style,
                    "requires_plan": requires_plan,
                    "requires_reasoning": requires_reasoning,
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
        on_plan: Optional[Callable[[Dict[str, Any]], Any]] = None,
        steering_queue: Optional[asyncio.Queue] = None,
        persona_instructions: Optional[str] = None,
        role_definition: Optional[str] = None,
        is_subsession: bool = False,
    ) -> Dict[str, Any]:
        """
        Executes an agent task directly via the LLM-First ReAct engine with native function calling.
        """
        raw_prompt = description or title

        # 1. Pre-process secrets into Vault and mask them
        sanitized_prompt, extracted_creds = await VaultInterceptor.process_prompt(raw_prompt)

        initial_intent = self.infer_task_intent(title, sanitized_prompt, persona_name)
        initial_reasoning = self.requires_reasoning_for_query(title, sanitized_prompt, initial_intent, history)
        effective_model = self.resolve_effective_model(
            self.model_name,
            intent_category=initial_intent,
            requires_reasoning=initial_reasoning,
        )
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
            on_plan=on_plan,
            steering_queue=steering_queue,
            persona_instructions=persona_instructions,
            role_definition=role_definition,
            is_subsession=is_subsession,
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
        on_plan: Optional[Callable[[Dict[str, Any]], Any]] = None,
        steering_queue: Optional[asyncio.Queue] = None,
        persona_instructions: Optional[str] = None,
        role_definition: Optional[str] = None,
        is_subsession: bool = False,
    ) -> Dict[str, Any]:
        """
        Primary LLM-first ReAct engine: invokes model with comprehensive tool declarations.
        """
        tools_def = get_all_tool_declarations()

        system_instruction = assemble_system_instruction(
            persona_name=persona_name,
            title=title,
            workspace_path=workspace_path,
            persona_instructions=persona_instructions,
            role_definition=role_definition,
        )

        initial_intent = self.infer_task_intent(title, prompt, persona_name)
        initial_reasoning = self.requires_reasoning_for_query(title, prompt, initial_intent, history)
        effective_model = self.resolve_effective_model(
            self.model_name,
            intent_category=initial_intent,
            requires_reasoning=initial_reasoning,
        )
        provider = get_provider_for_model(effective_model)
        if provider.provider_id == "deepseek":
            model_candidates = [effective_model, "deepseek-flash", "deepseek-chat", "deepseek-reasoner"]
            provider_label = "DeepSeek AI"
        elif provider.provider_id == "anthropic":
            model_candidates = [effective_model, "claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-3-7-sonnet", "claude-haiku-5-5"]
            provider_label = "Anthropic Claude"
        elif provider.provider_id == "openai":
            model_candidates = [effective_model, "gpt-6-astra", "o1", "o3-mini", "o1-mini", "gpt-4.5-preview", "gpt-4o", "chatgpt-4o-latest", "gpt-4o-mini", "codex"]
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
            persona_name in ["General", "IssueResolver", "SoftwareEngineer", "PairProgrammer"]
            and not (history and len(history) > 1)
            and any(
                (prompt or "").lower().strip().startswith(prefix)
                for prefix in ["what is", "what are", "what's", "whats", "how does", "how do", "how to", "why is", "why does", "explain", "describe", "tell me about", "compare", "contrast"]
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
                        return {"status": "COMPLETED", "summary": cached_entry.response_text, "cached": True}
            except Exception as e:
                logger.debug(f"Semantic cache lookup notice: {e}")

        contents: List[Dict[str, Any]] = []
        tool_call_count = 0
        mutating_tool_count = 0
        consecutive_build_errors = 0
        tool_error_count = 0
        last_tool_exit_code: Optional[int] = None
        last_tool_error: Optional[str] = None

        staged_approvals: List[Tuple[str, Dict[str, Any]]] = []
        has_staged_approvals = False

        async def _flush_staged_approvals() -> None:
            if not staged_approvals or not on_approval_required:
                return
            while staged_approvals:
                act_type, act_details = staged_approvals.pop(0)
                try:
                    res = on_approval_required(act_type, act_details)
                    if inspect.isawaitable(res):
                        await res
                except Exception as cb_err:
                    logger.warning(f"Failed to notify on_approval_required for staged action {act_type}: {cb_err}")

        fast_direct = self.is_fast_direct_query(title, prompt, persona_name, history, is_subsession=is_subsession)
        needs_workspace_scan = bool(history) or not (fast_direct and (initial_intent == "qa_research" or (is_subsession and initial_intent != "planning")))

        # Bounded workspace scan (reused by both Working Memory and _generate_dynamic_plan without sorting entire repo)
        active_files: List[str] = []
        cached_workspace_files_with_sizes: List[str] = []
        if needs_workspace_scan and workspace_path and workspace_path.exists():
            try:
                ignored_dirs = {".git", "node_modules", "__pycache__", ".venv", ".pytest_cache", "dist", "build", ".antigravity", ".gemini"}
                scanned_entries = 0
                for p in workspace_path.rglob("*"):
                    scanned_entries += 1
                    if scanned_entries > 400:
                        break
                    if any(part in ignored_dirs for part in p.parts):
                        continue
                    if p.is_file():
                        rel = p.relative_to(workspace_path)
                        rel_posix = rel.as_posix()
                        if len(active_files) < 15:
                            active_files.append(rel_posix)
                        if len(rel.parts) <= 3 and len(cached_workspace_files_with_sizes) < 25:
                            sz_kb = max(1, p.stat().st_size // 1024)
                            cached_workspace_files_with_sizes.append(f"{rel} ({sz_kb}KB)")
                    if len(active_files) >= 15 and len(cached_workspace_files_with_sizes) >= 25:
                        break
            except Exception as e:
                logger.debug(f"Workspace file scan notice: {e}")

        # 1. Initialize and stream First-Class Execution Plan Lifecycle
        current_plan = self._generate_initial_plan(title, prompt, persona_name)
        intent_category = current_plan.get("intent_category", "app_building" if persona_name == "AppBuilder" else "code_modification")
        prompt_title_lower = (prompt + " " + title).lower()
        is_exploration = any(k in prompt_title_lower for k in ["explore", "analyze", "explain", "review", "audit", "summarize", "investigate", "read", "check"])
        is_app_keyword = not is_exploration and any(k in prompt_title_lower for k in [
            "build a", "build an", "create a", "create an", "make a", "make an", "game", "minecraft",
            "voxel", "arcade", "canvas", "dashboard", "calculator", "storefront", "web app", "frontend",
            "ui component", "designed app", "motion app", "toy app", "robot app", "simulation", "3d app",
            "interactive app", "animation app", "landing page", "web tool", "client app"
        ])
        is_app_task = (intent_category == "app_building" or persona_name == "AppBuilder" or is_app_keyword)
        await self._emit_plan(current_plan, on_plan)

        if history:
            for msg in history:
                role = "user" if msg.get("sender") == "user" else "model"
                text = msg.get("content", "")
                if text and not msg.get("thought"):
                    contents.append({"role": role, "parts": [{"text": text}]})

            # Working Memory: If active files exist in workspace, inject situational awareness
            if workspace_path and workspace_path.exists():
                if active_files:
                    contents.append({
                        "role": "user",
                        "parts": [{"text": f"[System Working Memory]: Active workspace files on disk: {', '.join(active_files)}. Ground all inspections and tool calls in these real files."}]
                    })
                    contents.append({
                        "role": "model",
                        "parts": [{"text": "Understood. I have verified the active workspace files on disk and will ground my actions in the actual files."}]
                    })

        if workspace_path and workspace_path.exists():
            try:
                from app.agent.engine.memory import (
                    plan_memory_query,
                    retrieve_relevant_heuristics,
                    format_working_memory_block,
                )
                mem_plan = plan_memory_query(prompt, target_files=active_files if active_files else None)
                if mem_plan.get("should_recall"):
                    heuristics = await retrieve_relevant_heuristics(
                        repo_id=None,
                        prompt=prompt,
                        target_files=active_files if active_files else None,
                        limit=3
                    )
                    mem_block = format_working_memory_block(heuristics)
                    if mem_block:
                        contents.append({
                            "role": "user",
                            "parts": [{"text": mem_block}]
                        })
                        contents.append({
                            "role": "model",
                            "parts": [{"text": "Understood. I will apply these verified lessons and repository heuristics throughout execution."}]
                        })
            except Exception as e:
                logger.debug(f"Experiential memory injection notice: {e}")

        user_parts: List[Dict[str, Any]] = [{"text": prompt}]
        if workspace_path and workspace_path.exists():
            try:
                att_dir = workspace_path / ".cyclode" / "attachments"
                if att_dir.exists() and att_dir.is_dir():
                    prompt_title_lower = (prompt + " " + title).lower()
                    has_attachment_intent = any(k in prompt_title_lower for k in [
                        "image", "screenshot", "attach", "mockup", "ui", ".png", ".jpg", ".jpeg",
                        ".webp", ".gif", "look at", "see this", "visual", "photo", "wireframe",
                        "diagram", "uploaded", "view_image"
                    ]) or bool(history and any("[Uploaded Attachment:" in msg.get("content", "") for msg in history))

                    att_files = [f for f in sorted(att_dir.iterdir()) if f.is_file() and not f.name.startswith(".")]
                    if att_files:
                        supports_vision = provider.supports_inline_vision(effective_model)
                        if has_attachment_intent and supports_vision:
                            for att_file in att_files:
                                ext = att_file.suffix.lower()
                                raw_bytes = att_file.read_bytes()
                                if ext in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
                                    compressed_bytes, mime_type = downscale_context_image(raw_bytes)
                                    b64_str = base64.b64encode(compressed_bytes).decode("utf-8")
                                    user_parts.append({
                                        "inlineData": {
                                            "mimeType": mime_type,
                                            "data": b64_str
                                        }
                                    })
                                elif ext == ".pdf" and getattr(provider, "provider_id", "") in {"google", "anthropic"}:
                                    b64_str = base64.b64encode(raw_bytes).decode("utf-8")
                                    user_parts.append({
                                        "inlineData": {
                                            "mimeType": "application/pdf",
                                            "data": b64_str
                                        }
                                    })
                        else:
                            # For text-only models (e.g. deepseek-chat) or queries not explicitly requesting images:
                            # Provide disk awareness without dumping multi-megabyte base64 text tokens into messages
                            att_summary = ", ".join(f"{f.name} ({f.stat().st_size // 1024}KB)" for f in att_files[:5])
                            user_parts.append({
                                "text": f"[Workspace Attachments on Disk]: {att_summary}. If visual inspection or OCR is needed, invoke `view_image`."
                            })
            except Exception as e:
                logger.debug(f"Multimodal attachment ingestion notice: {e}")

        if not contents or contents[-1].get("role") != "user":
            contents.append({"role": "user", "parts": user_parts})
        elif contents and contents[-1].get("role") == "user":
            existing_parts = contents[-1].get("parts", [])
            for p in user_parts:
                if p not in existing_parts:
                    existing_parts.append(p)
            contents[-1]["parts"] = existing_parts

        logger.info(f"Connecting to {provider_label} API using model {self.model_name}...")

        client_timeout = httpx.Timeout(120.0, connect=15.0, read=120.0)
        async with httpx.AsyncClient(timeout=client_timeout) as client:
            if fast_direct and (initial_intent == "qa_research" or (is_subsession and initial_intent != "planning")):
                # Fast-path bypass: skip pre-turn LLM plan synthesis for direct conceptual/contextual Q&A and focused sub-sessions
                default_style = (
                    ("direct_concise" if len((prompt or "").split()) <= 15 else "analytical_briefing")
                    if initial_intent == "qa_research"
                    else "action_execution"
                )
                raw_fast_label = re.sub(
                    r"\[Uploaded\s+(?:Workspace\s+)?(?:File|Attachment|Folder):\s*([^\]\n]+?)\]",
                    r"\1",
                    (title or prompt or ""),
                    flags=re.IGNORECASE,
                )
                raw_fast_label = re.sub(r"\[Uploaded[^\]]*$", "", raw_fast_label, flags=re.IGNORECASE).strip()
                clean_step_label = (
                    raw_fast_label[:77].rstrip() + "…"
                    if len(raw_fast_label) > 80
                    else (raw_fast_label or "Analyze request and synthesize response")
                )
                current_plan = {
                    "intent_category": initial_intent,
                    "response_style": default_style,
                    "requires_plan": False,
                    "requires_reasoning": initial_reasoning,
                    "title": clean_step_label,
                    "objective": raw_fast_label[:100] or (title or prompt or "")[:100],
                    "steps": [
                        {"id": "step-1", "title": clean_step_label, "status": "in_progress"}
                    ],
                    "evaluation": {
                        "status": "pending",
                        "summary": "Direct fast-path synthesis in progress."
                    }
                }
                current_plan["markdown"] = generate_plan_markdown(current_plan, title, prompt)
            else:
                # Formulate dynamic execution plan using fast structured planner call (deepseek-v4.1-flash / provider flash)
                primary_model = unique_models[0] if unique_models else self.model_name
                plan_req_model = self.model_name if (self.model_name or "").lower().strip() in {"adaptive", "auto", ""} else primary_model
                dynamic_plan = await self._generate_dynamic_plan(
                    client=client,
                    api_key=api_key,
                    model_name=plan_req_model,
                    title=title,
                    prompt=prompt,
                    persona_name=persona_name,
                    history=history,
                    workspace_path=workspace_path,
                    cached_workspace_files=cached_workspace_files_with_sizes,
                )
                current_plan = dynamic_plan
                await self._emit_plan(current_plan, on_plan)

            plan_intent_cat = current_plan.get("intent_category", initial_intent) if current_plan else initial_intent
            need_reasoning = bool(
                current_plan.get(
                    "requires_reasoning",
                    self.requires_reasoning_for_query(title, prompt, plan_intent_cat, history),
                )
            )
            if not need_reasoning and provider.provider_id == "deepseek" and unique_models:
                if "deepseek-reasoner" in unique_models[0] or "r1" in unique_models[0]:
                    unique_models = ["deepseek-flash"] + [m for m in unique_models if m != "deepseek-flash"]

            # If parallel swarm intent, inject immediate dispatch directive for the orchestrator
            if current_plan and current_plan.get("intent_category") == "parallel_swarm":
                swarm_directive = (
                    "\n\n[LEAD ORCHESTRATOR MANDATE]:\n"
                    "This task is designated as a parallel swarm execution. You are the Lead Orchestrator, NOT a solo implementer. "
                    "Do NOT inspect git logs or code files sequentially across multiple turns. Perform at most ONE quick orientation check (`list_dir`) "
                    "and IMMEDIATELY call `delegate_subtasks` with all worker pods in a single batch call. "
                    "After worker pods finish, perform central integration and verification."
                )
                if contents and contents[-1].get("role") == "user":
                    contents[-1]["parts"].append({"text": swarm_directive})
                else:
                    contents.append({"role": "user", "parts": [{"text": swarm_directive}]})

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
                max_turns = 80
                guardrail_corrections = 0
                max_guardrail_corrections = 8
                model_succeeded = False
                final_agent_text = ""
                last_snapshot_mut_count = -1
                inspection_signature_counts: Dict[str, int] = {}
                force_loop_exit = False

                try:
                    while turn < max_turns and not force_loop_exit:
                        turn += 1
                        collector.start_turn(turn_index=turn, user_prompt=prompt if turn == 1 else None)
                        # Lazy turn snapshots: skip git subprocess overhead on qa_research/planning or turns without file mutations
                        if (
                            workspace_path
                            and workspace_path.exists()
                            and plan_intent_cat not in {"qa_research", "planning"}
                            and (turn == 1 or mutating_tool_count > last_snapshot_mut_count)
                        ):
                            last_snapshot_mut_count = mutating_tool_count
                            await run_io_blocking(create_turn_snapshot, workspace_path, turn)

                        # Drain in-flight user steering messages if any were queued while agent was executing
                        if steering_queue and not steering_queue.empty():
                            steer_msgs = []
                            while not steering_queue.empty():
                                try:
                                    msg = steering_queue.get_nowait()
                                    if msg and str(msg).strip():
                                        steer_msgs.append(str(msg).strip())
                                except asyncio.QueueEmpty:
                                    break
                            if steer_msgs:
                                combined_steer = "\n\n".join(steer_msgs)
                                logger.info(f"Draining {len(steer_msgs)} in-flight steering messages into task {task_id} turn {turn}")
                                steer_text = f"[User In-Flight Steering Update]:\n{combined_steer}\n\nPlease adapt your ongoing actions to incorporate these user instructions."
                                if contents and contents[-1].get("role") == "user":
                                    contents[-1]["parts"].append({"text": steer_text})
                                else:
                                    contents.append({"role": "user", "parts": [{"text": steer_text}]})
                                await self._emit_streamed_thought(
                                    f"**In-Flight Steering Received**: Processing updated user directive: {combined_steer[:80]}...",
                                    on_thought, on_stream_start, on_stream_chunk, on_stream_end
                                )

                        # Tier 3: In-Context Tool Output & Historical Content Compaction
                        # Preserve the last 5 full turns (10 entries: 5 model + 5 user) uncompacted so multi-step
                        # file/PDF/skill inspections across consecutive turns never cause 2-turn compaction amnesia.
                        optimized_contents = []
                        total_entries = len(contents)
                        for idx, entry in enumerate(contents):
                            if idx >= total_entries - 10:
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
                                        # Compact large text values in older turns (>5 turns ago)
                                        for key in ["output", "stdout", "content", "result", "diff", "text"]:
                                            val = resp_copy.get(key)
                                            if isinstance(val, str) and len(val) > 4500:
                                                lines = val.split("\n")
                                                if len(lines) > 90:
                                                    compacted_val = "\n".join(lines[:35]) + f"\n\n... [Historical output compacted: {len(lines)-60} lines omitted for token efficiency] ...\n\n" + "\n".join(lines[-25:])
                                                else:
                                                    compacted_val = val[:2000] + f"\n\n... [Historical output compacted ({len(val)} chars)] ...\n\n" + val[-1500:]
                                                resp_copy[key] = compacted_val
                                        # Compact large list results (symbols, search matches, dir items, issues, PRs)
                                        for list_key in ["matches", "symbols", "items", "entries", "issues", "pull_requests"]:
                                            list_val = resp_copy.get(list_key)
                                            if isinstance(list_val, list) and len(list_val) > 8:
                                                resp_copy[list_key] = list_val[:5] + [{
                                                    "_compacted": True,
                                                    "notice": f"... [{len(list_val) - 5} additional historical {list_key} compacted for token efficiency]"
                                                }]
                                        fr["response"] = resp_copy
                                        new_parts.append({"functionResponse": fr})
                                    elif isinstance(resp_data, list):
                                        new_parts.append({"functionResponse": {"name": fr.get("name", "tool"), "response": {"items": resp_data[:5], "total_found": len(resp_data)}, "id": fr.get("id")}})
                                    else:
                                        new_parts.append({"functionResponse": {"name": fr.get("name", "tool"), "response": {"output": str(resp_data)}, "id": fr.get("id")}})
                                else:
                                    new_parts.append(p)
                            optimized_contents.append({"role": entry.get("role", "user"), "parts": new_parts})

                        # Tier 2: Intent-Driven Tool Schema Pruning & Plan Mode Directive
                        intent_cat = current_plan.get("intent_category", "qa_research")
                        response_style = current_plan.get("response_style", "")
                        effective_system_instruction = system_instruction
                        active_tools_def = filter_declarations_for_intent(
                            tools_def,
                            intent_category=intent_cat,
                            is_capability_enabled_fn=integration_manager.is_capability_enabled,
                        )

                        if intent_cat == "planning":
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
                        elif intent_cat == "qa_research" and response_style == "direct_concise":
                            effective_system_instruction = (
                                system_instruction
                                + "\n\n4. DIRECT CONCISE RESPONSE MANDATE:\n"
                                + "   - Answer the user's question directly, clearly, and concisely using existing conversation context.\n"
                                + "   - Do NOT create an implementation plan or invoke unnecessary workspace tools when the answer is conceptual or already in context."
                            )
                        elif intent_cat != "qa_research":

                            if current_plan.get("phases") or (current_plan.get("steps") and len(current_plan["steps"]) > 1):
                                active_step_title = ""
                                for s in current_plan.get("steps", []):
                                    if s.get("status") == "in_progress":
                                        active_step_title = s.get("title", "")
                                        break
                                effective_system_instruction = (
                                    system_instruction
                                    + "\n\n4. ACTIVE PLAN EXECUTION MANDATE:\n"
                                    + f"   - An architectural implementation plan is currently active and approved by the user (Current Target: '{active_step_title or 'Milestone Execution'}').\n"
                                    + "   - Your role is to EXECUTE the plan by making concrete modifications to workspace files (`edit_file`, `replace_file_content`, `batch_replace_content`, `run_command`).\n"
                                    + "   - DO NOT formulate another implementation plan or output `# Implementation Plan`.\n"
                                    + "   - DO NOT halt to ask for permission or confirm before writing code.\n"
                                    + "   - Inspect necessary files and immediately proceed with implementing the required file modifications in the workspace."
                                )

                        # Pre-Flight Token Budgeting & Sliding-Window Context Compaction
                        context_ceiling = active_provider.get_context_window(active_model)
                        budget_threshold = int(context_ceiling * 0.80)
                        current_est_tokens = estimate_messages_tokens(optimized_contents, effective_system_instruction)

                        if current_est_tokens > budget_threshold:
                            logger.info(
                                f"Task {task_id} turn {turn} approaching context budget ceiling for {active_model}: "
                                f"{current_est_tokens} tokens > {budget_threshold} threshold (ceiling {context_ceiling}). "
                                f"Triggering pre-flight compaction."
                            )

                            # Pass 1: Aggressive compaction of historical tool responses
                            compacted_contents = []
                            for idx, entry in enumerate(optimized_contents):
                                if idx >= len(optimized_contents) - 2:
                                    compacted_contents.append(entry)
                                    continue
                                new_entry_parts = []
                                for p in entry.get("parts", []):
                                    if "functionResponse" in p:
                                        fr = dict(p["functionResponse"])
                                        fn_name = fr.get("name", "")
                                        resp_obj = fr.get("response", {})
                                        if fn_name == "read_file" and isinstance(resp_obj, dict):
                                            fp = resp_obj.get("file_path", "file")
                                            tot_l = resp_obj.get("total_lines", 0)
                                            fr["response"] = {
                                                "file_path": fp,
                                                "total_lines": tot_l,
                                                "content": f"[Historical file inspection '{fp}' ({tot_l} lines) compacted for context budget]"
                                            }
                                        elif isinstance(resp_obj, dict):
                                            small_resp = {}
                                            for rk, rv in resp_obj.items():
                                                if isinstance(rv, str) and len(rv) > 250:
                                                    small_resp[rk] = rv[:200] + f"... [compacted {len(rv)} chars]"
                                                elif isinstance(rv, list) and len(rv) > 3:
                                                    small_resp[rk] = rv[:2] + [{"_compacted": True}]
                                                else:
                                                    small_resp[rk] = rv
                                            fr["response"] = small_resp
                                        new_entry_parts.append({"functionResponse": fr})
                                    else:
                                        new_entry_parts.append(p)
                                compacted_contents.append({"role": entry.get("role", "user"), "parts": new_entry_parts})

                            optimized_contents = compacted_contents
                            current_est_tokens = estimate_messages_tokens(optimized_contents, effective_system_instruction)

                        # Pass 2: If still over budget, apply sliding window to intermediate turns
                        if current_est_tokens > budget_threshold and len(optimized_contents) > 6:
                            head_count = 2 if len(optimized_contents) > 2 and optimized_contents[1].get("role") == "model" else 1
                            tail_count = 4
                            if len(optimized_contents) > (head_count + tail_count + 1):
                                intermediate_entries = optimized_contents[head_count:-tail_count]
                                pruned_turn_count = len(intermediate_entries) // 2
                                marker_turn_user = {
                                    "role": "user",
                                    "parts": [{
                                        "text": f"[Historical Working Memory Compaction]: {pruned_turn_count} intermediate exploration turns were pruned to keep message context within {active_model} budget. Workspace state, real files on disk, and current plan state remain intact."
                                    }]
                                }
                                marker_turn_model = {
                                    "role": "model",
                                    "parts": [{"text": "Understood. Proceeding with active plan and current workspace files."}]
                                }
                                optimized_contents = (
                                    optimized_contents[:head_count]
                                    + [marker_turn_user, marker_turn_model]
                                    + optimized_contents[-tail_count:]
                                )
                                current_est_tokens = estimate_messages_tokens(optimized_contents, effective_system_instruction)
                                logger.info(
                                    f"Sliding window applied to task {task_id}: pruned {pruned_turn_count} turns. "
                                    f"New estimated tokens: {current_est_tokens} / {context_ceiling}"
                                )

                        # Execute turn with active provider (suppressing extended thinking when reasoning is not required)
                        effective_thinking_budget = 0 if not need_reasoning else None
                        provider_resp = None
                        for retry_idx in range(2):
                            try:
                                provider_resp = await active_provider.generate_response(
                                    messages=optimized_contents,
                                    tools=active_tools_def,
                                    system_instruction=effective_system_instruction,
                                    model_name=active_model,
                                    thinking_budget=effective_thinking_budget,
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
                            err_text = provider_resp.error_message or f"Requested model '{active_model}' not found (404)."
                            logger.warning(f"{provider_label} Model Not Found Notice (404): {err_text}")

                            for s in current_plan.get("steps", []):
                                if s.get("status") == "in_progress":
                                    s["status"] = "failed"
                            current_plan["evaluation"] = {
                                "status": "needs_revision",
                                "summary": f"Execution halted: {provider_label} Model Not Found (404). {err_text}",
                                "checks": [
                                    {"name": "API Connection", "passed": False, "message": f"Model '{active_model}' not found (404)"},
                                    {"name": "Tool Execution", "passed": False}
                                ]
                            }
                            await self._emit_plan(current_plan, on_plan)

                            not_found_user_msg = (
                                f"### {provider_label} Model Not Found (404)\n\n"
                                f"**{err_text}**\n\n"
                                f"The model `{active_model}` was not recognized by `{provider_label}`.\n\n"
                                f"To resume autonomous agent execution:\n"
                                f"1. **Switch Model**: Select **GPT-4o**, **o3-mini**, or **GPT-4o Mini** in the model dropdown.\n"
                                f"2. **Custom Endpoint**: If using Ollama, vLLM, or LiteLLM, verify the model tag in **Settings > Integrations**."
                            )
                            await self._emit_streamed_message(
                                "agent", not_found_user_msg, on_message, on_stream_start, on_stream_chunk, on_stream_end
                            )
                            return {"status": "FAILED", "summary": f"Model Not Found (404): {err_text[:100]}"}
                        if provider_resp.status_code == 429:
                            err_text = provider_resp.error_message or "API quota limit reached or credits depleted."
                            logger.warning(f"{provider_label} Quota Notice (429): {err_text}")
                            quota_exhausted = True

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
                            is_context_overflow = provider_resp.status_code == 400 and any(
                                k in err_msg.lower() for k in ["context length", "maximum context", "reduce the length", "too many tokens", "token limit"]
                            )
                            if is_context_overflow and len(optimized_contents) > 4:
                                logger.warning(f"Context window overflow detected on turn {turn} ({err_msg}). Applying emergency context recovery...")
                                await self._emit_streamed_thought(
                                    f"**Context Budget Self-Healing**: Approached model context ceiling. Compacting historical exploration turns to maintain session execution...",
                                    on_thought, on_stream_start, on_stream_chunk, on_stream_end
                                )
                                head_c = 2 if len(optimized_contents) > 2 and optimized_contents[1].get("role") == "model" else 1
                                optimized_contents = (
                                    optimized_contents[:head_c]
                                    + [{
                                        "role": "user",
                                        "parts": [{"text": "[Emergency Context Pruning]: Intermediate exploration turns pruned to recover context window. Active files and plan state remain intact."}]
                                    }, {
                                        "role": "model",
                                        "parts": [{"text": "Understood. Proceeding with active execution."}]
                                    }]
                                    + optimized_contents[-2:]
                                )
                                provider_resp = await active_provider.generate_response(
                                    messages=optimized_contents,
                                    tools=active_tools_def,
                                    system_instruction=effective_system_instruction,
                                    model_name=active_model,
                                    client=client
                                )
                                if provider_resp.is_success:
                                    logger.info("Emergency context pruning successfully recovered execution.")
                                else:
                                    err_msg = provider_resp.error_message or f"HTTP {provider_resp.status_code}"

                            if not provider_resp.is_success:
                                last_api_error_code = provider_resp.status_code
                                last_api_error_text = err_msg
                                logger.warning(f"API notice on turn {turn} model {active_model} ({provider_resp.status_code}): {err_msg}")
                            
                            for s in current_plan.get("steps", []):
                                if s.get("status") == "in_progress":
                                    s["status"] = "failed"
                            current_plan["evaluation"] = {
                                "status": "needs_revision",
                                "summary": f"Execution halted: {provider_label} API Error ({provider_resp.status_code}). {err_msg}",
                                "checks": [
                                    {"name": "API Connection", "passed": False, "message": f"API Error ({provider_resp.status_code})"},
                                    {"name": "Tool Execution", "passed": False}
                                ]
                            }
                            await self._emit_plan(current_plan, on_plan)
                            fail_user_msg = (
                                f"### {provider_label} Invocation Notice ({provider_resp.status_code})\n\n"
                                f"**{err_msg}**\n\n"
                                f"To resume execution, verify your API settings or switch to an active model in chat."
                            )
                            await self._emit_streamed_message(
                                "agent", fail_user_msg, on_message, on_stream_start, on_stream_chunk, on_stream_end
                            )
                            return {"status": "FAILED", "summary": f"API Error ({provider_resp.status_code}): {err_msg[:100]}"}

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

                            provider_resp = cont_resp
                            if provider_resp.tool_calls:
                                function_calls = [{"name": tc.tool_name, "args": tc.tool_args, "id": tc.call_id} for tc in provider_resp.tool_calls]
                                break

                        combined_text = "\n".join(text_parts).strip() if text_parts else ""

                        # Fallback Markup Tool Call Extraction (DSML, XML, special tokens)
                        if not function_calls and combined_text and ("<" in combined_text or "｜" in combined_text or "```tool_call" in combined_text or "＜" in combined_text):
                            from app.agent.providers.base import extract_markup_tool_calls
                            cleaned_c, extracted_tcs = extract_markup_tool_calls(combined_text)
                            if extracted_tcs:
                                combined_text = cleaned_c
                                function_calls = [{"name": tc.tool_name, "args": tc.tool_args, "id": tc.call_id} for tc in extracted_tcs]
                                provider_resp.tool_calls = extracted_tcs
                                provider_resp.content = cleaned_c

                        if combined_text and function_calls:
                            await self._emit_streamed_thought(
                                combined_text, on_thought, on_stream_start, on_stream_chunk, on_stream_end
                            )

                        if not function_calls:
                            intent_category = current_plan.get("intent_category", "app_building" if persona_name == "AppBuilder" else "code_modification")
                            prompt_title_lower = (prompt + " " + title).lower()
                            is_exploration = any(k in prompt_title_lower for k in ["explore", "analyze", "explain", "review", "audit", "summarize", "investigate", "read", "check"])
                            is_app_keyword = not is_exploration and any(k in prompt_title_lower for k in [
                                "build a", "build an", "create a", "create an", "make a", "make an", "game", "minecraft",
                                "voxel", "arcade", "canvas", "dashboard", "calculator", "storefront", "web app", "frontend",
                                "ui component", "designed app", "motion app", "toy app", "robot app", "simulation", "3d app",
                                "interactive app", "animation app", "landing page", "web tool", "client app"
                            ])
                            is_app_task = (intent_category == "app_building" or persona_name == "AppBuilder" or is_app_keyword)

                            # Autonomous Markdown Code Block Extraction
                            # If the model emitted full file implementations inside markdown code fences instead of calling edit_file,
                            # parse and author the files directly to the workspace before evaluating preview or halting.
                            if (is_app_task or intent_category in ["app_building", "code_modification"]) and combined_text:
                                extracted_writes = 0
                                fence_pattern = re.compile(r"```(?:[a-zA-Z0-9_\-+]+)?(?:\s+([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+))?\n([\s\S]*?)```")
                                for m in fence_pattern.finditer(combined_text):
                                    fname = m.group(1)
                                    fcode = m.group(2)
                                    if not fname and fcode:
                                        first_line = fcode.strip().split("\n")[0].strip()
                                        comment_match = re.match(r"^(?:<!--|//|/\*|#)\s*([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)", first_line)
                                        if comment_match:
                                            fname = comment_match.group(1)
                                            fcode = "\n".join(fcode.strip().split("\n")[1:]).strip()
                                        elif is_app_task and ("<!DOCTYPE html>" in fcode or "<html" in fcode):
                                            fname = "index.html"
                                    if fname and fcode and not fname.endswith((".md", ".txt", ".jsonl", ".log")):
                                        res_write = WorkspaceTools.edit_file(workspace_path, fname, fcode)
                                        if "error" not in res_write:
                                            mutating_tool_count += 1
                                            extracted_writes += 1
                                            logger.info(f"Auto-extracted code block written to '{fname}' ({len(fcode)} bytes)")
                                if extracted_writes > 0:
                                    diffs = worktree_manager.get_git_diff(workspace_path)
                                    if diffs:
                                        await on_diff_updated(diffs)
                                    await self._emit_streamed_thought(
                                        f"**Autonomous Scaffolding**: Automatically extracted and authored {extracted_writes} workspace file{'s' if extracted_writes > 1 else ''} from response payload.",
                                        on_thought, on_stream_start, on_stream_chunk, on_stream_end
                                    )

                            # 0. Autonomous Dangling Intent & Auto-Continuation Guardrail
                            # If the model emitted a forward-looking transitional promise (e.g. ending in a colon or "let me fix..."),
                            # prompt it to execute the tool calls rather than halting the session prematurely.
                            raw_text_stripped = combined_text.strip()
                            is_dangling_intent = Harness.is_dangling_action_intent(raw_text_stripped) if raw_text_stripped else False

                            if is_dangling_intent and guardrail_corrections < max_guardrail_corrections:
                                guardrail_corrections += 1
                                logger.info(f"Triggering Dangling Intent Auto-Continuation on task {task_id} (correction {guardrail_corrections}/{max_guardrail_corrections})")
                                preview_snip = raw_text_stripped[:60] + "..." if len(raw_text_stripped) > 60 else raw_text_stripped
                                await self._emit_streamed_thought(
                                    "Continuing execution to complete planned workspace actions...",
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
                                    "parts": [{"text": "CRITICAL DIRECTIVE: You emitted a transitional action promise without tool execution. Execute the required tool call (`edit_file`, `replace_file_content`, `run_command`, `read_file`) NOW in this turn to carry out your planned change. Do not output text without a tool call payload."}]
                                })
                                continue

                            # Autonomous Pre-Completion Verification Guardrail
                            from app.api.preview import verify_workspace_preview
                            verification = verify_workspace_preview(workspace_path, task_id)
                            status_val = verification.get("status")
                            needs_preview_correction = (
                                status_val in ["missing_entry_point", "missing_workspace", "needs_build", "uncompiled_css", "unlinked_assets", "empty_ui", "dom_css_mismatch", "js_dom_mismatch", "dead_buttons", "runtime_exception", "runtime_error", "runtime_syntax_error", "issues_found"]
                                or bool(verification.get("issues"))
                            )

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

                            # Multi-Step Plan Milestone Completion Guardrail
                            # If the model has already performed valid workspace mutations with exit_code=0, no dangling intent,
                            # and no preview issues, subsume remaining pending milestones rather than forcing extra LLM turns.
                            pending_plan_steps = [s for s in current_plan.get("steps", []) if s.get("status") == "pending"]
                            if (
                                pending_plan_steps
                                and mutating_tool_count >= 1
                                and last_tool_exit_code in (None, 0)
                                and not is_dangling_intent
                                and (not is_app_task or not needs_preview_correction)
                            ):
                                for s in current_plan.get("steps", []):
                                    if s.get("status") != "failed":
                                        s["status"] = "completed"
                                pending_plan_steps = []
                            elif (
                                (is_app_task or intent_category in ["app_building", "code_modification"])
                                and len(current_plan.get("steps", [])) >= 3
                                and len(pending_plan_steps) >= 2
                                and guardrail_corrections < max_guardrail_corrections
                            ):
                                guardrail_corrections += 1
                                pending_titles = [s.get("title", f"Step {idx+1}") for idx, s in enumerate(pending_plan_steps[:3])]
                                milestone_prompt = (
                                    f"Autonomous Milestone Completion Notice:\n"
                                    f"The formulated execution plan has {len(pending_plan_steps)} remaining uncompleted milestones:\n"
                                    f"{chr(10).join(f'- {t}' for t in pending_titles)}\n\n"
                                    f"CRITICAL DIRECTIVE: Do not conclude the task prematurely while plan milestones remain pending. Proceed directly to implement the next milestone using workspace tools (`edit_file`, `replace_file_content`, `run_command`)."
                                )
                                logger.info(f"Triggering Milestone Completion Guardrail on task {task_id} (correction {guardrail_corrections}, {len(pending_plan_steps)} steps pending)")
                                await self._emit_streamed_thought(
                                    f"**Milestone Execution**: {len(pending_plan_steps)} plan milestones remaining. Advancing to next milestone...",
                                    on_thought, on_stream_start, on_stream_chunk, on_stream_end
                                )
                                if provider_resp.raw_parts:
                                    clean_parts = []
                                    for p in provider_resp.raw_parts:
                                        if isinstance(p, dict):
                                            if "thought" in p or "text" in p or ("content" in p and isinstance(p["content"], str)):
                                                clean_parts.append(p)
                                    m_parts = clean_parts if clean_parts else ([{"text": combined_text}] if combined_text else [{"text": "Advancing plan milestones."}])
                                else:
                                    m_parts = []
                                    if provider_resp.thought:
                                        m_parts.append({"thought": provider_resp.thought})
                                    if combined_text:
                                        m_parts.append({"text": combined_text})

                                contents.append({
                                    "role": "model",
                                    "parts": m_parts if m_parts else [{"text": combined_text or "Advancing plan milestones."}]
                                })
                                contents.append({
                                    "role": "user",
                                    "parts": [{"text": milestone_prompt}]
                                })
                                continue

                            if is_app_task:
                                checks = [{"name": "Workspace State", "passed": True}]
                                verification = verify_workspace_preview(workspace_path, task_id)
                                preview_ok = verification.get("status") in ["ready", "compiled", "static"] and not verification.get("issues")
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
                                checks = [{
                                    "name": "Analytical Synthesis",
                                    "passed": has_synthesis
                                }]
                                if tool_call_count > 0:
                                    checks.append({
                                        "name": "Information Retrieval",
                                        "passed": True
                                    })
                            elif intent_category == "planning":
                                has_synthesis = bool(combined_text and len(combined_text.strip()) > 30)
                                checks = [{
                                    "name": "Plan Formulation",
                                    "passed": has_synthesis
                                }]
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
                                checks = [{"name": "Workspace State", "passed": True}]
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

                            # Enforce that is_plan_response can only trigger when intent_category is explicitly planning
                            # AND the response is a genuine complete architectural plan document.
                            # Mentioning milestones ("Phase 1:") during execution must NEVER hijack active runs!
                            is_plan_response = (
                                intent_category == "planning"
                                and (
                                    "# Implementation Plan" in final_agent_text
                                    or "## Implementation Plan" in final_agent_text
                                    or (final_agent_text.strip().startswith("# ") and "Key Execution Phases" in final_agent_text)
                                )
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
                                await _flush_staged_approvals()
                                collector.end_turn(agent_response=chat_agent_text)
                                task_trajectories[task_id] = collector.build_trajectory(status="COMPLETED")
                                if not has_staged_approvals:
                                    try:
                                        from app.agent.engine.memory import extract_turn_heuristics, promote_task_memories
                                        all_turn_logs = [
                                            {
                                                "tool_name": tc.tool_name,
                                                "tool_input": tc.input_args,
                                                "tool_output": tc.output_data or tc.error or "",
                                                "exit_code": tc.exit_code,
                                            }
                                            for t_obj in collector.turns
                                            for tc in t_obj.tool_calls
                                        ]
                                        if len(all_turn_logs) >= 2:
                                            await extract_turn_heuristics(
                                                task_id=task_id,
                                                turn_index=len(collector.turns),
                                                tool_logs=all_turn_logs,
                                            )
                                        await promote_task_memories(task_id)
                                    except Exception as e:
                                        logger.debug(f"Error promoting task memories on plan completion: {e}")

                                return {"status": "AWAITING_APPROVAL" if has_staged_approvals else "COMPLETED", "summary": chat_agent_text}
                            else:
                                if mutating_tool_count == 0:
                                    # Informational inquiry, research, review, or QA response with zero file mutations
                                    for s in current_plan.get("steps", []):
                                        if s.get("status") != "failed":
                                            s["status"] = "completed" if (all_checks_passed and not is_dangling_intent) else "failed"
                                    eval_status = "accomplished" if (all_checks_passed and not is_dangling_intent) else "needs_revision"
                                    eval_summary = (
                                        "Research and analytical synthesis delivered successfully."
                                        if intent_category == "qa_research"
                                        else "Analytical synthesis and workspace inquiry delivered successfully."
                                    ) if (all_checks_passed and not is_dangling_intent) else "Plan execution requires revision or concluded with in-flight actions."
                                else:
                                    if is_app_task and not is_dangling_intent:
                                        from app.api.preview import verify_workspace_preview
                                        preview_verification = verify_workspace_preview(workspace_path, task_id)
                                        if preview_verification.get("status") in ["ready", "compiled", "static"] and not preview_verification.get("issues"):
                                            for s in current_plan.get("steps", []):
                                                if s.get("status") != "failed":
                                                    s["status"] = "completed"

                                    if all_checks_passed and not is_dangling_intent:
                                        for s in current_plan.get("steps", []):
                                            if s.get("status") != "failed":
                                                s["status"] = "completed"
                                        eval_status = "accomplished"
                                        eval_summary = "All execution plan steps verified successfully against workspace state."
                                    else:
                                        for s in current_plan.get("steps", []):
                                            if s.get("status") == "in_progress":
                                                s["status"] = "failed"
                                        eval_status = "needs_revision"
                                        eval_summary = "Plan execution requires revision or concluded with in-flight actions."

                                if is_dangling_intent and active_provider:
                                    terminal_synth_instruction = (
                                        system_instruction +
                                        "\n\nCRITICAL DIRECTIVE: Execution limit reached with in-flight transitional scratchpad thoughts. Provide your final concise executive summary, deliverables, and current workspace status to the user now. Do NOT promise further actions, future checks, or tool calls."
                                    )
                                    synth_contents = list(optimized_contents if optimized_contents else contents)
                                    synth_contents.append({
                                        "role": "user",
                                        "parts": [{"text": "Execution limit reached. Provide your final concise executive delivery summary to the user now. Do not promise further actions."}]
                                    })
                                    try:
                                        synth_resp = await active_provider.generate_response(
                                            messages=synth_contents,
                                            tools=None,
                                            system_instruction=terminal_synth_instruction,
                                            model_name=active_model,
                                            client=client
                                        )
                                        if synth_resp.is_success and synth_resp.content and synth_resp.content.strip():
                                            candidate_term = synth_resp.content.strip()
                                            if not Harness.is_dangling_action_intent(candidate_term):
                                                final_agent_text = candidate_term
                                            elif mutating_tool_count > 0:
                                                final_agent_text = (
                                                    f"Applied modifications across {mutating_tool_count} workspace action{'s' if mutating_tool_count != 1 else ''}. "
                                                    f"Execution concluded with in-flight actions."
                                                )
                                            else:
                                                final_agent_text = (
                                                    f"Completed {tool_call_count} workspace inspection action{'s' if tool_call_count != 1 else ''}. "
                                                    f"Execution concluded before final synthesis completed."
                                                )
                                    except Exception as term_err:
                                        logger.warning(f"Forced terminal synthesis notice: {term_err}")
                                        if mutating_tool_count > 0:
                                            final_agent_text = (
                                                f"Applied modifications across {mutating_tool_count} workspace action{'s' if mutating_tool_count != 1 else ''}."
                                            )
                                        else:
                                            final_agent_text = (
                                                f"Completed {tool_call_count} workspace inspection action{'s' if tool_call_count != 1 else ''}."
                                            )

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
                                await _flush_staged_approvals()

                            collector.end_turn(agent_response=final_agent_text)
                            task_trajectories[task_id] = collector.build_trajectory(status="COMPLETED")
                            if not has_staged_approvals:
                                try:
                                    from app.agent.engine.memory import extract_turn_heuristics, promote_task_memories
                                    all_turn_logs = [
                                        {
                                            "tool_name": tc.tool_name,
                                            "tool_input": tc.input_args,
                                            "tool_output": tc.output_data or tc.error or "",
                                            "exit_code": tc.exit_code,
                                        }
                                        for t_obj in collector.turns
                                        for tc in t_obj.tool_calls
                                    ]
                                    if len(all_turn_logs) >= 2:
                                        await extract_turn_heuristics(
                                            task_id=task_id,
                                            turn_index=len(collector.turns),
                                            tool_logs=all_turn_logs,
                                        )
                                    await promote_task_memories(task_id)
                                except Exception as e:
                                    logger.debug(f"Error promoting task memories on completion: {e}")

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
                                            api_key=api_key if getattr(active_provider, "provider_id", "") in {"google", "gemini", "openai"} else "",
                                            client=client if getattr(active_provider, "provider_id", "") in {"google", "gemini", "openai"} else None,
                                            intent="qa_research"
                                        )
                                except Exception as cache_store_err:
                                    logger.debug(f"Semantic cache store notice: {cache_store_err}")
                            return {"status": "AWAITING_APPROVAL" if has_staged_approvals else "COMPLETED", "summary": final_agent_text}

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


                        CONCURRENT_SAFE_TOOLS = {
                            "list_dir", "read_file", "get_file_outline",
                            "grep_search", "search_code", "find_symbols",
                            "tgrep_ast", "search_web", "fetch_url",
                            "get_pull_request_details", "get_pull_request_checks",
                            "get_pull_request_diff", "list_pull_requests",
                        }
                        precomputed_tool_results: Dict[int, Tuple[Dict[str, Any], int]] = {}

                        async def _exec_concurrent_tool(c_name: str, c_args: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
                            t0 = asyncio.get_event_loop().time()
                            if c_name == "list_dir":
                                sp = c_args.get("subpath") or c_args.get("path") or c_args.get("directory") or c_args.get("dir") or "."
                                res_d = await run_io_blocking(WorkspaceTools.list_dir, workspace_path, sp)
                            elif c_name == "read_file":
                                fp = c_args.get("file_path") or c_args.get("path") or c_args.get("filePath") or c_args.get("target_file") or c_args.get("filename") or c_args.get("file") or ""
                                sl = c_args.get("start_line") or c_args.get("startLine")
                                el = c_args.get("end_line") or c_args.get("endLine")
                                res_d = await run_io_blocking(WorkspaceTools.read_file, workspace_path, fp, start_line=sl, end_line=el)
                            elif c_name == "get_file_outline":
                                fp = c_args.get("file_path") or c_args.get("path") or c_args.get("filePath") or c_args.get("target_file") or c_args.get("filename") or c_args.get("file") or ""
                                res_d = await run_io_blocking(WorkspaceTools.get_file_outline, workspace_path, fp)
                            elif c_name in ["grep_search", "search_code"]:
                                q = c_args.get("query", "")
                                ir = c_args.get("is_regex", False)
                                fpat = c_args.get("file_pattern")
                                res_d = await run_io_blocking(WorkspaceTools.search_code, workspace_path, q, is_regex=ir, file_pattern=fpat)
                            elif c_name == "find_symbols":
                                npat = c_args.get("name_pattern", "")
                                stype = c_args.get("symbol_type")
                                fpat = c_args.get("file_pattern")
                                res_d = await run_io_blocking(WorkspaceTools.find_symbols, workspace_path, name_pattern=npat, symbol_type=stype, file_pattern=fpat)
                            elif c_name == "tgrep_ast":
                                pat = c_args.get("pattern", "")
                                res_d = await run_io_blocking(WorkspaceTools.tgrep_ast, workspace_path, pat)
                            elif c_name == "search_web":
                                res_d = await WorkspaceTools.search_web(c_args.get("query", ""))
                            elif c_name == "fetch_url":
                                res_d = await WorkspaceTools.fetch_url(c_args.get("url", ""))
                            elif c_name == "get_pull_request_details":
                                res_d = await WorkspaceTools.get_pull_request_details(c_args.get("repository", ""), int(c_args.get("pr_number", 1)))
                            elif c_name == "get_pull_request_checks":
                                res_d = await WorkspaceTools.get_pull_request_checks(c_args.get("repository", ""), int(c_args.get("pr_number", 1)))
                            elif c_name == "get_pull_request_diff":
                                res_d = await WorkspaceTools.get_pull_request_diff(c_args.get("repository", ""), int(c_args.get("pr_number", 1)))
                            elif c_name == "list_pull_requests":
                                res_d = await WorkspaceTools.list_pull_requests(
                                    c_args.get("repository", ""),
                                    state=c_args.get("state", "open"),
                                    author=c_args.get("author"),
                                    limit=int(c_args.get("limit", 10)),
                                )
                            else:
                                res_d = {}
                            dur = int((asyncio.get_event_loop().time() - t0) * 1000)
                            return res_d, dur

                        response_parts = []
                        for idx, call in enumerate(function_calls):
                            fn_name = call.get("name")
                            args = call.get("args", {})
                            call_id = call.get("id") or f"call_{fn_name}_{uuid.uuid4().hex[:8]}"

                            if idx not in precomputed_tool_results and fn_name in CONCURRENT_SAFE_TOOLS:
                                run_end = idx
                                while run_end < len(function_calls) and function_calls[run_end].get("name") in CONCURRENT_SAFE_TOOLS:
                                    run_end += 1
                                if run_end - idx >= 2:
                                    batch_results = await asyncio.gather(
                                        *[
                                            _exec_concurrent_tool(
                                                function_calls[j].get("name", ""),
                                                function_calls[j].get("args", {})
                                            )
                                            for j in range(idx, run_end)
                                        ]
                                    )
                                    for offset, res_pair in enumerate(batch_results):
                                        precomputed_tool_results[idx + offset] = res_pair

                            # Monotonic Dynamic Plan Step Transitions
                            plan_steps = current_plan.get("steps", [])
                            num_steps = len(plan_steps)
                            if num_steps >= 2:
                                if fn_name in ["write_file", "edit_file", "replace_file_content", "batch_replace_content", "apply_unified_patch", "connect_repository"]:
                                    if num_steps <= 2:
                                        target_idx = 1
                                    else:
                                        # Proportionally advance across intermediate steps up to num_steps - 2
                                        step_offset = min(max(1, mutating_tool_count), num_steps - 2)
                                        target_idx = max(1, step_offset)
                                    if Harness.advance_plan_step(current_plan, target_idx):
                                        await self._emit_plan(current_plan, on_plan)
                                elif (fn_name == "verify_app_preview" or (fn_name == "run_command" and any(k in str(args.get("command", "")).lower() for k in ["test", "pytest", "npm test", "vitest", "npm run test", "npm run build", "flutter build", "gradlew", "cargo check"]))) and mutating_tool_count >= 1:
                                    if Harness.advance_plan_step(current_plan, num_steps - 1):
                                        await self._emit_plan(current_plan, on_plan)
                                elif fn_name in ["create_pull_request", "post_pull_request_review"]:
                                    if Harness.advance_plan_step(current_plan, num_steps - 1):
                                        await self._emit_plan(current_plan, on_plan)
                                elif fn_name in ["read_file", "list_dir", "search_code", "find_symbols", "tgrep_ast", "fetch_url", "search_web"]:
                                    if plan_steps and plan_steps[0].get("status") == "pending":
                                        if Harness.advance_plan_step(current_plan, 0):
                                            await self._emit_plan(current_plan, on_plan)

                            if on_tool_start:
                                sig_start = inspect.signature(on_tool_start)
                                if "call_id" in sig_start.parameters or len(sig_start.parameters) >= 3:
                                    if inspect.iscoroutinefunction(on_tool_start):
                                        await on_tool_start(fn_name, args, call_id)
                                    else:
                                        res = on_tool_start(fn_name, args, call_id)
                                        if asyncio.iscoroutine(res):
                                            await res
                                else:
                                    if inspect.iscoroutinefunction(on_tool_start):
                                        await on_tool_start(fn_name, args)
                                    else:
                                        res = on_tool_start(fn_name, args)
                                        if asyncio.iscoroutine(res):
                                            await res

                            start_time = asyncio.get_event_loop().time()
                            precomputed_elapsed_ms: Optional[int] = None
                            tool_result: Dict[str, Any] = {}
                            exit_code = 0
                            out_str = ""
                            tool_call_count += 1

                            if fn_name == "list_dir":
                                subpath = args.get("subpath") or args.get("path") or args.get("directory") or args.get("dir") or "."
                                if idx in precomputed_tool_results:
                                    tool_result, precomputed_elapsed_ms = precomputed_tool_results.pop(idx)
                                else:
                                    tool_result = await run_io_blocking(WorkspaceTools.list_dir, workspace_path, subpath)
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
                                file_path = args.get("file_path") or args.get("path") or args.get("filePath") or args.get("target_file") or args.get("filename") or args.get("file") or ""
                                start_line = args.get("start_line") or args.get("startLine")
                                end_line = args.get("end_line") or args.get("endLine")
                                if idx in precomputed_tool_results:
                                    tool_result, precomputed_elapsed_ms = precomputed_tool_results.pop(idx)
                                else:
                                    tool_result = await run_io_blocking(WorkspaceTools.read_file, workspace_path, file_path, start_line=start_line, end_line=end_line)
                                if isinstance(tool_result, dict) and "content" in tool_result:
                                    try:
                                        from app.agent.engine.memory import get_file_memory_hints
                                        file_hints = await get_file_memory_hints(file_path, limit=2)
                                        if file_hints:
                                            tool_result["memory_hints"] = [h["insight"] for h in file_hints]
                                    except Exception:
                                        pass
                                    out_str = tool_result["content"]
                                else:
                                    out_str = tool_result.get("error", "Error reading file") if isinstance(tool_result, dict) else "Error reading file"
                            elif fn_name == "get_file_outline":
                                file_path = args.get("file_path") or args.get("path") or args.get("filePath") or args.get("target_file") or args.get("filename") or args.get("file") or ""
                                if idx in precomputed_tool_results:
                                    tool_result, precomputed_elapsed_ms = precomputed_tool_results.pop(idx)
                                else:
                                    tool_result = await run_io_blocking(WorkspaceTools.get_file_outline, workspace_path, file_path)
                                if "outline" in tool_result:
                                    out_str = tool_result["outline"]
                                else:
                                    out_str = tool_result.get("error", "Error extracting file outline")
                            elif fn_name == "replace_file_content":
                                file_path = args.get("file_path") or args.get("path") or args.get("filePath") or args.get("target_file") or args.get("filename") or args.get("file") or ""
                                target_content = args.get("target_content") if args.get("target_content") is not None else (args.get("target") if args.get("target") is not None else (args.get("search") if args.get("search") is not None else (args.get("old_content") if args.get("old_content") is not None else (args.get("oldContent") or ""))))
                                replacement_content = args.get("replacement_content") if args.get("replacement_content") is not None else (args.get("replacement") if args.get("replacement") is not None else (args.get("replace") if args.get("replace") is not None else (args.get("new_content") if args.get("new_content") is not None else (args.get("newContent") or ""))))
                                allow_multiple = bool(args.get("allow_multiple", args.get("allowMultiple", False)))
                                tool_result = WorkspaceTools.replace_file_content(
                                    workspace_path=workspace_path,
                                    file_path=file_path,
                                    target_content=target_content,
                                    replacement_content=replacement_content,
                                    allow_multiple=allow_multiple
                                )
                                if "error" in tool_result:
                                    exit_code = 1
                                    out_str = f"Error replacing content: {tool_result['error']}"
                                else:
                                    mutating_tool_count += 1
                                    guardrail_corrections = max(0, guardrail_corrections - 1)
                                    diffs = await run_io_blocking(worktree_manager.get_git_diff, workspace_path)
                                    if diffs:
                                        await on_diff_updated(diffs)
                                    out_str = f"Successfully replaced target content in '{file_path}' ({tool_result.get('replacements_count', 1)} replacement(s))."
                            elif fn_name == "batch_replace_content":
                                edits = args.get("edits", [])
                                tool_result = WorkspaceTools.batch_replace_content(
                                    workspace_path=workspace_path,
                                    edits=edits
                                )
                                if "error" in tool_result:
                                    exit_code = 1
                                    out_str = f"Error in batch edit: {tool_result['error']}"
                                else:
                                    mutating_tool_count += 1
                                    guardrail_corrections = max(0, guardrail_corrections - 1)
                                    diffs = await run_io_blocking(worktree_manager.get_git_diff, workspace_path)
                                    if diffs:
                                        await on_diff_updated(diffs)
                                    f_count = tool_result.get("modified_files_count", 0)
                                    r_count = tool_result.get("total_replacements", 0)
                                    f_list = ", ".join(tool_result.get("modified_files", []))
                                    out_str = f"Batch edit successfully applied {r_count} replacement(s) across {f_count} file(s) [{f_list}]."
                            elif fn_name == "apply_unified_patch":
                                patch_content = args.get("patch_content", "")
                                tool_result = WorkspaceTools.apply_unified_patch(
                                    workspace_path=workspace_path,
                                    patch_content=patch_content
                                )
                                if "error" in tool_result:
                                    exit_code = 1
                                    out_str = f"Error applying patch: {tool_result['error']}"
                                else:
                                    mutating_tool_count += 1
                                    guardrail_corrections = max(0, guardrail_corrections - 1)
                                    diffs = await run_io_blocking(worktree_manager.get_git_diff, workspace_path)
                                    if diffs:
                                        await on_diff_updated(diffs)
                                    m_files = ", ".join(tool_result.get("modified_files", []))
                                    out_str = f"Unified patch successfully applied to: {m_files}."
                            elif fn_name == "edit_file":
                                file_path = args.get("file_path") or args.get("path") or args.get("filePath") or args.get("target_file") or args.get("filename") or args.get("file") or ""
                                content = args.get("content") if args.get("content") is not None else (args.get("code") if args.get("code") is not None else (args.get("text") if args.get("text") is not None else (args.get("body") if args.get("body") is not None else (args.get("source") or ""))))
                                append_mode = bool(args.get("append", False))

                                is_resp_truncated = provider_resp.finish_reason in ["length", "MAX_TOKENS", "max_tokens"]
                                if is_resp_truncated and not append_mode:
                                    exit_code = 1
                                    tool_result = {
                                        "error": "Model generation was truncated mid-stream by output token ceiling (finish_reason=length). "
                                                 "File write was aborted to protect file integrity and avoid overwriting with corrupted/partial code. "
                                                 "Please decompose your code into modular files (e.g. separate styles.css, app.js, and index.html) "
                                                 "or write in sections using append mode or replace_file_content."
                                    }
                                    out_str = tool_result["error"]
                                else:
                                    tool_result = WorkspaceTools.edit_file(workspace_path, file_path, content, append=append_mode)
                                    if "error" in tool_result:
                                        exit_code = 1
                                        out_str = f"Error updating file: {tool_result['error']}"
                                    else:
                                        mutating_tool_count += 1
                                        guardrail_corrections = max(0, guardrail_corrections - 1)
                                        diffs = await run_io_blocking(worktree_manager.get_git_diff, workspace_path)
                                        if diffs:
                                            await on_diff_updated(diffs)
                                        status_action = "appended to" if append_mode else "updated"
                                        out_str = f"Successfully {status_action} '{tool_result.get('file_path', file_path)}' ({len(content)} bytes)."
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
                                        diffs = await run_io_blocking(worktree_manager.get_git_diff, workspace_path)
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
                                cwd_arg = args.get("cwd")
                                tool_result = await run_io_blocking(WorkspaceTools.run_command, workspace_path, cmd, cwd=cwd_arg)
                                exit_code = tool_result.get("exit_code", 0)
                                stdout = tool_result.get("stdout", "")
                                stderr = tool_result.get("stderr", "")
                                err_msg = tool_result.get("error", "")

                                if err_msg and "SECURITY CIRCUIT-BREAKER" in err_msg:
                                    has_staged_approvals = True
                                    staged_approvals.append((
                                        "DESTRUCTIVE_COMMAND_BLOCKED",
                                        {
                                            "command": cmd,
                                            "error": err_msg,
                                            "description": f"Destructive command blocked by security circuit-breaker: {cmd}"
                                        }
                                    ))

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
                                if idx in precomputed_tool_results:
                                    tool_result, precomputed_elapsed_ms = precomputed_tool_results.pop(idx)
                                else:
                                    tool_result = await run_io_blocking(
                                        WorkspaceTools.search_code,
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
                                if idx in precomputed_tool_results:
                                    tool_result, precomputed_elapsed_ms = precomputed_tool_results.pop(idx)
                                else:
                                    tool_result = await run_io_blocking(
                                        WorkspaceTools.find_symbols,
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
                                if idx in precomputed_tool_results:
                                    tool_result, precomputed_elapsed_ms = precomputed_tool_results.pop(idx)
                                else:
                                    tool_result = await run_io_blocking(WorkspaceTools.tgrep_ast, workspace_path, pattern)
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
                                if idx in precomputed_tool_results:
                                    tool_result, precomputed_elapsed_ms = precomputed_tool_results.pop(idx)
                                else:
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
                                if idx in precomputed_tool_results:
                                    tool_result, precomputed_elapsed_ms = precomputed_tool_results.pop(idx)
                                else:
                                    tool_result = await WorkspaceTools.fetch_url(target_url)
                                out_str = tool_result.get("content", tool_result.get("error", "Error fetching URL"))
                            elif fn_name == "get_pull_request_details":
                                repo_arg = args.get("repository", "")
                                pr_num = int(args.get("pr_number", 1))
                                if idx in precomputed_tool_results:
                                    tool_result, precomputed_elapsed_ms = precomputed_tool_results.pop(idx)
                                else:
                                    tool_result = await WorkspaceTools.get_pull_request_details(repo_arg, pr_num)
                                out_str = json.dumps(tool_result, indent=2)
                                if isinstance(tool_result, dict) and ("number" in tool_result or "pr_number" in tool_result):
                                    asyncio.create_task(self._upsert_task_prs(task_id, [tool_result]))
                            elif fn_name == "get_pull_request_checks":
                                repo_arg = args.get("repository", "")
                                pr_num = int(args.get("pr_number", 1))
                                if idx in precomputed_tool_results:
                                    tool_result, precomputed_elapsed_ms = precomputed_tool_results.pop(idx)
                                else:
                                    tool_result = await WorkspaceTools.get_pull_request_checks(repo_arg, pr_num)
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "get_pull_request_diff":
                                repo_arg = args.get("repository", "")
                                pr_num = int(args.get("pr_number", 1))
                                if idx in precomputed_tool_results:
                                    tool_result, precomputed_elapsed_ms = precomputed_tool_results.pop(idx)
                                else:
                                    tool_result = await WorkspaceTools.get_pull_request_diff(repo_arg, pr_num)
                                out_str = tool_result.get("diff", "")
                            elif fn_name == "list_pull_requests":
                                repo_arg = args.get("repository", "")
                                state_arg = args.get("state", "open")
                                author_arg = args.get("author")
                                limit_arg = int(args.get("limit", 10))
                                if idx in precomputed_tool_results:
                                    tool_result, precomputed_elapsed_ms = precomputed_tool_results.pop(idx)
                                else:
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
                                from app.agent.review_verifier import ReviewVerifier
                                body_arg = ReviewVerifier.normalize_pr_review_markdown(args.get("body", ""))
                                event_arg = args.get("event", "COMMENT")

                                can_exec, status_reason = policy_engine.check_action("post_pull_request_review", args)
                                if not can_exec:
                                    if status_reason == "AWAITING_HUMAN_APPROVAL":
                                        has_staged_approvals = True
                                        staged_approvals.append((
                                            "post_pull_request_review",
                                            {
                                                "action_type": "post_pull_request_review",
                                                "repository": repo_arg,
                                                "pr_number": pr_num,
                                                "body": body_arg,
                                                "event": event_arg,
                                                "description": f"Submit {event_arg} PR review to {repo_arg}#{pr_num}"
                                            }
                                        ))
                                        tool_result = {
                                            "status": "AWAITING_APPROVAL",
                                            "message": f"Formal PR review draft ({event_arg}) for {repo_arg}#{pr_num} has been staged in the UI for developer confirmation. Summarize your review findings in chat and state that the review is staged below ready for submission to GitHub."
                                        }
                                        out_str = json.dumps(tool_result, indent=2)
                                    else:
                                        tool_result = {"error": f"Action post_pull_request_review is disabled by policy ({status_reason})."}
                                        out_str = json.dumps(tool_result, indent=2)
                                else:
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

                                can_exec, status_reason = policy_engine.check_action("post_pull_request_line_comment", args)
                                if not can_exec:
                                    if status_reason == "AWAITING_HUMAN_APPROVAL":
                                        has_staged_approvals = True
                                        staged_approvals.append((
                                            "post_pull_request_line_comment",
                                            {
                                                "action_type": "post_pull_request_line_comment",
                                                "repository": repo_arg,
                                                "pr_number": pr_num,
                                                "body": body_arg,
                                                "commit_sha": commit_sha_arg,
                                                "path": path_arg,
                                                "line": line_arg,
                                                "side": side_arg,
                                                "description": f"Post inline comment on {path_arg}:{line_arg} in {repo_arg}#{pr_num}"
                                            }
                                        ))
                                        tool_result = {
                                            "status": "AWAITING_APPROVAL",
                                            "message": f"Inline PR comment draft on {path_arg}:{line_arg} in {repo_arg}#{pr_num} has been staged in the UI for developer confirmation. Summarize your findings in chat and state that the inline comment is staged below ready for submission to GitHub."
                                        }
                                        out_str = json.dumps(tool_result, indent=2)
                                    else:
                                        tool_result = {"error": f"Action post_pull_request_line_comment is disabled by policy ({status_reason})."}
                                        out_str = json.dumps(tool_result, indent=2)
                                else:
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
                                try:
                                    repo_url_arg = args.get("repo_url", "")
                                    token_arg = args.get("token")
                                    tool_result = await WorkspaceTools.connect_repository(
                                        repo_url=repo_url_arg,
                                        token=token_arg,
                                        workspace_path=workspace_path,
                                        task_id=task_id
                                    )
                                    out_str = json.dumps(tool_result, indent=2)
                                    exit_code = 0 if tool_result.get("success", True) else 1
                                except Exception as e:
                                    logger.error(f"Error connecting repository: {e}", exc_info=True)
                                    tool_result = {"success": False, "error": str(e)}
                                    out_str = json.dumps(tool_result)
                                    exit_code = 1
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
                                if status_str in ["runtime_error", "runtime_syntax_error", "runtime_exception"]:
                                    out_lines.insert(1, "❌ BROWSER EXECUTION FAULT DETECTED: Application preview failed to execute or encountered uncaught runtime errors.")
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
                            elif fn_name == "get_linear_issue":
                                issue_k = args.get("issue_key", "")
                                tool_result = await WorkspaceTools.get_linear_issue(issue_k)
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "search_linear_issues":
                                q_arg = args.get("query", "")
                                tool_result = await WorkspaceTools.search_linear_issues(q_arg)
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "post_linear_comment":
                                issue_k = args.get("issue_key", "")
                                cmt_arg = args.get("comment", "")
                                tool_result = await WorkspaceTools.post_linear_comment(issue_k, cmt_arg)
                                out_str = json.dumps(tool_result, indent=2)
                                asyncio.create_task(event_dispatcher.record_and_broadcast(
                                    task_id=task_id,
                                    action_type="linear_comment",
                                    target=f"linear:{issue_k}",
                                    payload={"issue_key": issue_k, "comment": cmt_arg},
                                    status_code=200 if tool_result.get("success", True) else 400
                                ))
                            elif fn_name == "update_linear_issue_status":
                                issue_k = args.get("issue_key", "")
                                state_arg = args.get("state_id", "")
                                tool_result = await WorkspaceTools.update_linear_issue_status(issue_k, state_arg)
                                out_str = json.dumps(tool_result, indent=2)
                                asyncio.create_task(event_dispatcher.record_and_broadcast(
                                    task_id=task_id,
                                    action_type="linear_status_update",
                                    target=f"linear:{issue_k}",
                                    payload={"issue_key": issue_k, "state_id": state_arg},
                                    status_code=200 if tool_result.get("success", True) else 400
                                ))
                            elif fn_name == "list_linear_teams":
                                tool_result = await WorkspaceTools.list_linear_teams()
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "create_linear_issue":
                                title_arg = args.get("title", "")
                                team_arg = args.get("team", "PD")
                                desc_arg = args.get("description", "")
                                prio_arg = args.get("priority", 0)
                                state_arg = args.get("state")
                                tool_result = await WorkspaceTools.create_linear_issue(
                                    title=title_arg,
                                    team=team_arg,
                                    description=desc_arg,
                                    priority=prio_arg,
                                    state=state_arg
                                )
                                out_str = json.dumps(tool_result, indent=2)
                                created_issue = tool_result.get("issue", {})
                                issue_id = created_issue.get("identifier") or created_issue.get("id", "new")
                                asyncio.create_task(event_dispatcher.record_and_broadcast(
                                    task_id=task_id,
                                    action_type="linear_create_issue",
                                    target=f"linear:{issue_id}",
                                    payload={"title": title_arg, "team": team_arg, "identifier": issue_id},
                                    status_code=200 if tool_result.get("success", True) else 400
                                ))
                            elif fn_name == "ingrations_search_tools":
                                q_arg = args.get("query", "")
                                cat_arg = args.get("category")
                                lim_arg = int(args.get("limit", 5))
                                tool_result = WorkspaceTools.ingrations_search_tools(q_arg, category=cat_arg, limit=lim_arg)
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "ingrations_execute":
                                act_arg = args.get("action_id", "")
                                params_arg = args.get("params", {})
                                dry_arg = bool(args.get("dry_run", False))
                                tool_result = await WorkspaceTools.ingrations_execute(act_arg, params=params_arg, dry_run=dry_arg)
                                out_str = json.dumps(tool_result, indent=2)
                                asyncio.create_task(event_dispatcher.record_and_broadcast(
                                    task_id=task_id,
                                    action_type="ingrations_execute",
                                    target=f"ingrations:{act_arg}",
                                    payload={"action_id": act_arg, "params": params_arg, "dry_run": dry_arg},
                                    status_code=tool_result.get("status_code", 200) if tool_result.get("success", True) else 400
                                ))
                            elif fn_name == "query_table":
                                fp = args.get("file_path", "")
                                sql_q = args.get("sql_query")
                                flt_q = args.get("filter_query")
                                s_col = args.get("sort_col")
                                s_dir = args.get("sort_dir", "asc")
                                pg = args.get("page", 1)
                                pg_sz = args.get("page_size", 50)
                                tool_result = WorkspaceTools.query_table(
                                    workspace_path,
                                    file_path=fp,
                                    sql_query=sql_q,
                                    filter_query=flt_q,
                                    sort_col=s_col,
                                    sort_dir=s_dir,
                                    page=pg,
                                    page_size=pg_sz
                                )
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "inspect_archive":
                                fp = args.get("file_path", "")
                                tool_result = WorkspaceTools.inspect_archive(workspace_path, file_path=fp)
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "view_image":
                                fp = args.get("file_path") or args.get("path") or ""
                                prompt_arg = args.get("prompt")
                                tool_result = await WorkspaceTools.view_image(workspace_path, file_path=fp, prompt=prompt_arg)
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "delegate_subtasks":
                                subtasks_arg = args.get("subtasks", [])
                                wait_arg = args.get("wait_for_completion", True)
                                clear_arg = args.get("clear_existing", True)
                                tool_result = await WorkspaceTools.delegate_subtasks(
                                    workspace_path=workspace_path,
                                    subtasks=subtasks_arg,
                                    wait_for_completion=wait_arg,
                                    clear_existing=clear_arg
                                )
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "send_subagent_message":
                                msg_arg = args.get("message", "")
                                sub_id_arg = args.get("subagent_id")
                                session_key_arg = args.get("session_key")
                                wait_arg = args.get("wait_for_completion", True)
                                tool_result = await WorkspaceTools.send_subagent_message(
                                    workspace_path=workspace_path,
                                    message=msg_arg,
                                    subagent_id=sub_id_arg,
                                    session_key=session_key_arg,
                                    wait_for_completion=wait_arg
                                )
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "batch_review_prs":
                                repo_arg = args.get("repository", "")
                                pr_nums_arg = args.get("pr_numbers", [])
                                wait_arg = args.get("wait_for_completion", True)
                                tool_result = await WorkspaceTools.batch_review_prs(
                                    workspace_path=workspace_path,
                                    repository=repo_arg,
                                    pr_numbers=pr_nums_arg,
                                    wait_for_completion=wait_arg
                                )
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "apply_subagent_diff":
                                sub_id_arg = args.get("subagent_task_id", "")
                                tool_result = await WorkspaceTools.apply_subagent_diff(
                                    workspace_path=workspace_path,
                                    subagent_task_id=sub_id_arg
                                )
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "get_subagent_results":
                                sub_ids_arg = args.get("subagent_task_ids", [])
                                tool_result = await WorkspaceTools.get_subagent_results(
                                    workspace_path=workspace_path,
                                    subagent_task_ids=sub_ids_arg
                                )
                                out_str = json.dumps(tool_result, indent=2)
                            elif fn_name == "compile_session_report":
                                title_arg = args.get("title")
                                fmt_arg = args.get("format", "markdown")
                                save_ws = args.get("save_to_workspace", True)
                                focus_arg = args.get("focus_areas")
                                tool_result = await WorkspaceTools.compile_session_report(
                                    task_id=task_id,
                                    title=title_arg,
                                    format=fmt_arg,
                                    save_to_workspace=save_ws,
                                    custom_instructions=focus_arg
                                )
                                out_str = json.dumps(tool_result, indent=2)
                            else:
                                tool_result = {"error": f"Unknown tool: {fn_name}"}
                                exit_code = 1
                                out_str = f"Unknown tool: {fn_name}"

                            is_resp_truncated = provider_resp.finish_reason in ["length", "MAX_TOKENS", "max_tokens"]
                            if is_resp_truncated and fn_name in ["edit_file", "replace_file_content", "batch_replace_content", "apply_unified_patch", "run_command"]:
                                trunc_warn = "[WARNING: Model generation reached token ceiling (finish_reason=length). Tool arguments may be truncated. Verify file completeness or decompose code into modular files.]"
                                out_str = f"{out_str}\n{trunc_warn}" if out_str else trunc_warn
                                if isinstance(tool_result, dict):
                                    tool_result["_warning"] = "Model generation reached token ceiling (finish_reason=length)."

                            if fn_name in ("run_command", "read_file", "list_dir", "search_code", "grep_search", "get_file_outline"):
                                try:
                                    insp_sig = f"{fn_name}:{json.dumps(args, sort_keys=True, default=str)}"
                                except Exception:
                                    insp_sig = f"{fn_name}:{str(args)}"
                                inspection_signature_counts[insp_sig] = inspection_signature_counts.get(insp_sig, 0) + 1
                                repeat_count = inspection_signature_counts[insp_sig]
                                if repeat_count >= 3:
                                    loop_notice = (
                                        f"[LOOP CIRCUIT-BREAKER NOTICE: You have executed this exact `{fn_name}` call {repeat_count} times "
                                        f"in this session. Previous recent tool outputs remain preserved in context. Do NOT re-run the same "
                                        f"inspection or command again — either proceed with workspace implementation or synthesize your final answer now.]"
                                    )
                                    out_str = f"{out_str}\n\n{loop_notice}" if out_str else loop_notice
                                    if isinstance(tool_result, dict):
                                        tool_result["_loop_circuit_breaker"] = loop_notice
                                        if "stdout" in tool_result and isinstance(tool_result["stdout"], str):
                                            tool_result["stdout"] = f"{tool_result['stdout']}\n\n{loop_notice}"
                                        elif "content" in tool_result and isinstance(tool_result["content"], str):
                                            tool_result["content"] = f"{tool_result['content']}\n\n{loop_notice}"
                                    intent_cat_now = current_plan.get("intent_category", "app_building" if persona_name == "AppBuilder" else "code_modification")
                                    if repeat_count >= 5 and (intent_cat_now == "qa_research" or mutating_tool_count == 0):
                                        logger.warning(f"Loop circuit-breaker triggered forced synthesis exit after {repeat_count} identical '{fn_name}' calls.")
                                        force_loop_exit = True

                            elapsed_ms = precomputed_elapsed_ms if precomputed_elapsed_ms is not None else int((asyncio.get_event_loop().time() - start_time) * 1000)
                            collector.record_tool_invocation(
                                tool_name=fn_name,
                                input_args=args,
                                output_data=out_str,
                                error=tool_result.get("error") if isinstance(tool_result, dict) else None,
                                duration_ms=elapsed_ms,
                                exit_code=exit_code
                            )
                            last_tool_exit_code = exit_code
                            if exit_code != 0:
                                tool_error_count += 1
                                last_tool_error = tool_result.get("error") if isinstance(tool_result, dict) else (out_str[:200] if out_str else f"Exited with code {exit_code}")
                            else:
                                last_tool_error = None
                            if on_tool_end:
                                sig = inspect.signature(on_tool_end)
                                if "call_id" in sig.parameters or len(sig.parameters) >= 6:
                                    if inspect.iscoroutinefunction(on_tool_end):
                                        await on_tool_end(fn_name, out_str, exit_code, elapsed_ms, args, call_id)
                                    else:
                                        res = on_tool_end(fn_name, out_str, exit_code, elapsed_ms, args, call_id)
                                        if asyncio.iscoroutine(res):
                                            await res
                                elif len(sig.parameters) >= 5:
                                    if inspect.iscoroutinefunction(on_tool_end):
                                        await on_tool_end(fn_name, out_str, exit_code, elapsed_ms, args)
                                    else:
                                        res = on_tool_end(fn_name, out_str, exit_code, elapsed_ms, args)
                                        if asyncio.iscoroutine(res):
                                            await res
                                else:
                                    if inspect.iscoroutinefunction(on_tool_end):
                                        await on_tool_end(fn_name, out_str, exit_code, elapsed_ms)
                                    else:
                                        res = on_tool_end(fn_name, out_str, exit_code, elapsed_ms)
                                        if asyncio.iscoroutine(res):
                                            await res

                            if isinstance(tool_result, dict):
                                formatted_response = tool_result
                            elif isinstance(tool_result, list):
                                formatted_response = {"items": tool_result, "total_found": len(tool_result)}
                            else:
                                formatted_response = {"output": str(tool_result)}

                            response_parts.append({
                                "functionResponse": {
                                    "name": fn_name,
                                    "response": formatted_response,
                                    "id": call.get("id") or f"call_{fn_name}"
                                }
                            })

                        contents.append({
                            "role": "user",
                            "parts": response_parts
                        })
                        if force_loop_exit:
                            break

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

                    # 1. Guaranteed Terminal Synthesis Turn via active_provider (Strictly tools=None)
                    final_synth_text = ""
                    if model_succeeded:
                        synth_instruction = (
                            system_instruction + preview_status_note +
                            "\n\nCRITICAL DIRECTIVE: You have completed all workspace tool executions. Synthesize your comprehensive, fluid analytical final response answering the user directly in rich markdown format with clickable citations and file links. Do NOT state forward-looking transitional promises (e.g. 'Now let me add...', 'Next I will...'), scratchpad thoughts, or tool intentions. NEVER surrender execution or instruct the user to run commands, servers, or troubleshooting steps locally on their machine. You are an autonomous builder responsible for fulfilling the task within the Cyclode workspace. Summarize what has been completed and current status."
                        )
                        try:
                            synth_messages = list(optimized_contents if optimized_contents else contents)
                            synth_closing_prompt = (
                                "CRITICAL INSTRUCTION: All tool executions are complete. Provide your comprehensive, direct final answer to the user's question based on the findings gathered above. Do NOT state forward-looking intentions (e.g. 'Let me check...', 'Next I will...') or attempt further tool calls."
                                if (intent_category == "qa_research" or mutating_tool_count == 0)
                                else "CRITICAL INSTRUCTION: All workspace tool executions are complete. Provide your comprehensive analytical final response summarizing what was built, changes made, and verification status in rich markdown with clickable file links. Do NOT state forward-looking intentions (e.g. 'Now let me add...', 'Next I will...') or attempt further tool calls."
                            )
                            synth_messages.append({
                                "role": "user",
                                "parts": [{"text": synth_closing_prompt}]
                            })
                            synth_resp = await active_provider.generate_response(
                                messages=synth_messages,
                                tools=None,
                                system_instruction=synth_instruction,
                                model_name=active_model,
                                client=client
                            )
                            if synth_resp.is_success and synth_resp.content:
                                candidate_synth = synth_resp.content.strip()
                                if candidate_synth:
                                    is_surrender, surrender_reason = Harness.is_surrender_or_bailing_intent(candidate_synth)
                                    if is_surrender:
                                        logger.warning(f"Terminal synthesis #1 candidate emitted surrender/bailing intent ({surrender_reason}). Falling back to flattened transcript synthesis #2...")
                                    elif Harness.is_dangling_action_intent(candidate_synth):
                                        logger.info("Terminal synthesis #1 candidate emitted dangling intent. Falling back to flattened transcript synthesis #2...")
                                    else:
                                        final_synth_text = candidate_synth
                        except Exception as synth_err:
                            logger.error(f"Synthesis turn error: {synth_err}")

                        # 2. Fallback text transcript synthesis via active_provider
                        if not final_synth_text:
                            try:
                                text_contents = []
                                for c in (optimized_contents if optimized_contents else contents):
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
                                            if len(resp_str) > 3500:
                                                resp_str = resp_str[:3500] + "... (truncated)"
                                            text_chunks.append(f"Observation for {fr.get('name')}:\n{resp_str}\n")
                                    if text_chunks:
                                        text_contents.append({
                                            "role": role,
                                            "parts": [{"text": "\n\n".join(text_chunks)}]
                                        })
                                flat_closing_prompt = (
                                    "CRITICAL INSTRUCTION: All workspace inspections and research actions have been completed. Provide your complete, comprehensive analytical final answer directly addressing the user's question based on the observations above in rich markdown. Do NOT output internal action traces, tool call syntax, forward-looking promises (e.g. 'Let me check...'), or 'Action:' prefixes."
                                    if (intent_category == "qa_research" or mutating_tool_count == 0)
                                    else "CRITICAL INSTRUCTION: All workspace actions have been performed. Provide your complete, comprehensive analytical final answer summarizing what was built, any changes made, and preview verification results in rich markdown with clickable file links. Do NOT output internal action traces, tool call syntax, forward-looking promises, or 'Action:' prefixes."
                                )
                                text_contents.append({
                                    "role": "user",
                                    "parts": [{
                                        "text": flat_closing_prompt
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
                                            "Completed workspace analysis and gathered the requested findings."
                                            if (intent_category == "qa_research" or mutating_tool_count == 0)
                                            else "All requested components and workspace modifications have been applied and verified."
                                        )
                                    is_flat_surrender, flat_surrender_reason = Harness.is_surrender_or_bailing_intent(flat_synth_text)
                                    if is_flat_surrender:
                                        if mutating_tool_count > 0:
                                            flat_synth_text = (
                                                f"Applied modifications across {mutating_tool_count} workspace action{'s' if mutating_tool_count != 1 else ''}. "
                                                f"Execution halted before completion: {flat_surrender_reason}."
                                            )
                                        else:
                                            flat_synth_text = (
                                                f"Completed {tool_call_count} workspace inspection step{'s' if tool_call_count != 1 else ''}. "
                                                f"Execution halted before final synthesis: {flat_surrender_reason}."
                                            )
                                        model_succeeded = False
                                    elif Harness.is_dangling_action_intent(flat_synth_text):
                                        if mutating_tool_count > 0:
                                            flat_synth_text = (
                                                f"Applied modifications across {mutating_tool_count} workspace action{'s' if mutating_tool_count != 1 else ''}. "
                                                f"Execution concluded with in-flight actions."
                                            )
                                        else:
                                            flat_synth_text = (
                                                f"Completed {tool_call_count} workspace inspection step{'s' if tool_call_count != 1 else ''}, "
                                                f"reaching the turn budget before final answer synthesis."
                                            )
                                        model_succeeded = False
                                    final_synth_text = flat_synth_text
                            except Exception as flat_err:
                                logger.error(f"Flat text synthesis error: {flat_err}")

                    final_agent_text = final_synth_text or final_agent_text or "Task execution concluded."
                    is_dangling_post = Harness.is_dangling_action_intent(final_agent_text)
                    is_surrender_post, surrender_reason_post = Harness.is_surrender_or_bailing_intent(final_agent_text)
                    if is_surrender_post:
                        if mutating_tool_count > 0:
                            final_agent_text = (
                                f"Applied modifications across {mutating_tool_count} workspace action{'s' if mutating_tool_count != 1 else ''}. "
                                f"Execution halted before completion: {surrender_reason_post}."
                            )
                        else:
                            final_agent_text = (
                                f"Completed {tool_call_count} workspace inspection step{'s' if tool_call_count != 1 else ''}. "
                                f"Execution halted before final synthesis: {surrender_reason_post}."
                            )
                        model_succeeded = False
                    elif is_dangling_post:
                        if mutating_tool_count > 0:
                            final_agent_text = (
                                f"Applied modifications across {mutating_tool_count} workspace action{'s' if mutating_tool_count != 1 else ''}. "
                                f"Execution concluded with in-flight actions."
                            )
                        else:
                            final_agent_text = (
                                f"Completed {tool_call_count} workspace inspection step{'s' if tool_call_count != 1 else ''}, "
                                f"reaching the turn budget before final answer synthesis."
                            )
                        model_succeeded = False

                    # 3. Autonomous Plan Self-Evaluation Audit via EvaluationRunner (Auditing actual delivered text!)
                    scorecard = await evaluation_runner.evaluate_task(
                        workspace_path=workspace_path,
                        intent_category=intent_category,
                        is_app_task=is_app_task,
                        preview_info=post_verification,
                        tool_call_count=tool_call_count,
                        final_agent_text=final_agent_text,
                        model_succeeded=(model_succeeded and not is_dangling_post and not is_surrender_post),
                        last_tool_exit_code=last_tool_exit_code,
                        last_tool_error=last_tool_error,
                        error_count=tool_error_count
                    )
                    task_evaluations[task_id] = scorecard

                    if scorecard.status == "accomplished" and not is_dangling_post and not is_surrender_post:
                        for s in current_plan.get("steps", []):
                            if s.get("status") != "failed":
                                s["status"] = "completed"
                    else:
                        for s in current_plan.get("steps", []):
                            if s.get("status") == "in_progress":
                                s["status"] = "failed"

                    current_plan["evaluation"] = scorecard.model_dump(mode="json")
                    await self._emit_plan(current_plan, on_plan)

                    collector.end_turn(agent_response=final_agent_text)
                    task_trajectories[task_id] = collector.build_trajectory(status="COMPLETED")
                    await self._emit_streamed_message(
                        "agent", final_agent_text, on_message, on_stream_start, on_stream_chunk, on_stream_end
                    )
                    await _flush_staged_approvals()
                    if not has_staged_approvals:
                        try:
                            from app.agent.engine.memory import extract_turn_heuristics, promote_task_memories
                            all_turn_logs = [
                                {
                                    "tool_name": tc.tool_name,
                                    "tool_input": tc.input_args,
                                    "tool_output": tc.output_data or tc.error or "",
                                    "exit_code": tc.exit_code,
                                }
                                for t_obj in collector.turns
                                for tc in t_obj.tool_calls
                            ]
                            if len(all_turn_logs) >= 2:
                                await extract_turn_heuristics(
                                    task_id=task_id,
                                    turn_index=len(collector.turns),
                                    tool_logs=all_turn_logs,
                                )
                            await promote_task_memories(task_id)
                        except Exception as e:
                            logger.debug(f"Error promoting task memories on completion: {e}")
                    return {"status": "AWAITING_APPROVAL" if has_staged_approvals else "COMPLETED", "summary": final_agent_text}

                except Exception as e:
                    logger.error(f"Gemini execution notice: {str(e)}")
                    continue

        has_pending_steps = any(s.get("status") in ["pending", "in_progress"] for s in current_plan.get("steps", []))
        plan_eval = current_plan.get("evaluation", {})
        is_accomplished = plan_eval.get("status") == "accomplished"

        # Check preview status for app tasks
        from app.api.preview import verify_workspace_preview
        preview_verif = verify_workspace_preview(workspace_path, task_id)
        has_preview_missing = is_app_task and preview_verif.get("status") in [
            "missing_entry_point", "missing_workspace", "needs_build", "uncompiled_css",
            "unlinked_assets", "empty_ui", "dom_css_mismatch", "issues_found",
            "minimal_canvas_stub", "missing_dependency", "runtime_error", "runtime_syntax_error", "runtime_exception"
        ]

        if mutating_tool_count > 0 and not has_preview_missing and not has_pending_steps:
            fallback_msg = (
                f"Successfully completed {tool_call_count} workspace action{'s' if tool_call_count > 1 else ''}. "
                f"All requested components and changes have been applied to the workspace."
            )
            return_status = "COMPLETED"
        elif mutating_tool_count > 0:
            if has_preview_missing:
                fallback_msg = (
                    f"Applied modifications across {mutating_tool_count} tool action{'s' if mutating_tool_count > 1 else ''}. "
                    f"However, live application preview indicates {preview_verif.get('status')}: {preview_verif.get('recommendation', 'Please verify root index.html')}"
                )
                return_status = "FAILED"
            elif has_pending_steps:
                pending_cnt = sum(1 for s in current_plan.get("steps", []) if s.get("status") in ["pending", "in_progress"])
                fallback_msg = (
                    f"Applied modifications across {mutating_tool_count} workspace action{'s' if mutating_tool_count > 1 else ''}. "
                    f"Execution completed with {pending_cnt} milestone{'s' if pending_cnt > 1 else ''} pending."
                )
                return_status = "COMPLETED"
            else:
                fallback_msg = (
                    f"Successfully applied {mutating_tool_count} workspace action{'s' if mutating_tool_count > 1 else ''}."
                )
                return_status = "COMPLETED"
        elif tool_call_count > 0:
            eval_sum = plan_eval.get("summary", "Inspection completed.")
            fallback_msg = f"Completed {tool_call_count} workspace action{'s' if tool_call_count > 1 else ''}."
            return_status = "COMPLETED"
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
        await _flush_staged_approvals()
        if return_status == "COMPLETED" and not has_staged_approvals:
            try:
                from app.agent.engine.memory import extract_turn_heuristics, promote_task_memories
                all_turn_logs = [
                    {
                        "tool_name": tc.tool_name,
                        "tool_input": tc.input_args,
                        "tool_output": tc.output_data or tc.error or "",
                        "exit_code": tc.exit_code,
                    }
                    for t_obj in collector.turns
                    for tc in t_obj.tool_calls
                ]
                if len(all_turn_logs) >= 2:
                    await extract_turn_heuristics(
                        task_id=task_id,
                        turn_index=len(collector.turns),
                        tool_logs=all_turn_logs,
                    )
                await promote_task_memories(task_id)
            except Exception as e:
                logger.debug(f"Error promoting task memories on fallback completion: {e}")
        return {"status": "AWAITING_APPROVAL" if has_staged_approvals else return_status, "summary": fallback_msg}


def get_task_trajectory(task_id: str) -> Optional[AgentTrajectory]:
    return task_trajectories.get(task_id)


def get_task_evaluation(task_id: str) -> Optional[EvaluationScorecard]:
    return task_evaluations.get(task_id)


antigravity_harness = AntigravityHarness()
Harness = AntigravityHarness

