import asyncio
import inspect
import json
import logging
import os
import re
import shutil
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
from app.agent.handlers import (
    IntentContext,
    VaultInterceptor,
    intent_registry,
    RepoAnalysisHandler
)


class AntigravityHarness:
    """
    Antigravity Agent Harness: interfaces directly with Gemini models via native function-calling
    or dispatches cleanly through the modular offline semantic intent engine.
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
        Executes an agent task dynamically based on real intent.
        """
        raw_prompt = description or title

        # Pre-process secrets into Vault and mask them
        sanitized_prompt, extracted_creds = await VaultInterceptor.process_prompt(raw_prompt)

        gemini_creds = integration_manager._custom_credentials.get("gemini", {})
        api_key = extracted_creds.get("gemini_api_key") or gemini_creds.get("api_key") or settings.get_api_key()

        # Ensure workspace directory exists
        workspace_path.mkdir(parents=True, exist_ok=True)

        # ----------------------------------------------------------------------
        # MODE 1: LIVE GEMINI API (When API key is provided)
        # ----------------------------------------------------------------------
        if api_key:
            return await self._execute_with_gemini_api(
                api_key=api_key,
                task_id=task_id,
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

        # ----------------------------------------------------------------------
        # MODE 2: INTENT-AWARE MODULAR HARNESS (When offline / no API key)
        # ----------------------------------------------------------------------
        return await self._execute_local_intent(
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
            on_stream_start=on_stream_start,
            on_stream_chunk=on_stream_chunk,
            on_stream_end=on_stream_end,
            extra=extracted_creds
        )

    async def _execute_local_intent(
        self,
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
        on_stream_start: Optional[Callable[[str, str], Any]] = None,
        on_stream_chunk: Optional[Callable[[str, str, str, str], Any]] = None,
        on_stream_end: Optional[Callable[[str, str, str], Any]] = None,
        extra: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        lower_prompt = prompt.lower().strip()

        async def emit_thought(text: str):
            await self._emit_streamed_thought(
                text, on_thought, on_stream_start, on_stream_chunk, on_stream_end
            )

        async def emit_message(sender: str, text: str):
            await self._emit_streamed_message(
                sender, text, on_message, on_stream_start, on_stream_chunk, on_stream_end
            )

        async def call_tool_start(name: str, args: Dict[str, Any]):
            if on_tool_start:
                if inspect.iscoroutinefunction(on_tool_start):
                    await on_tool_start(name, args)
                else:
                    res = on_tool_start(name, args)
                    if asyncio.iscoroutine(res):
                        await res

        async def call_tool_end(name: str, output: str, exit_code: int, duration_ms: int, tool_input: Optional[Dict[str, Any]] = None):
            if on_tool_end:
                import inspect
                sig = inspect.signature(on_tool_end)
                param_count = len(sig.parameters)
                if inspect.iscoroutinefunction(on_tool_end):
                    if param_count >= 5:
                        await on_tool_end(name, output, exit_code, duration_ms, tool_input)
                    else:
                        await on_tool_end(name, output, exit_code, duration_ms)
                else:
                    if param_count >= 5:
                        res = on_tool_end(name, output, exit_code, duration_ms, tool_input)
                    else:
                        res = on_tool_end(name, output, exit_code, duration_ms)
                    if asyncio.iscoroutine(res):
                        await res

        ctx = IntentContext(
            task_id=task_id,
            title=title,
            prompt=prompt,
            lower_prompt=lower_prompt,
            persona_name=persona_name,
            workspace_path=workspace_path,
            emit_thought=emit_thought,
            emit_message=emit_message,
            call_tool_start=call_tool_start,
            call_tool_end=call_tool_end,
            on_approval_required=on_approval_required,
            on_diff_updated=on_diff_updated,
            extra=extra or {}
        )

        return await intent_registry.dispatch(ctx)

    async def _execute_with_gemini_api(
        self,
        api_key: str,
        task_id: str,
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
        Primary LLM-first execution engine: invokes Gemini with native function calling.
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
                        "name": "grep_search",
                        "description": "Search for code patterns across workspace files.",
                        "parameters": {
                            "type": "OBJECT",
                            "properties": {
                                "query": {"type": "STRING", "description": "Search pattern or string"}
                            },
                            "required": ["query"]
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
            f"You are Adappty, an autonomous AI pair programmer and software engineering assistant powered by the Antigravity agent harness.\n"
            f"Persona: {persona_name}.\n"
            f"Workspace: {workspace_path}\n"
            f"CURRENT TEMPORAL BASELINE: {current_date_str} (Current Year: {current_year}, Current Month: {now.strftime('%B')})\n\n"
            f"{persona_instructions}\n\n"
            f"Core Operational Directives:\n"
            f"1. TEMPORAL ANCHOR & REAL-TIME WEB RETRIEVAL MANDATE:\n"
            f"   - CURRENT DATE IS {current_date_str}. The current month is {now.strftime('%B')} and current year is {current_year}.\n"
            f"   - When answering queries referencing 'this month', 'this week', 'today', 'latest', or 'recent events', resolve them relative to {current_month_year}.\n"
            f"   - NEVER search for or assume historical cutoff dates like 2024 or 2025 unless the user explicitly requested historical archives.\n"
            f"   - When given a URL or searching for real-time news/releases: invoke `fetch_url` or `search_web` ONCE to retrieve the content.\n"
            f"   - Immediately upon receiving the tool response, you MUST synthesize your final complete response with clickable markdown links.\n"
            f"   - Do NOT issue secondary or repetitive tool calls.\n"
            f"   - NEVER output canned refusals ('I don't have real-time internet access', 'as an AI...'). You HAVE the `search_web` and `fetch_url` tools. Call them immediately.\n"
            f"2. BALANCED PROSE, SUBTLE BULLET HIGHLIGHTS & STRUCTURED TABLES:\n"
            f"   - Lead with an Executive Summary in fluid analytical prose synthesizing core takeaways.\n"
            f"   - Break down distinct announcements, features, or architectural points into subtle, fact-dense single-level bullet highlights with bold prefixes (* **Topic / Event**: concise summary with [Title](https://...)).\n"
            f"   - Include a structured Markdown comparison table (| Topic / Announcement | Source | Date | Link |) when presenting multi-item intelligence.\n"
            f"   - Prohibit rigid cookie-cutter bullet templates (e.g. repeating 'What's New: ... Significance: ...') and deep multi-level nested outlines.\n"
            f"   - EVERY cited article, repository, or announcement MUST include a direct clickable markdown link ([Title](https://...)).\n"
            f"3. WORKSPACE CODE TASKS:\n"
            f"   - Use `list_dir`, `read_file`, `edit_file`, `run_command`, and `grep_search` when inspecting, editing, or testing code in the workspace."
        )

        model_candidates = [self.model_name, "gemini-3.7-flash"]
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
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{active_model}:generateContent?key={api_key}"
                turn = 0
                max_turns = 4
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

                        resp = await client.post(url, json=payload)
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
                                f"💡 *To use live Gemini models, add prepayment credits at https://ai.studio/projects or paste a new key (`AIzaSy...`) in chat. Falling back to dynamic local workspace analysis...*"
                            )
                            await self._emit_streamed_thought(
                                quota_thought, on_thought, on_stream_start, on_stream_chunk, on_stream_end
                            )
                            break
                        if resp.status_code != 200:
                            err_msg = resp.text[:200]
                            logger.warning(f"API notice ({resp.status_code}): {err_msg}")
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
                                url = args.get("url", "")
                                tool_result = await WorkspaceTools.fetch_url(url)
                                out_str = tool_result.get("content", tool_result.get("error", "Error fetching URL"))
                            else:
                                tool_result = {"error": f"Unknown tool: {fn_name}"}
                                exit_code = 1
                                out_str = f"Unknown tool: {fn_name}"

                            elapsed_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)
                            if on_tool_end:
                                import inspect
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

                    if model_succeeded and final_agent_text:
                        return {"status": "COMPLETED", "summary": final_agent_text[:120]}

                except Exception as e:
                    logger.error(f"Gemini execution notice: {str(e)}")
                    continue

        logger.info("Live Gemini API unavailable or incomplete; executing modular local intent engine.")
        return await self._execute_local_intent(
            task_id, prompt, prompt, persona_name, workspace_path,
            on_thought, on_tool_start, on_tool_end, on_message, on_approval_required, on_diff_updated,
            on_stream_start=on_stream_start, on_stream_chunk=on_stream_chunk, on_stream_end=on_stream_end
        )


antigravity_harness = AntigravityHarness()
