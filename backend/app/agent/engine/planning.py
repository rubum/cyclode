import re
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


def generate_plan_markdown(plan: Dict[str, Any], title: str = "", prompt: str = "") -> str:
    """
    Synthesizes a clean, comprehensive engineering implementation plan in Markdown.
    Includes Executive Summary, Mermaid Workflow, Milestone Stepper Checklist, and Invariant Verification.
    """
    obj = plan.get("objective") or title or "Autonomous Task Execution"
    intent = plan.get("intent_category", "general")
    steps = plan.get("steps", [])
    eval_info = plan.get("evaluation") or {}
    
    # Format mermaid diagram
    mermaid_steps = []
    for idx, s in enumerate(steps):
        s_title = s.get("title", f"Step {idx+1}").replace('"', "'")
        step_id = f"S{idx+1}"
        mermaid_steps.append(f'    {step_id}["{idx+1}. {s_title}"]')
    
    mermaid_flow = ""
    if len(mermaid_steps) > 1:
        arrows = " --> ".join([f"S{i+1}" for i in range(len(mermaid_steps))])
        mermaid_flow = "```mermaid\nflowchart LR\n" + "\n".join(mermaid_steps) + f"\n    {arrows}\n```\n"
    elif len(mermaid_steps) == 1:
        mermaid_flow = "```mermaid\nflowchart LR\n" + mermaid_steps[0] + "\n```\n"

    phases = plan.get("phases")
    if phases and isinstance(phases, list) and len(phases) > 0:
        raw_title = plan.get("title") or title or obj
        clean_title = raw_title if raw_title.startswith("Implementation Plan:") else f"Implementation Plan: {raw_title}"
        if not clean_title.startswith("#"):
            clean_title = f"# {clean_title}"
        
        overview = plan.get("overview") or plan.get("objective") or "This plan outlines a phased remediation and implementation strategy."
        
        lines = [
            clean_title,
            "",
            "> [!IMPORTANT]",
            "> **Plan Mode Active**: Architectural implementation plan formulated. Review the phased milestones, file touchpoints, and verification criteria below before proceeding with execution.",
            "",
            "## Executive Summary",
            "",
            overview,
            "",
        ]

        if mermaid_flow:
            lines.extend([
                "## System Execution Flow",
                "",
                mermaid_flow,
                "",
            ])

        lines.extend([
            "## Key Execution Phases",
            "",
        ])

        for p in phases:
            p_num = p.get("phase_number") or ""
            p_title = p.get("title") or f"Phase {p_num}"
            if not p_title.startswith("Phase") and not p_title.startswith("###"):
                p_heading = f"### Phase {p_num}: {p_title}" if p_num else f"### {p_title}"
            elif p_title.startswith("###"):
                p_heading = p_title
            else:
                p_heading = f"### {p_title}"

            lines.append(p_heading)
            lines.append("")
            p_obj = p.get("objective") or ""
            if p_obj:
                lines.append(f"**Objective**: {p_obj}")
                lines.append("")

            touchpoints = p.get("file_touchpoints") or p.get("touchpoints") or []
            if touchpoints:
                lines.append("- **File Touchpoints**:")
                for tp in touchpoints:
                    if isinstance(tp, dict):
                        f_name = tp.get("file", "")
                        f_actions = tp.get("actions", [])
                        if f_name:
                            lines.append(f"  - `{f_name}`:")
                            for act in f_actions:
                                lines.append(f"    - {act}")
                        elif tp.get("description"):
                            lines.append(f"  - {tp.get('description')}")
                    else:
                        lines.append(f"  - {tp}")
                lines.append("")

            criteria = p.get("verification_criteria") or []
            if criteria:
                lines.append("- **Verification Criteria**:")
                for c in criteria:
                    lines.append(f"  - {c}")
                lines.append("")

        # Include Milestone Stepper Checklist
        if steps:
            lines.extend([
                "## Milestone Stepper Checklist",
                "",
            ])
            for idx, s in enumerate(steps):
                status = s.get("status", "pending")
                box = "[x]" if status == "completed" else "[-]" if status == "in_progress" else "[ ]"
                badge = "*(Done)*" if status == "completed" else "*(In Progress)*" if status == "in_progress" else "*(Pending Approval)*"
                lines.append(f"- {box} **Phase {idx+1}**: {s.get('title', '')} {badge}")
            lines.append("")

        lines.extend([
            "## Invariant Verification & System Policies",
            "",
            "- [ ] Code modifications adhere to zero-regression architectural policies.",
            "- [ ] Automated unit test suites execute cleanly with zero runtime failures.",
            "- [ ] Changes preserve backward compatibility and public interface contracts.",
            "",
            "---",
            f"*Generated automatically by Cyclode Master Execution Planner • Session Key: `{title or 'task'}`*"
        ])
        return "\n".join(lines)

    callout_tag = "IMPORTANT" if intent == "planning" else "NOTE"
    callout_title = "> **Plan Mode Active**: Architectural implementation plan formulated. Review the phased milestones below before proceeding with execution.\n> \n" if intent == "planning" else ""
    lines = [
        f"# Implementation Plan: {title or obj}",
        "",
        f"> [!{callout_tag}]",
        f"{callout_title}> **Objective**: {obj}  ",
        f"> **Intent Category**: `{intent}` • **Evaluation Status**: `{eval_info.get('status', 'in_progress')}`",
        "",
    ]
    if mermaid_flow:
        lines.extend([
            "## System Execution Flow",
            "",
            mermaid_flow,
            "",
        ])

    # Proposed file changes table (if present)
    proposed_changes = plan.get("proposed_changes", [])
    if proposed_changes and isinstance(proposed_changes, list):
        lines.extend([
            "## Proposed Architecture & File Touchpoints",
            "",
            "| Target File | Action | Proposed Change |",
            "| :--- | :--- | :--- |",
        ])
        for chg in proposed_changes:
            f_path = chg.get("file", "unspecified")
            f_act = chg.get("action", "MODIFY").upper()
            f_desc = chg.get("description", "").replace("|", "\\|")
            lines.append(f"| `{f_path}` | `{f_act}` | {f_desc} |")
        lines.append("")

    lines.extend([
        "## Phased Implementation Milestones",
        "",
    ])

    for idx, s in enumerate(steps):
        status = s.get("status", "pending")
        box = "[x]" if status == "completed" else "[-]" if status == "in_progress" else "[ ]"
        if intent == "planning":
            badge = "*(Done)*" if status == "completed" else "*(In Progress)*" if status == "in_progress" else "*(Pending Approval)*"
        else:
            badge = "*(In Progress)*" if status == "in_progress" else "*(Done)*" if status == "completed" else "*(Pending)*"
        lines.append(f"- {box} **Phase {idx+1}**: {s.get('title', '')} {badge}")
        if s.get("description"):
            lines.append(f"  > {s.get('description')}")
        if s.get("files"):
            file_tags = ", ".join([f"`{f}`" for f in s.get("files", [])])
            lines.append(f"  > **Touchpoints**: {file_tags}")
        lines.append("")

    lines.extend([
        "## Invariant Verification & Acceptance Criteria",
        "",
    ])

    verification_items = plan.get("verification_criteria")
    if verification_items and isinstance(verification_items, list) and len(verification_items) > 0:
        for v in verification_items:
            lines.append(f"- [ ] {v}")
        lines.append("- [ ] Code changes adhere to zero-regression policies and existing test suites.")
    else:
        lines.extend([
            "- [ ] Code changes adhere to zero-regression policies and existing test suites.",
            "- [ ] Verification checks execute cleanly without unhandled runtime exceptions.",
            "- [ ] Build artifacts compile with 0 TypeScript and styling errors.",
        ])

    lines.extend([
        "",
        "---",
        f"*Generated automatically by Cyclode Master Execution Planner • Session Key: `{title or 'task'}`*"
    ])

    return "\n".join(lines)


def extract_plan_from_markdown(markdown_text: str, default_title: str = "Implementation Plan") -> Dict[str, Any]:
    """
    Parses an implementation plan Markdown document (formulated by the LLM agent)
    into structured phases, milestones, objectives, and steps for the First-Class Execution Plan.
    """
    if not markdown_text or not markdown_text.strip():
        return {}

    lines = markdown_text.strip().splitlines()
    title = default_title
    overview = ""
    phases: List[Dict[str, Any]] = []
    steps: List[Dict[str, Any]] = []

    # 1. Extract Title
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            t_match = re.search(r"^#+\s*(?:Implementation Plan:?\s*)?(.*)$", stripped)
            if t_match and t_match.group(1).strip():
                cand = t_match.group(1).strip()
                if not cand.startswith("[") and not cand.startswith("!"):
                    title = cand
                    break

    # 2. Extract Overview / Objective
    overview_lines = []
    in_overview = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            if not in_overview:
                in_overview = True
                continue
            else:
                break
        if in_overview:
            if stripped.startswith(">") or stripped.startswith("```"):
                continue
            if stripped:
                overview_lines.append(stripped)
            elif overview_lines:
                break
    if overview_lines:
        overview = " ".join(overview_lines)

    # 3. Extract Phases (e.g. "### Phase 1: ...", "## Phase 1: ...", "### Phase 1 - ...")
    current_phase: Optional[Dict[str, Any]] = None
    phase_counter = 0

    for line in lines:
        stripped = line.strip()
        phase_header_match = re.match(r"^#{2,4}\s+(Phase\s+\d+[:\-]?\s*.*|Step\s+\d+[:\-]?\s*.*)$", stripped, re.IGNORECASE)
        if phase_header_match:
            if current_phase:
                phases.append(current_phase)
            phase_counter += 1
            full_header = phase_header_match.group(1).strip()
            current_phase = {
                "phase_number": phase_counter,
                "title": full_header,
                "objective": "",
                "file_touchpoints": [],
                "verification_criteria": []
            }
            continue

        if current_phase:
            # Check objective
            obj_match = re.match(r"^\*{0,2}Objective\*{0,2}:\s*(.*)$", stripped, re.IGNORECASE)
            if obj_match:
                current_phase["objective"] = obj_match.group(1).strip()
                continue

            # Check touchpoints or criteria bullets
            if stripped.startswith("- ") or stripped.startswith("* "):
                bullet_content = stripped[2:].strip()
                if "touchpoint" not in bullet_content.lower() and "verification" not in bullet_content.lower():
                    if "criteria" in line.lower() or "verify" in line.lower() or "pytest" in bullet_content.lower():
                        current_phase["verification_criteria"].append(bullet_content)
                    else:
                        current_phase["file_touchpoints"].append(bullet_content)

    if current_phase:
        phases.append(current_phase)

    # If no "### Phase N" headers were found, check for numbered milestone lists (e.g. "1. **...**")
    if not phases:
        for line in lines:
            stripped = line.strip()
            num_match = re.match(r"^\d+\.\s+\*{0,2}(.*?)\*{0,2}(?::|\s+-|\s*$)", stripped)
            if num_match:
                s_title = num_match.group(1).strip()
                if s_title and len(s_title) > 3 and not s_title.lower().startswith("objective"):
                    steps.append({
                        "id": f"step-{len(steps)+1}",
                        "title": s_title,
                        "status": "pending"
                    })
    else:
        for idx, p in enumerate(phases):
            p_title = p.get("title", f"Phase {idx+1}")
            clean_p_title = re.sub(r"^Phase\s+\d+[:\-]?\s*", "", p_title, flags=re.IGNORECASE).strip() or p_title
            steps.append({
                "id": f"step-{idx+1}",
                "title": f"Phase {idx+1}: {clean_p_title}",
                "status": "pending",
                "objective": p.get("objective", "")
            })

    if not steps:
        steps = [
            {"id": "step-1", "title": f"Review Architectural Plan: {title}", "status": "pending"},
            {"id": "step-2", "title": "Execute Implementation Milestones", "status": "pending"},
            {"id": "step-3", "title": "Verify Acceptance Criteria and Test Suite", "status": "pending"}
        ]

    return {
        "intent_category": "planning",
        "title": f"Implementation Plan: {title}" if not title.startswith("Implementation Plan") else title,
        "objective": overview or title,
        "overview": overview or f"Architectural implementation plan for {title}.",
        "phases": phases,
        "steps": steps,
        "markdown": markdown_text,
        "evaluation": {
            "status": "ready_for_review",
            "summary": "Implementation plan formulated. Awaiting user review or approval to proceed.",
            "checks": [
                {"name": "Implementation Plan Formulated", "passed": True, "message": "Architectural implementation plan ready for review"}
            ]
        }
    }
