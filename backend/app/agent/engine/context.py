"""
Cyclode Agent Engine - Context Management
Utilities for token budget estimation, context image downscaling,
system prompt formatting, and conversation compaction.
"""

import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from app.agent.personas import get_persona
from app.agent.skills_discovery import (
    discover_available_skills,
    format_skills_system_prompt,
)


def downscale_context_image(raw_bytes: bytes, max_dim: int = 1024) -> Tuple[bytes, str]:
    """
    Downscales images exceeding max_dim or 350KB to preserve token context budgets.
    Converts to compressed JPEG/PNG and returns (compressed_bytes, mime_type).
    """
    try:
        from PIL import Image
        with Image.open(io.BytesIO(raw_bytes)) as img:
            w, h = img.size
            if w > max_dim or h > max_dim or len(raw_bytes) > 350 * 1024:
                img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
                buf = io.BytesIO()
                fmt = "JPEG" if img.format != "PNG" else "PNG"
                if fmt == "JPEG" and img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.save(buf, format=fmt, quality=80, optimize=True)
                compressed = buf.getvalue()
                mime = "image/jpeg" if fmt == "JPEG" else "image/png"
                return compressed, mime
    except Exception:
        pass
    return raw_bytes, "image/png"


def estimate_messages_tokens(messages: List[Dict[str, Any]], system_instruction: str = "") -> int:
    """
    Calculates estimated input tokens across message history, system instructions, and tool outputs.
    """
    total = 0
    if system_instruction:
        total += max(1, int(max(len(system_instruction.split()) * 1.3, len(system_instruction) / 4)))
    for entry in messages:
        total += 4  # message envelope overhead
        parts = entry.get("parts", [])
        for p in parts:
            if isinstance(p, str):
                total += max(1, int(max(len(p.split()) * 1.3, len(p) / 4)))
            elif isinstance(p, dict):
                if p.get("text"):
                    t = str(p["text"])
                    total += max(1, int(max(len(t.split()) * 1.3, len(t) / 4)))
                if p.get("thought"):
                    t = str(p["thought"])
                    total += max(1, int(max(len(t.split()) * 1.3, len(t) / 4)))
                if "functionCall" in p:
                    fc = p["functionCall"]
                    fn_name = fc.get("name", "")
                    fn_args = json.dumps(fc.get("args", {}))
                    total += len(fn_name) // 3 + max(1, len(fn_args) // 4)
                if "functionResponse" in p:
                    fr = p["functionResponse"]
                    resp_val = fr.get("response", {})
                    resp_str = json.dumps(resp_val) if isinstance(resp_val, (dict, list)) else str(resp_val)
                    total += max(1, len(resp_str) // 4)
                if "inlineData" in p or "inline_data" in p:
                    b64 = (p.get("inlineData") or p.get("inline_data") or {}).get("data", "")
                    total += int(len(b64) / 1.5)
    return total


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


def assemble_system_instruction(
    persona_name: str,
    title: str,
    workspace_path: Optional[str] = None,
    persona_instructions: Optional[str] = None,
    role_definition: Optional[str] = None,
) -> str:
    """
    Assembles the complete system instruction prompt including persona, temporal baseline,
    skills, and core operational directives.
    """
    persona_obj = get_persona(
        persona_name,
        custom_instructions=persona_instructions,
        role_definition=role_definition,
    )
    resolved_persona_instructions = persona_obj.get("system_instructions", "")

    now = datetime.now(timezone.utc)
    current_date_str = now.strftime("%A, %B %d, %Y")
    current_year = now.year

    ws_path_obj = Path(workspace_path) if workspace_path else None
    available_skills = discover_available_skills(ws_path_obj)
    skills_prompt = format_skills_system_prompt(available_skills)

    system_instruction = (
        f"You are Cyclode, an autonomous AI pair programmer and software engineering assistant powered by the Antigravity agent harness.\n"
        f"Persona: {persona_name}.\n"
        f"Workspace: {workspace_path}\n"
        f"Task Context: {title}\n"
        f"CURRENT TEMPORAL BASELINE: {current_date_str} (Current Year: {current_year}, Current Month: {now.strftime('%B')})\n\n"
        f"{resolved_persona_instructions}\n\n"
        f"{skills_prompt}\n"
        f"Core Operational Directives:\n"
        f"1. DIRECT TOOL INVOCATION & REASONING:\n"
        f"   - When listing pull requests: call `list_pull_requests`. ALWAYS present all discovered PRs in your response with an itemized Markdown table or list including direct clickable links ([#<number>: <title>](https://github.com/<owner>/<repo>/pull/<number>)), author (@<author>), status (OPEN/MERGED), branch flow (<head> ➔ <base>), and diff stats (+add / -del).\n"
        f"   - When reviewing PRs, assessing mergeability, or checking CI status: call `get_pull_request_details` (which provides composite mergeability, CI `checks_summary`, and `reviews_summary`) and `get_pull_request_diff` to analyze the exact code hunks. Call `get_pull_request_checks` for dedicated CI check runs and test workflow status.\n"
        f"   - When referencing, tracking, or resolving Linear tickets (e.g. 'PD-1198'): call Linear tools directly (`get_linear_issue`, `search_linear_issues`, `post_linear_comment`, `update_linear_issue_status`, `create_linear_issue`, `list_linear_teams`).\n"
        f"   - When interacting with external software services, third-party APIs, or SaaS tools (e.g. Jira, Notion, Slack, Sentry, AWS, Supabase, Cloudflare, Stripe): first call `ingrations_search_tools` to discover matching action IDs, then call `ingrations_execute` with required parameters.\n"
        f"   - When answering user questions about the workspace: use `read_file`, `search_code`, `find_symbols`, and `run_command`.\n"
        f"   - AUTONOMOUS SWARM DECOMPOSITION & IMMEDIATE DISPATCH INVARIANT: Whenever an inquiry or plan calls for parallel execution, building with subagents (e.g. 'Parallelize the build with subagents'), comparing multiple distinct entities, or decomposing an architecture into orthogonal components/modules, DO NOT perform sequential line-by-line implementation or deep file inspection in the parent sandbox! Your role as Lead Orchestrator is to coordinate, NOT to write all the code yourself. Perform at most ONE rapid orientation read/inspection (e.g. `list_dir` or reading `pyproject.toml` to confirm directory structure) and IMMEDIATELY call `delegate_subtasks` in Turn 1 or Turn 2 with all planned worker pods dispatched in parallel in a single batch call. Never get trapped in a solo coding or git inspection loop when subagents are requested!\n"
        f"   - When asked to search the web: call `search_web` or `fetch_url`. Formulate clean, concise keyword queries without redundant boolean operators or nested quotes. Complete web research in 1–3 focused tool queries and promptly deliver your full analytical synthesis.\n"
        f"2. ANALYTICAL PROSE & RICH CITATIONS:\n"
        f"   - Lead with an Executive Summary in fluid analytical prose.\n"
        f"   - Break down distinct architectural changes, modified files, and risks clearly.\n"
        f"   - EVERY cited article, repository, PR link, or URL MUST include a direct clickable markdown link ([Title](https://...)).\n"
        f"   - Prohibit rigid cookie-cutter bullet templates (e.g. repeating 'What's New: ... Significance: ...').\n"
        f"3. MULTI-TURN CONTEXT:\n"
        f"   - If the user asks follow-up questions about specific lines, files, or diff hunks, reason directly on the code."
    )
    return system_instruction
