import asyncio
import inspect
import json
import logging
import os
import re
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


class AntigravityHarness:
    """
    Antigravity Agent Harness: Universal LLM-native execution engine.
    Orchestrates dynamic multi-turn tool calling across Workspace, GitHub, AST symbol search,
    and live web intelligence with real-time streaming and telemetry.
    """

    def __init__(self, model_name: Optional[str] = None):
        self.model_name = model_name or settings.ANTIGRAVITY_MODEL

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
            await on_thought(thought_text)
        else:
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
            await on_message(sender, content)
        else:
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
        on_stream_end: Optional[Callable[[str, str, str], Any]] = None
    ) -> Dict[str, Any]:
        """
        Executes an agent task directly via the LLM-First ReAct engine with native function calling.
        """
        raw_prompt = description or title

        # 1. Pre-process secrets into Vault and mask them
        sanitized_prompt, extracted_creds = await VaultInterceptor.process_prompt(raw_prompt)

        gemini_creds = integration_manager._custom_credentials.get("gemini", {})
        api_key = extracted_creds.get("gemini_api_key") or gemini_creds.get("api_key") or settings.get_api_key()

        # Ensure workspace directory exists
        workspace_path.mkdir(parents=True, exist_ok=True)

        # 2. Check for configured LLM API Key
        if not api_key:
            guidance_msg = (
                f"### 🤖 LLM Model Configuration Required\n\n"
                f"To run autonomous code reviews, synthesize PR diffs, and orchestrate workspace tools, please configure an LLM provider:\n\n"
                f"1. **Gemini API Key**: Set `GEMINI_API_KEY` in your `.env` file or configure it in **Settings > Integrations**.\n"
                f"2. **ChatOps Provisioning**: Reply directly in this chat with your API key (`AIzaSy...`), and I'll immediately hot-load it into your session vault!\n\n"
                f"*Standing by for credentials to proceed with your task.*"
            )
            await self._emit_streamed_message(
                "agent", guidance_msg, on_message, on_stream_start, on_stream_chunk, on_stream_end
            )
            return {"status": "AWAITING_INPUT", "summary": "Awaiting LLM API Key configuration."}

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
            on_stream_end=on_stream_end
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
        on_stream_end: Optional[Callable[[str, str, str], Any]] = None
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
                        "description": "Read file contents from the workspace.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "file_path": {"type": "STRING", "description": "Relative path to file"}
                            },
                            "required": ["file_path"]
                        }
                    },
                    {
                        "name": "edit_file",
                        "description": "Write or overwrite content of a file in the workspace.",
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
                        "description": "Create a new pull request on GitHub.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "repository": {"type": "STRING", "description": "Repository in owner/repo format"},
                                "title": {"type": "STRING", "description": "Pull request title"},
                                "body": {"type": "STRING", "description": "Pull request description"},
                                "head_branch": {"type": "STRING", "description": "Source head branch"},
                                "base_branch": {"type": "STRING", "description": "Target base branch (default: main)"}
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

        model_candidates = [self.model_name, "gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"]
        unique_models = list(dict.fromkeys(m for m in model_candidates if m))

        contents: List[Dict[str, Any]] = []
        if history:
            for msg in history:
                role = "user" if msg.get("sender") == "user" else "model"
                text = msg.get("content", "")
                if text and not msg.get("thought"):
                    contents.append({"role": role, "parts": [{"text": text}]})

        if not contents or contents[-1].get("role") != "user":
            contents.append({"role": "user", "parts": [{"text": prompt}]})

        logger.info(f"Connecting to Gemini API using model {self.model_name}...")

        async with httpx.AsyncClient(timeout=45.0) as client:
            quota_exhausted = False
            for active_model in unique_models:
                if quota_exhausted:
                    break
                api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{active_model}:generateContent?key={api_key}"
                turn = 0
                max_turns = 12
                model_succeeded = False
                final_agent_text = ""

                try:
                    while turn < max_turns:
                        turn += 1
                        payload = {
                            "contents": contents,
                            "system_instruction": {"parts": [{"text": system_instruction}]},
                            "tools": tools_def
                        }

                        resp = await client.post(api_url, json=payload)
                        if resp.status_code == 404:
                            break
                        if resp.status_code == 429:
                            err_text = "Your prepayment credits are depleted or quota limit reached in Google AI Studio."
                            try:
                                err_data = resp.json()
                                err_text = err_data.get("error", {}).get("message", err_text)
                            except Exception:
                                pass
                            logger.warning(f"Google AI Studio Quota Notice (429): {err_text}")
                            quota_exhausted = True
                            quota_thought = (
                                f"⚠️ **Google Gemini API Quota Notice (429)**: {err_text}\n\n"
                                f"💡 *Please configure prepayment credits at https://ai.studio/projects or paste a new API key (`AIzaSy...`) in chat.*"
                            )
                            await self._emit_streamed_thought(
                                quota_thought, on_thought, on_stream_start, on_stream_chunk, on_stream_end
                            )
                            break
                        if resp.status_code != 200:
                            err_msg = resp.text[:200]
                            logger.warning(f"API notice on turn {turn} model {active_model} ({resp.status_code}): {err_msg}")
                            break

                        model_succeeded = True
                        data = resp.json()
                        candidates = data.get("candidates", [])
                        if not candidates:
                            break

                        candidate = candidates[0]
                        parts = candidate.get("content", {}).get("parts", [])

                        function_calls = [p["functionCall"] for p in parts if "functionCall" in p]
                        text_parts = [p["text"] for p in parts if "text" in p]

                        if text_parts:
                            combined_text = "\n".join(text_parts).strip()
                            final_agent_text = combined_text
                            if function_calls:
                                await self._emit_streamed_thought(
                                    combined_text, on_thought, on_stream_start, on_stream_chunk, on_stream_end
                                )
                            else:
                                await self._emit_streamed_message(
                                    "agent", combined_text, on_message, on_stream_start, on_stream_chunk, on_stream_end
                                )

                        if not function_calls:
                            final_text = "\n".join(text_parts) if text_parts else "Task execution completed."
                            return {"status": "COMPLETED", "summary": final_text[:120]}

                        contents.append({
                            "role": "model",
                            "parts": parts
                        })

                        response_parts = []
                        for call in function_calls:
                            fn_name = call.get("name")
                            args = call.get("args", {})
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

                            if fn_name == "list_dir":
                                subpath = args.get("subpath", ".")
                                tool_result = WorkspaceTools.list_dir(workspace_path, subpath)
                                items = tool_result.get("items", [])
                                if items:
                                    out_str = "\n".join(
                                        f"{'📁' if i.get('is_dir') else '📄'} {i.get('name')}" +
                                        (f" ({i.get('size')} B)" if i.get('size') is not None else "")
                                        for i in items
                                    )
                                else:
                                    out_str = f"Directory '{subpath}' is empty."
                            elif fn_name == "read_file":
                                file_path = args.get("file_path", "")
                                tool_result = WorkspaceTools.read_file(workspace_path, file_path)
                                if "content" in tool_result:
                                    out_str = tool_result["content"]
                                else:
                                    out_str = tool_result.get("error", "Error reading file")
                            elif fn_name == "edit_file":
                                file_path = args.get("file_path", "")
                                content = args.get("content", "")
                                tool_result = WorkspaceTools.edit_file(workspace_path, file_path, content)
                                diffs = worktree_manager.get_git_diff(workspace_path)
                                if diffs:
                                    await on_diff_updated(diffs)
                                out_str = f"Successfully updated '{file_path}' ({len(content)} bytes)."
                            elif fn_name == "run_command":
                                cmd = args.get("command", "")
                                tool_result = WorkspaceTools.run_command(workspace_path, cmd)
                                exit_code = tool_result.get("exit_code", 0)
                                stdout = tool_result.get("stdout", "")
                                stderr = tool_result.get("stderr", "")
                                out_parts = []
                                if stdout:
                                    out_parts.append(stdout)
                                if stderr:
                                    out_parts.append(f"stderr:\n{stderr}")
                                if not out_parts:
                                    out_parts.append(f"(Command executed with exit code {exit_code})")
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
                            elif fn_name == "create_pull_request":
                                repo_arg = args.get("repository", "")
                                title_arg = args.get("title", "")
                                body_arg = args.get("body", "")
                                head_branch_arg = args.get("head_branch", "")
                                base_branch_arg = args.get("base_branch", "main")
                                tool_result = await WorkspaceTools.create_pull_request(
                                    repo_arg, title_arg, body_arg, head_branch_arg, base_branch_arg
                                )
                                out_str = json.dumps(tool_result, indent=2)
                                if isinstance(tool_result, dict) and ("number" in tool_result or "pr_number" in tool_result):
                                    asyncio.create_task(self._upsert_task_prs(task_id, [tool_result]))
                            elif fn_name == "connect_repository":
                                repo_url_arg = args.get("repo_url", "")
                                token_arg = args.get("token")
                                tool_result = await WorkspaceTools.connect_repository(repo_url_arg, token_arg)
                                out_str = json.dumps(tool_result, indent=2)
                            else:
                                tool_result = {"error": f"Unknown tool: {fn_name}"}
                                exit_code = 1
                                out_str = f"Unknown tool: {fn_name}"

                            elapsed_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)
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
                                    "response": tool_result
                                }
                            })

                        contents.append({
                            "role": "user",
                            "parts": response_parts
                        })

                    if model_succeeded:
                        # Perform a guaranteed synthesis turn without further tool executions.
                        # Supply tools_def so prior functionResponse entries pass schema validation,
                        # and configure function_calling_config mode="NONE" to instruct the model to produce final text.
                        synthesis_payload = {
                            "contents": contents,
                            "system_instruction": {
                                "parts": [{
                                    "text": system_instruction + "\n\nCRITICAL DIRECTIVE: You have completed all tool executions. Synthesize your comprehensive, fluid analytical response answering the user directly in rich markdown format with clickable citations. Do not call any further tools."
                                }]
                            },
                            "tools": tools_def,
                            "tool_config": {
                                "function_calling_config": {
                                    "mode": "NONE"
                                }
                            }
                        }
                        try:
                            synth_resp = await client.post(api_url, json=synthesis_payload)
                            if synth_resp.status_code == 200:
                                synth_data = synth_resp.json()
                                synth_cands = synth_data.get("candidates", [])
                                if synth_cands:
                                    s_parts = synth_cands[0].get("content", {}).get("parts", [])
                                    s_texts = [p["text"] for p in s_parts if "text" in p]
                                    if s_texts:
                                        final_synth_text = "\n".join(s_texts).strip()
                                        await self._emit_streamed_message(
                                            "agent", final_synth_text, on_message, on_stream_start, on_stream_chunk, on_stream_end
                                        )
                                        return {"status": "COMPLETED", "summary": final_synth_text[:120]}
                            else:
                                logger.warning(f"Synthesis turn status {synth_resp.status_code}: {synth_resp.text[:200]}")
                        except Exception as synth_err:
                            logger.error(f"Synthesis turn error: {synth_err}")

                        # Fallback synthesis: convert function calls/responses into a clean text transcript
                        # and request pure text generation to ensure 100% synthesis completion.
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
                                        text_chunks.append(f"[Executed Tool: {fc.get('name')}({json.dumps(fc.get('args', {}))})]")
                                    elif "functionResponse" in p:
                                        fr = p["functionResponse"]
                                        resp_val = fr.get("response", {})
                                        resp_str = json.dumps(resp_val) if isinstance(resp_val, (dict, list)) else str(resp_val)
                                        text_chunks.append(f"[Tool Result for {fr.get('name')}:\n{resp_str[:1500]}\n]")
                                if text_chunks:
                                    text_contents.append({
                                        "role": role,
                                        "parts": [{"text": "\n\n".join(text_chunks)}]
                                    })
                            text_contents.append({
                                "role": "user",
                                "parts": [{
                                    "text": "Please provide your complete, detailed analytical final answer synthesizing all findings from the tools above. Use rich markdown with clickable links."
                                }]
                            })
                            flat_payload = {
                                "contents": text_contents,
                                "system_instruction": {
                                    "parts": [{"text": system_instruction}]
                                }
                            }
                            flat_resp = await client.post(api_url, json=flat_payload)
                            if flat_resp.status_code == 200:
                                flat_data = flat_resp.json()
                                flat_cands = flat_data.get("candidates", [])
                                if flat_cands:
                                    f_parts = flat_cands[0].get("content", {}).get("parts", [])
                                    f_texts = [p["text"] for p in f_parts if "text" in p]
                                    if f_texts:
                                        flat_synth_text = "\n".join(f_texts).strip()
                                        await self._emit_streamed_message(
                                            "agent", flat_synth_text, on_message, on_stream_start, on_stream_chunk, on_stream_end
                                        )
                                        return {"status": "COMPLETED", "summary": flat_synth_text[:120]}
                        except Exception as flat_err:
                            logger.error(f"Flat text synthesis error: {flat_err}")

                    if model_succeeded and final_agent_text:
                        await self._emit_streamed_message(
                            "agent", final_agent_text, on_message, on_stream_start, on_stream_chunk, on_stream_end
                        )
                        return {"status": "COMPLETED", "summary": final_agent_text[:120]}

                except Exception as e:
                    logger.error(f"Gemini execution notice: {str(e)}")
                    continue

        fallback_msg = (
            f"Execution completed. All available tools and models have finished processing this turn."
        )
        await self._emit_streamed_message(
            "agent", fallback_msg, on_message, on_stream_start, on_stream_chunk, on_stream_end
        )
        return {"status": "COMPLETED", "summary": "Execution completed."}


antigravity_harness = AntigravityHarness()
