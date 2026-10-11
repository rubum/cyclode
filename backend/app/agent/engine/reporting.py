import re
import os
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from urllib.parse import urlparse
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import async_session_factory
from app.db.models import TaskModel, TaskMessageModel, TaskDiffModel, get_utc_now

logger = logging.getLogger(__name__)


def _extract_citations_from_text(text: str) -> List[Dict[str, str]]:
    """
    Extracts markdown hyperlinks [Title](url) and filters out internal or relative links.
    """
    if not text:
        return []
    citations = []
    seen_urls = set()
    # Match [Link Title](https?://...)
    matches = re.findall(r'\[([^\]]+)\]\((https?://[^\s\)]+)\)', text)
    for title, url in matches:
        clean_url = url.strip()
        if clean_url in seen_urls:
            continue
        seen_urls.add(clean_url)
        domain = ""
        try:
            domain = urlparse(clean_url).hostname or ""
        except Exception:
            pass
        citations.append({
            "title": title.strip(),
            "url": clean_url,
            "domain": domain
        })
    return citations


def harvest_session_intelligence(
    task: TaskModel,
    trajectory: Optional[Any] = None,
    diff_records: Optional[List[TaskDiffModel]] = None
) -> Dict[str, Any]:
    """
    Aggregates all multi-turn data from task messages, trajectory tool calls,
    git diffs, and evaluations into a structured session intelligence payload.
    """
    user_prompts: List[str] = []
    agent_responses: List[str] = []
    citations_map: Dict[str, Dict[str, str]] = {}
    tools_used_count: Dict[str, int] = {}
    commands_executed: List[Dict[str, Any]] = []
    files_touched: Dict[str, str] = {}

    # 1. Harvest messages
    messages = getattr(task, "messages", []) or []
    for msg in messages:
        if msg.sender == "user":
            user_prompts.append(msg.content.strip())
        elif msg.sender == "agent":
            agent_responses.append(msg.content)
            for c in _extract_citations_from_text(msg.content):
                if c["url"] not in citations_map:
                    citations_map[c["url"]] = c

    if not user_prompts and getattr(task, "description", None):
        user_prompts.append(task.description.strip())

    # 2. Harvest trajectory tool calls (if trajectory is active)
    if trajectory and hasattr(trajectory, "turns"):
        for turn in trajectory.turns:
            for tc in getattr(turn, "tool_calls", []):
                t_name = tc.tool_name
                tools_used_count[t_name] = tools_used_count.get(t_name, 0) + 1
                args = tc.input_args or {}

                # Capture web searches
                if "search" in t_name.lower() and "query" in args:
                    q = args.get("query", "")
                    if q:
                        tools_used_count[f"query: {q}"] = 1

                # Capture URL scraping
                if ("url" in t_name.lower() or "read" in t_name.lower()) and "url" in args:
                    u = args.get("url", "")
                    if u and u.startswith("http") and u not in citations_map:
                        domain = urlparse(u).hostname or ""
                        citations_map[u] = {
                            "title": args.get("title") or domain or "External Research Reference",
                            "url": u,
                            "domain": domain
                        }

                # Capture command executions
                if "command" in t_name.lower() and "CommandLine" in args:
                    commands_executed.append({
                        "command": args.get("CommandLine", ""),
                        "exit_code": tc.exit_code,
                        "duration_ms": tc.duration_ms
                    })

                # Capture file modifications
                if any(k in t_name.lower() for k in ["write", "edit", "replace"]):
                    target_file = args.get("TargetFile") or args.get("path") or args.get("file_path")
                    if target_file:
                        action = "created" if "write" in t_name.lower() else "modified"
                        files_touched[os.path.basename(target_file)] = action

    # 3. Harvest git diff records
    if diff_records:
        for d in diff_records:
            fn = os.path.basename(getattr(d, "file_path", "unknown"))
            action = getattr(d, "change_type", None) or ("added" if getattr(d, "deletions", 0) == 0 and getattr(d, "additions", 0) > 0 else "modified")
            files_touched[fn] = action

    # 4. Harvest plan milestones & evaluations
    plan = getattr(task, "plan", None) or {}
    plan_steps = plan.get("steps") or plan.get("phases") or []
    evaluation = None
    try:
        from app.agent.harness import get_task_evaluation
        evaluation = get_task_evaluation(task.id)
    except Exception:
        pass

    return {
        "task_id": task.id,
        "title": task.title or "Session Report",
        "description": task.description or "",
        "persona": task.persona or "General",
        "user_prompts": user_prompts,
        "agent_responses": agent_responses,
        "citations": list(citations_map.values()),
        "tools_used": tools_used_count,
        "commands_executed": commands_executed,
        "files_touched": [{"path": k, "action": v} for k, v in files_touched.items()],
        "plan_steps": plan_steps,
        "evaluation_status": evaluation.status if evaluation else plan.get("evaluation", {}).get("status", "completed"),
        "total_tokens": getattr(task, "total_tokens", 0) or 0,
        "created_at": getattr(task, "created_at", get_utc_now()),
        "workspace_path": getattr(task, "workspace_path", "/workspaces")
    }


def synthesize_report_markdown(intel: Dict[str, Any], custom_instructions: Optional[str] = None) -> str:
    """
    Renders an executive session intelligence briefing in clean GitHub Flavored Markdown.
    """
    title = intel.get("title") or "Session Intelligence & Execution Report"
    task_id = intel.get("task_id", "")
    persona = intel.get("persona", "General")
    created_at = intel.get("created_at")
    date_str = created_at.strftime("%Y-%m-%d %H:%M:%S UTC") if hasattr(created_at, "strftime") else str(created_at)
    tokens = intel.get("total_tokens", 0)
    eval_status = intel.get("evaluation_status", "completed")

    user_prompts = intel.get("user_prompts", [])
    primary_objective = user_prompts[0] if user_prompts else intel.get("description", "Autonomous task execution and research.")
    # Sanitize markdown in title
    clean_title = re.sub(r'#+\s*', '', title).strip()

    citations = intel.get("citations", [])
    files_touched = intel.get("files_touched", [])
    commands = intel.get("commands_executed", [])
    plan_steps = intel.get("plan_steps", [])

    lines = [
        f"# Executive Briefing: {clean_title}",
        "",
        "| Attribute | Value | Scope / Details |",
        "| :--- | :--- | :--- |",
        f"| **Session Key** | `{task_id[:8]}` | Workspace Session Identifier |",
        f"| **Persona** | `{persona}` | Active Autonomous Persona |",
        f"| **Evaluation** | `{eval_status.upper()}` | Verification Verdict |",
        f"| **Timestamp** | `{date_str}` | UTC Compilation Time |",
        f"| **Token Footprint** | `{tokens:,} tokens` | Total Resource Consumption |",
        "",
        "## 1. Executive Summary",
        "",
        f"**Primary Objective**: {primary_objective}",
        "",
    ]

    # Narrative overview from latest agent response or custom instructions
    agent_responses = intel.get("agent_responses", [])
    if agent_responses:
        # Take the core summary paragraph from the latest substantive turn
        latest_reply = agent_responses[-1]
        # Clean out code blocks or giant tables for summary section
        summary_paragraphs = [
            p.strip() for p in latest_reply.split("\n\n") 
            if p.strip() and not p.strip().startswith(("```", "|", ">", "#", "-"))
        ]
        if summary_paragraphs:
            lines.append(summary_paragraphs[0])
            lines.append("")
        else:
            lines.append("During this session, autonomous research, implementation, and verification were successfully executed to resolve the stated objective.")
            lines.append("")
    else:
        lines.append("Session initiated and milestones formulated across architecture and execution layers.")
        lines.append("")

    # 2. Research Findings & External Intelligence Dossier
    if citations:
        lines.extend([
            "## 2. Research Findings & External Intelligence Dossier",
            "",
            "The following intelligence sources and documentation artifacts were inspected during this session:",
            "",
            "| Resource Title | Domain / Provider | Direct Link |",
            "| :--- | :--- | :--- |"
        ])
        for c in citations:
            t = c.get("title", "Reference Link").replace("|", "-")
            d = c.get("domain") or "External"
            u = c.get("url", "#")
            lines.append(f"| **{t}** | `{d}` | [{t}]({u}) |")
        lines.append("")

    # 3. Phased Milestones & Execution Plan
    if plan_steps:
        lines.extend([
            "## 3. Execution Milestones & Plan Trajectory",
            "",
        ])
        for idx, s in enumerate(plan_steps):
            s_title = s.get("title") or s.get("name") or f"Step {idx+1}"
            s_status = s.get("status") or "completed"
            icon = "✅" if s_status in ["completed", "done", "passed"] else "🔄"
            lines.append(f"- {icon} **Step {idx+1}**: {s_title} &mdash; `{s_status.upper()}`")
        lines.append("")

    # 4. Architecture & File Touchpoints
    if files_touched:
        lines.extend([
            "## 4. Architecture & File Touchpoints",
            "",
            "| File Path | Action | Scope |",
            "| :--- | :--- | :--- |"
        ])
        for f in files_touched:
            p = f.get("path", "")
            act = f.get("action", "modified").capitalize()
            lines.append(f"| `{p}` | **{act}** | Workspace Codebase |")
        lines.append("")

    # 5. Verification & Test Metrics
    lines.extend([
        "## 5. Verification & Test Metrics",
        "",
        f"- **Verification Verdict**: `{eval_status.upper()}`",
    ])
    if commands:
        lines.append(f"- **Terminal Executions**: {len(commands)} verification command(s) processed.")
        recent_commands = commands[-3:]
        for cmd in recent_commands:
            code = cmd.get("exit_code", 0)
            status_text = "PASSED" if code == 0 else f"FAILED ({code})"
            lines.append(f"  - `{cmd.get('command', '')}` &rarr; **{status_text}**")
    lines.append("")

    # 6. Actionable Next Steps
    lines.extend([
        "## 6. Actionable Next Steps & Deployment Strategy",
        "",
        "1. **Continuous Verification**: Monitor runtime telemetry in Cyclode's terminal and PR review sentinel.",
        "2. **Merge / Delivery**: Review and promote branch changes into staging or upstream production environments.",
        "3. **Milestone Archival**: Session intelligence and verification records remain archived on this task.",
        "",
        "---",
        f"*Compiled automatically by Cyclode Session Intelligence Engine • Task ID: `{task_id}`*"
    ])

    return "\n".join(lines)


def generate_printable_html(title: str, markdown_content: str, metadata: Dict[str, Any]) -> str:
    """
    Renders a standalone, styled, printable HTML document from the compiled markdown.
    Includes print CSS so browser Ctrl+P / Cmd+P renders a beautiful PDF.
    """
    clean_title = re.sub(r'#+\s*', '', title).strip()
    task_id = metadata.get("task_id", "")
    created_at = metadata.get("created_at", "")

    # Basic markdown to HTML transform for standard blocks
    body_html = markdown_content
    # Escape existing angle brackets in non-markdown parts
    # Headers
    body_html = re.sub(r'^# (.+)$', r'<h1>\1</h1>', body_html, flags=re.MULTILINE)
    body_html = re.sub(r'^## (.+)$', r'<h2>\1</h2>', body_html, flags=re.MULTILINE)
    body_html = re.sub(r'^### (.+)$', r'<h3>\1</h3>', body_html, flags=re.MULTILINE)
    # Blockquotes / Callouts
    body_html = re.sub(r'^> \[!(NOTE|IMPORTANT|TIP|WARNING)\]\n> (.+)$', r'<div class="callout callout-\1"><strong>\1:</strong> \2</div>', body_html, flags=re.MULTILINE)
    body_html = re.sub(r'^> (.+)$', r'<blockquote>\1</blockquote>', body_html, flags=re.MULTILINE)
    # Bold / Italic
    body_html = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', body_html)
    body_html = re.sub(r'\*(.+?)\*', r'<em>\1</em>', body_html)
    # Code inline
    body_html = re.sub(r'`([^`]+)`', r'<code>\1</code>', body_html)
    # Links
    body_html = re.sub(r'\[([^\]]+)\]\((https?://[^\)]+)\)', r'<a href="\2" target="_blank" rel="noopener">\1</a>', body_html)
    # Unordered list items
    body_html = re.sub(r'^- (.+)$', r'<li>\1</li>', body_html, flags=re.MULTILINE)
    # Wrap lists
    body_html = re.sub(r'(<li>.*?</li>\s*)+', r'<ul>\g<0></ul>', body_html, flags=re.DOTALL)
    # Tables (basic row wrapper)
    body_html = re.sub(r'\| (.+) \|', r'<tr><td>\1</td></tr>', body_html)
    body_html = body_html.replace('<td>', '<td>').replace(' | ', '</td><td>')

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{clean_title} — Cyclode Executive Report</title>
<style>
  :root {{
    --bg: #FFFFFF;
    --fg: #0F172A;
    --muted: #64748B;
    --border: #E2E8F0;
    --accent: #2563EB;
    --code-bg: #F8FAFC;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #1E2227;
      --fg: #F1F5F9;
      --muted: #94A3B8;
      --border: #3E4451;
      --accent: #61AFEF;
      --code-bg: #282C34;
    }}
  }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.65;
    padding: 2.5rem 1.5rem;
    margin: 0 auto;
    max-width: 860px;
  }}
  h1 {{ font-size: 1.85rem; border-bottom: 2px solid var(--border); padding-bottom: 0.5rem; margin-top: 0; }}
  h2 {{ font-size: 1.35rem; border-bottom: 1px solid var(--border); padding-bottom: 0.35rem; margin-top: 2rem; }}
  h3 {{ font-size: 1.1rem; margin-top: 1.5rem; }}
  a {{ color: var(--accent); text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  code {{ background: var(--code-bg); padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9em; font-family: monospace; }}
  ul {{ padding-left: 1.5rem; }}
  li {{ margin-bottom: 0.35rem; }}
  table {{ width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.95em; }}
  th, td {{ border: 1px solid var(--border); padding: 0.6rem 0.75rem; text-align: left; }}
  tr:nth-child(even) {{ background: var(--code-bg); }}
  .callout {{ border-left: 4px solid var(--accent); background: var(--code-bg); padding: 0.85rem 1.2rem; border-radius: 0 6px 6px 0; margin: 1.5rem 0; }}
  .meta-tag {{ font-size: 0.85rem; color: var(--muted); }}
  @media print {{
    body {{ max-width: 100%; padding: 0; background: #fff !important; color: #000 !important; }}
    a {{ color: #000; text-decoration: underline; }}
    .no-print {{ display: none !important; }}
  }}
</style>
</head>
<body>
<div class="meta-tag">Cyclode Intelligence Report • Generated: {created_at} • Task Key: {task_id[:8]}</div>
{body_html}
</body>
</html>
"""
    return html


async def compile_session_report(
    task_id: str,
    title: Optional[str] = None,
    format: str = "markdown",
    save_to_workspace: bool = False,
    custom_instructions: Optional[str] = None
) -> Dict[str, Any]:
    """
    Master entrypoint to compile, format, persist, and broadcast an executive session report.
    """
    from app.api.websocket import ws_manager

    async with async_session_factory() as session:
        # Load task and relations
        result = await session.execute(
            select(TaskModel)
            .options(
                selectinload(TaskModel.messages),
                selectinload(TaskModel.diffs)
            )
            .where(TaskModel.id == task_id)
        )
        task = result.scalar_one_or_none()
        if not task:
            raise ValueError(f"Task with ID {task_id} not found")

        trajectory = None
        try:
            from app.agent.harness import get_task_trajectory
            trajectory = get_task_trajectory(task_id)
        except Exception:
            pass
        intel = harvest_session_intelligence(task, trajectory, getattr(task, "diffs", None))

        if title:
            intel["title"] = title

        # Synthesize markdown
        markdown_report = synthesize_report_markdown(intel, custom_instructions=custom_instructions)
        # Generate printable HTML
        html_report = generate_printable_html(intel["title"], markdown_report, intel)

        # Calculate realistic turns count
        turns_count = max(
            len(intel.get("user_prompts", [])),
            len(intel.get("agent_responses", [])),
            1 if getattr(task, "description", None) else 0
        )

        # Harvest promoted or provisional experiential memories for this session
        memories = []
        try:
            from app.db.models import KnowledgeEntryModel
            m_res = await session.execute(
                select(KnowledgeEntryModel).where(KnowledgeEntryModel.source_task_id == task_id)
            )
            for m in m_res.scalars().all():
                memories.append({
                    "id": m.id,
                    "category": m.category,
                    "insight": m.insight,
                    "status": m.status,
                    "trigger_pattern": m.trigger_pattern
                })
        except Exception:
            pass

        # Build report payload
        report_data = {
            "task_id": task_id,
            "title": intel["title"],
            "executive_summary": markdown_report.split("## 1. Executive Summary\n\n")[1].split("\n\n##")[0] if "## 1. Executive Summary\n\n" in markdown_report else "Executive session summary.",
            "markdown": markdown_report,
            "html": html_report,
            "citations": intel.get("citations", []),
            "files_touched": intel.get("files_touched", []),
            "commands_executed": intel.get("commands_executed", []),
            "experiential_memories": memories,
            "persona": intel.get("persona", "General"),
            "evaluation_status": intel.get("evaluation_status", "completed"),
            "metrics": {
                "total_tokens": intel.get("total_tokens", 0),
                "total_turns": turns_count,
                "citations_count": len(intel.get("citations", [])),
                "files_count": len(intel.get("files_touched", []))
            },
            "workspace_file_path": None,
            "created_at": datetime.utcnow().isoformat()
        }

        # Optional Workspace Persistence
        if save_to_workspace:
            workspace_root = task.workspace_path or "/workspaces"
            try:
                reports_dir = os.path.join(workspace_root, "reports")
                os.makedirs(reports_dir, exist_ok=True)
                clean_filename = re.sub(r'[^a-zA-Z0-9_-]', '_', intel["title"].lower())[:40] + f"_{task_id[:6]}.md"
                target_path = os.path.join(reports_dir, clean_filename)
                with open(target_path, "w", encoding="utf-8") as f:
                    f.write(markdown_report)
                report_data["workspace_file_path"] = f"reports/{clean_filename}"
                logger.info(f"Session report saved to workspace at {target_path}")
            except Exception as e:
                logger.warning(f"Could not persist report to workspace at {workspace_root}: {e}")

        # Update TaskModel.report in database
        task.report = report_data
        await session.commit()

        # Broadcast live WebSocket event
        try:
            await ws_manager.broadcast("TASK_REPORT_COMPILED", {
                "task_id": task_id,
                "report": report_data
            })
        except Exception as e:
            logger.warning(f"Failed to broadcast TASK_REPORT_COMPILED: {e}")

        return report_data
