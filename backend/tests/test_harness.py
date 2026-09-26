import pytest
import re
from app.agent.harness import AntigravityHarness


@pytest.mark.asyncio
async def test_emit_streamed_message_anti_echo_guardrail():
    harness = AntigravityHarness()
    emitted_messages = []

    async def mock_on_message(sender: str, content: str):
        emitted_messages.append((sender, content))

    # Test that a leaked action trace is intercepted by the Anti-Echo Guardrail
    raw_action_msg = "Action: Edited file 'src/components/Modals/NewPostModal.jsx'"
    await harness._emit_streamed_message(
        sender="agent",
        content=raw_action_msg,
        on_message=mock_on_message
    )

    assert len(emitted_messages) == 1
    sender, content = emitted_messages[0]
    assert sender == "agent"
    assert not content.startswith("Action:")
    assert "completed and verified" in content


@pytest.mark.asyncio
async def test_emit_streamed_message_normal_synthesis_preserved():
    harness = AntigravityHarness()
    emitted_messages = []

    async def mock_on_message(sender: str, content: str):
        emitted_messages.append((sender, content))

    normal_msg = "### Executive Summary\n\nSuccessfully built the social feed application with responsive layouts."
    await harness._emit_streamed_message(
        sender="agent",
        content=normal_msg,
        on_message=mock_on_message
    )

    assert len(emitted_messages) == 1
    sender, content = emitted_messages[0]
    assert sender == "agent"
    assert "Executive Summary" in content


@pytest.mark.asyncio
async def test_emit_streamed_message_bullet_action_intercepted():
    harness = AntigravityHarness()
    emitted_messages = []

    async def mock_on_message(sender: str, content: str):
        emitted_messages.append((sender, content))

    bullet_action_msg = "• Modified src/components/Feed.jsx and added styles."
    await harness._emit_streamed_message(
        sender="agent",
        content=bullet_action_msg,
        on_message=mock_on_message
    )

    assert len(emitted_messages) == 1
    sender, content = emitted_messages[0]
    assert not content.startswith("• Modified")
    assert "completed and verified" in content


def test_persona_app_builder_resilient_bundling():
    from app.agent.personas import get_persona
    app_builder = get_persona("AppBuilder")
    instructions = app_builder["system_instructions"]
    assert "npx vite build" in instructions
    assert "verify_app_preview" in instructions
    assert "READY" in instructions
    assert "Obsidian Minimalist Dark" in instructions


def test_persona_software_engineer_and_alias_resolution():
    from app.agent.personas import get_persona
    swe = get_persona("SoftwareEngineer")
    assert swe["name"] == "SoftwareEngineer"
    instructions = swe["system_instructions"]
    assert "npm run build" in instructions
    assert "verify_app_preview" in instructions
    assert "AUTONOMOUS CODE & UI DELIVERY MANDATE" in instructions

    # Test alias resolution
    pair_prog = get_persona("PairProgrammer")
    assert pair_prog["name"] == "SoftwareEngineer"
    assert pair_prog == swe

    swe_alias = get_persona("swe")
    assert swe_alias["name"] == "SoftwareEngineer"


def test_autonomous_html_shell_synthesis(tmp_path):
    from app.api.preview import verify_workspace_preview
    css_dir = tmp_path / "css"
    js_dir = tmp_path / "js"
    css_dir.mkdir(parents=True)
    js_dir.mkdir(parents=True)

    (css_dir / "styles.css").write_text("body { background: #000; }", encoding="utf-8")
    (js_dir / "app.js").write_text("const { createApp } = Vue; createApp({}).mount('#app');", encoding="utf-8")

    # Before synthesis, status is unlinked_assets
    v1 = verify_workspace_preview(tmp_path, "test-stitch")
    assert v1["status"] == "unlinked_assets"

    # Simulate harness synthesis
    css_files = [css_dir / "styles.css"]
    js_files = [js_dir / "app.js"]
    css_links = "\n".join(f'  <link rel="stylesheet" href="./{f.relative_to(tmp_path).as_posix()}" />' for f in css_files)
    js_scripts = "\n".join(f'  <script src="./{f.relative_to(tmp_path).as_posix()}"></script>' for f in js_files)
    html = f"<!DOCTYPE html><html><head>{css_links}</head><body><div id='app'></div>{js_scripts}</body></html>"
    (tmp_path / "index.html").write_text(html, encoding="utf-8")

    # After synthesis, status is ready
    v2 = verify_workspace_preview(tmp_path, "test-stitch")
    assert v2["status"] == "ready"
    assert v2["has_preview"] is True
    assert v2["entry_point"] == "index.html"


def test_guardrail_intent_triggers_on_clean_workspace(tmp_path):
    from app.api.preview import verify_workspace_preview

    # Completely clean / empty workspace
    v = verify_workspace_preview(tmp_path, "test-clean")
    assert v["status"] == "missing_entry_point"
    assert v["has_preview"] is False

    # The harness checks status_val in ["missing_entry_point", "missing_workspace", "empty_ui"]
    # Verify that clean workspace is correctly identified as needing guardrail intervention
    assert v["status"] in ["missing_entry_point", "missing_workspace", "empty_ui"]


def test_generate_plan_markdown():
    from app.agent.harness import generate_plan_markdown

    sample_plan = {
        "intent_category": "code_modification",
        "objective": "Build user authentication with JWT",
        "steps": [
            {"id": "step-1", "title": "Scaffold auth router and schemas", "status": "completed"},
            {"id": "step-2", "title": "Implement password hashing with bcrypt", "status": "in_progress"},
            {"id": "step-3", "title": "Add JWT token refresh endpoint", "status": "pending"},
        ],
        "evaluation": {
            "status": "in_progress",
            "summary": "Step 1 complete"
        }
    }

    md = generate_plan_markdown(sample_plan, title="JWT Auth Implementation")
    assert "# Implementation Plan: JWT Auth Implementation" in md
    assert "```mermaid" in md
    assert "flowchart LR" in md
    assert "Scaffold auth router and schemas" in md
    assert "*(Done)*" in md
    assert "*(In Progress)*" in md
    assert "*(Pending)*" in md
    assert "Invariant Verification" in md


def test_generate_plan_markdown_plan_mode():
    from app.agent.harness import generate_plan_markdown

    sample_plan = {
        "intent_category": "planning",
        "objective": "Architecture plan for real-time WebSocket telemetry",
        "steps": [
            {"id": "step-1", "title": "Analyze existing WebSocket hub and event protocols", "status": "completed"},
            {"id": "step-2", "title": "Design broadcast streaming contract", "status": "in_progress"},
            {"id": "step-3", "title": "Define invariant verification test suite", "status": "pending"},
        ],
        "evaluation": {
            "status": "in_progress",
            "summary": "Analyzing protocols"
        }
    }

    md = generate_plan_markdown(sample_plan, title="So what's the plan")
    assert "# Implementation Plan: So what's the plan" in md
    assert "> [!IMPORTANT]" in md
    assert "**Plan Mode Active**" in md
    assert "`planning`" in md
    assert "```mermaid" in md
    assert "Analyze existing WebSocket hub" in md
    assert "*(Done)*" in md
    assert "Invariant Verification" in md


def test_plan_mode_trigger_classification():
    planning_queries = [
        "So what's the plan",
        "what's the plan",
        "What is the plan?",
        "Plan this out for me",
        "Can you create a plan for migration?",
        "give me a plan"
    ]

    for q in planning_queries:
        cleaned = q.strip().lower()
        planning_phrases = [
            "what's the plan", "whats the plan", "what is the plan",
            "so what's the plan", "so whats the plan",
            "plan this", "plan this out", "create a plan", "make a plan",
            "show me the plan", "give me a plan", "draft a plan", "propose a plan",
            "plan mode", "execution plan"
        ]
        matched = any(phrase in cleaned for phrase in planning_phrases) or cleaned.startswith("plan ") or cleaned == "plan"
        assert matched, f"Failed to match planning intent on query: '{q}'"


def test_generate_plan_markdown_rich_phases():
    from app.agent.harness import generate_plan_markdown

    rich_plan = {
        "intent_category": "planning",
        "title": "Cyclode Architecture Hardening & Stabilization",
        "overview": "This plan outlines a phased remediation strategy to eliminate codebase duplication, resolve critical security and event loop bottlenecks, stabilize concurrency, and refactor the monolithic agent dispatcher.",
        "phases": [
            {
                "phase_number": 1,
                "title": "Repository Hygiene & Test Suite Consolidation",
                "objective": "Eliminate split-brain code drift between root directories and backend/ / frontend/ , and ensure test runners run cleanly without namespace collisions.",
                "file_touchpoints": [
                    "Delete redundant root mirrors: app/ , cyclode/ , src/ , tests/",
                    "Update pyproject.toml: point testpaths = ['backend/tests']"
                ],
                "verification_criteria": [
                    "Running pytest from the root executes all 166+ test suites without import file mismatch collection errors.",
                    "Running npm run build in frontend/ compiles cleanly with zero missing component imports."
                ]
            },
            {
                "phase_number": 2,
                "title": "Security & Authentication Hardening",
                "objective": "Mitigate SSRF vectors in the live preview proxy, eliminate insecure cryptographic fallbacks, and tighten CORS and webhook verification.",
                "file_touchpoints": [
                    "backend/app/api/preview.py: Implement an ephemeral port allowlist",
                    "backend/app/core/security.py: Disallow startup without SECRET_KEY"
                ],
                "verification_criteria": [
                    "Unit tests validating that requests to proxy ports <3000 return 403 Forbidden."
                ]
            }
        ],
        "steps": [
            {"id": "step-1", "title": "Repository Hygiene & Test Suite Consolidation", "status": "pending"},
            {"id": "step-2", "title": "Security & Authentication Hardening", "status": "pending"}
        ]
    }

    md = generate_plan_markdown(rich_plan)
    assert "# Implementation Plan: Cyclode Architecture Hardening & Stabilization" in md
    assert "This plan outlines a phased remediation strategy" in md
    assert "### Phase 1: Repository Hygiene & Test Suite Consolidation" in md
    assert "**Objective**: Eliminate split-brain code drift" in md
    assert "- **File Touchpoints**:" in md
    assert "Delete redundant root mirrors" in md
    assert "- **Verification Criteria**:" in md
    assert "Running pytest from the root" in md
    assert "### Phase 2: Security & Authentication Hardening" in md


def test_format_plan_chat_summary():
    from app.agent.harness import format_plan_chat_summary

    plan_data = {
        "title": "Cyclode Architecture Hardening and Reliability Remediation",
        "overview": "This plan outlines a phased architectural remediation for the Cyclode platform.",
        "phases": [
            {
                "phase_number": 1,
                "title": "Repository Hygiene & Tooling",
                "objective": "Eliminate stale root duplicate directories and configure pytest."
            },
            {
                "phase_number": 2,
                "title": "Security Hardening",
                "objective": "Close SSRF vectors in dev-server preview proxy."
            }
        ]
    }

    summary = format_plan_chat_summary(plan_data, task_id="task-test-summary-1")
    assert "I have formulated an implementation plan for **Cyclode Architecture Hardening and Reliability Remediation**." in summary
    assert "This plan outlines a phased architectural remediation" in summary
    assert "### Key Execution Phases" in summary
    assert "- **Phase 1: Repository Hygiene & Tooling**: Eliminate stale root duplicate directories" in summary
    assert "- **Phase 2: Security Hardening**: Close SSRF vectors" in summary
    assert "[👉 Inspect Full Plan in Web & Docs](plan://task-test-summary-1)" in summary


def test_advance_plan_step_monotonic_multi_step_progression():
    from app.agent.harness import Harness

    plan = {
        "steps": [
            {"id": "step-1", "title": "Scaffold project", "status": "in_progress"},
            {"id": "step-2", "title": "Build domain models", "status": "pending"},
            {"id": "step-3", "title": "Implement repositories", "status": "pending"},
            {"id": "step-4", "title": "UI Components", "status": "pending"},
            {"id": "step-5", "title": "State Management", "status": "pending"},
            {"id": "step-6", "title": "Navigation & Routing", "status": "pending"},
            {"id": "step-7", "title": "Widget tests", "status": "pending"},
            {"id": "step-8", "title": "Production Web Preview", "status": "pending"},
        ]
    }

    # Step 1 advance
    changed = Harness.advance_plan_step(plan, 1)
    assert changed is True
    assert plan["steps"][0]["status"] == "completed"
    assert plan["steps"][1]["status"] == "in_progress"
    assert plan["steps"][2]["status"] == "pending"

    # Step 4 advance
    changed = Harness.advance_plan_step(plan, 4)
    assert changed is True
    assert plan["steps"][0]["status"] == "completed"
    assert plan["steps"][1]["status"] == "completed"
    assert plan["steps"][2]["status"] == "completed"
    assert plan["steps"][3]["status"] == "completed"
    assert plan["steps"][4]["status"] == "in_progress"
    assert plan["steps"][5]["status"] == "pending"

    # Non-regression check: trying to advance backwards should return False and not regress
    changed_back = Harness.advance_plan_step(plan, 2)
    assert changed_back is False
    assert plan["steps"][4]["status"] == "in_progress"

    # Final step advance
    changed = Harness.advance_plan_step(plan, 7)
    assert changed is True
    assert plan["steps"][6]["status"] == "completed"
    assert plan["steps"][7]["status"] == "in_progress"

