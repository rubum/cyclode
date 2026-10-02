import pytest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock

from app.core.sandboxes.jailer import jailer
from app.agent.tools import WorkspaceTools
from app.agent.harness import Harness


def test_jailer_blocks_protected_directory_deletion(tmp_path):
    destructive_commands = [
        "rm -rf app",
        "rm -rf ./app/",
        "rm -rf /app",
        "rm -rf backend",
        "rm -rf frontend",
        "rm -rf src",
        "rm -rf tests",
        "rm -r cyclode",
        "rm -rf node_modules",
        "rm -rf *",
        "rm -rf /*",
        "rm -rf /",
        "rm -rf .",
        "git clean -fdx",
        "git clean -f",
        "git clean -fd",
        "git rm -r app",
        "git rm -rf src",
        "git rm -r tests/",
        'python -c "import shutil; shutil.rmtree(\'app\')"',
        'python3 -c "import shutil; shutil.rmtree(\'tests\')"',
    ]

    for cmd in destructive_commands:
        is_safe, err = jailer.validate_command_safety(cmd, tmp_path)
        assert not is_safe, f"Command should be blocked: {cmd}"
        assert "SECURITY CIRCUIT-BREAKER" in err, f"Error message missing circuit breaker header: {err}"


def test_jailer_permits_safe_commands(tmp_path):
    safe_commands = [
        "pytest",
        "pytest backend/tests/test_safeguards.py -v",
        "npm test",
        "git status",
        "git diff",
        "rm -f temp.txt",
        "rm -rf .pytest_cache",
        "rm -rf dist",
        "rm -rf build",
        "rm -rf .next",
        "rm -rf coverage",
        "python -c \"print('safe')\"",
        "python3 -m unittest",
    ]

    for cmd in safe_commands:
        is_safe, err = jailer.validate_command_safety(cmd, tmp_path)
        assert is_safe, f"Safe command was improperly blocked: {cmd} (Error: {err})"
        assert err is None


def test_workspace_tools_run_command_circuit_breaker(tmp_path):
    result = WorkspaceTools.run_command(tmp_path, "rm -rf app")
    assert result["exit_code"] == 1
    assert "error" in result
    assert "SECURITY CIRCUIT-BREAKER" in result["error"]
    assert "SECURITY CIRCUIT-BREAKER" in result["stderr"]
    assert result["stdout"] == ""


def test_harness_sanitize_plan_phases():
    raw_phases = [
        {
            "title": "Phase 1: Eliminate stale root mirror directories (app/, src/, tests/)",
            "objective": "Delete duplicated root mirror directories that cause import confusion.",
            "file_touchpoints": ["app/", "src/"]
        },
        {
            "title": "Phase 2: Implement Feature",
            "objective": "Build the requested feature securely.",
            "file_touchpoints": ["backend/app/main.py"]
        }
    ]

    sanitized = Harness.sanitize_plan_phases(raw_phases)

    assert sanitized[0]["title"] == "Phase 1: Environment & Path Configuration Alignment"
    assert "without deleting codebase directory trees" in sanitized[0]["objective"]
    assert "pyproject.toml" in sanitized[0]["file_touchpoints"][0]

    # Non-destructive phase remains untouched
    assert sanitized[1]["title"] == "Phase 2: Implement Feature"
    assert sanitized[1]["objective"] == "Build the requested feature securely."


def test_harness_advance_plan_step_monotonic():
    plan = {
        "steps": [
            {"id": "step-1", "title": "Scaffold workspace", "status": "in_progress"},
            {"id": "step-2", "title": "Implement core logic", "status": "pending"},
            {"id": "step-3", "title": "Write unit tests", "status": "pending"},
            {"id": "step-4", "title": "Final verification", "status": "pending"}
        ]
    }

    # Advance to step 2 (index 1)
    changed = Harness.advance_plan_step(plan, 1)
    assert changed is True
    assert plan["steps"][0]["status"] == "completed"
    assert plan["steps"][1]["status"] == "in_progress"
    assert plan["steps"][2]["status"] == "pending"
    assert plan["steps"][3]["status"] == "pending"

    # Advance to step 3 (index 2)
    changed = Harness.advance_plan_step(plan, 2)
    assert changed is True
    assert plan["steps"][0]["status"] == "completed"
    assert plan["steps"][1]["status"] == "completed"
    assert plan["steps"][2]["status"] == "in_progress"
    assert plan["steps"][3]["status"] == "pending"

    # Attempt to advance backwards to index 0 (should be rejected by monotonicity)
    changed = Harness.advance_plan_step(plan, 0)
    assert changed is False
    assert plan["steps"][2]["status"] == "in_progress"
    assert plan["steps"][0]["status"] == "completed"


def test_dangling_intent_detection():
    from app.agent.harness import Harness

    # Cues indicating conversational transition before tool execution
    transitions = [
        "The JS is complete, but I need to align a few class names and add the hero orb. Let me fix these precisely:",
        "I have created the files. Now let me implement the tests:",
        "Next, I will run the test suite to verify:",
        "Let me fix the following components:",
        # Long 138-character sentence that previously failed with [-120:] character slicing
        "Now let me update the mock styles to match the new HTML structure (rail items, bubbles, tool rows, canvas grid), and add the CTA styles.",
        "I inspected the codebase. Next up, I will update the routing configuration in app.py.",
        "Proceeding to update the CSS animation keyframes for the sidebar.",
        "I need to create the audio engine and hook up Web Audio API listeners.",
        # User screenshot transitional statements with filenames and colon/forward promises
        "I have the full picture. Let me rewrite the HTML playground section to match the JS contract exactly, and add the missing hero IDs:",
        "All IDs match. Now let me verify the hero metrics and confirm the hero-ghci element that app.js may populate, plus check whether app.js references hero-ghci at all."
    ]

    for t in transitions:
        is_dangling = Harness.is_dangling_action_intent(t)
        assert is_dangling is True, f"Failed to detect dangling transition: {t}"

    # Complete non-dangling conclusions
    completed = [
        "I have completed all tasks according to the implementation plan. All tests pass.",
        "The application is now fully built, styled, and verified in Live Preview.",
        "Successfully replaced target content in 'landing/styles.css'. The layout is aligned.",
        "Fixed the import issue in main.py and ran pytest successfully."
    ]
    for c in completed:
        is_dangling = Harness.is_dangling_action_intent(c)
        assert is_dangling is False, f"False positive dangling transition: {c}"


def test_plan_step_preservation_avoids_false_accomplished():
    plan = {
        "steps": [
            {"id": "step-1", "title": "Scaffold workspace", "status": "completed"},
            {"id": "step-2", "title": "Implement core logic", "status": "in_progress"},
            {"id": "step-3", "title": "Write unit tests", "status": "pending"},
            {"id": "step-4", "title": "Final verification", "status": "pending"}
        ]
    }

    all_checks_passed = True
    any_pending_or_failed = False
    for s in plan.get("steps", []):
        if s.get("status") == "in_progress":
            if all_checks_passed:
                s["status"] = "completed"
            else:
                s["status"] = "failed"
        elif s.get("status") in ["pending", "failed"]:
            any_pending_or_failed = True

    eval_status = "accomplished" if (all_checks_passed and not any_pending_or_failed) else "needs_revision"
    
    # Even though checks passed, steps 3 and 4 are still pending, so it should NOT be accomplished
    assert any_pending_or_failed is True
    assert eval_status == "needs_revision"
    assert plan["steps"][2]["status"] == "pending"
    assert plan["steps"][3]["status"] == "pending"


def test_infer_task_intent_heuristics():
    # 1. Landing page / UI building
    landing_page_prompt = (
        "Design Cyclode Landing Page\n"
        "Extend :root with the full One Dark Pro token set and eliminate stray hex literals in index.html\n"
        "Add hero depth overlay, card elevation scale, and fluid clamp() typography ramp\n"
        "Guard the hero rAF loop with prefers-reduced-motion"
    )
    assert Harness.infer_task_intent("Design Landing Page", landing_page_prompt, "SoftwareEngineer") == "app_building"

    # 2. Action / Refactoring / Code Modification
    code_mod_prompt = "Work on that Recommended Remediation and update backend/app/agent/harness.py"
    assert Harness.infer_task_intent("Fix Remediation", code_mod_prompt, "SoftwareEngineer") == "code_modification"

    # 3. Pure Q&A
    qa_prompt = "What is Redis LangCache and how does it work?"
    assert Harness.infer_task_intent("Explain LangCache", qa_prompt, "SoftwareEngineer") == "qa_research"

    # 4. Greetings
    assert Harness.infer_task_intent("Greeting", "Hey there", "SoftwareEngineer") == "qa_research"

    # 5. Planning
    plan_prompt = "Make plan for the draft PR and explore premature stoppage"
    assert Harness.infer_task_intent("Create Plan", plan_prompt, "SoftwareEngineer") == "planning"

    # 6. Debugging
    debug_prompt = "Fix error in traceback: sqlalchemy.exc.OperationalError: no such column: is_draft"
    assert Harness.infer_task_intent("Debug DB Error", debug_prompt, "IssueResolver") == "debugging"

    # 7. DevOps
    devops_prompt = "Configure Dockerfile and docker-compose.yml for production deployment"
    assert Harness.infer_task_intent("Docker Setup", devops_prompt, "SoftwareEngineer") == "devops"

    # 8. Review & Audit
    review_prompt = "Review PR #42 and audit code diff for security regressions"
    assert Harness.infer_task_intent("PR Review", review_prompt, "CodeReviewer") == "review_audit"


def test_app_task_step_subsumption_on_verified_preview(tmp_path):
    plan = {
        "intent_category": "app_building",
        "steps": [
            {"id": "step-1", "title": "Scaffold workspace and HTML entry", "status": "in_progress"},
            {"id": "step-2", "title": "Implement CSS tokens and styles", "status": "pending"},
            {"id": "step-3", "title": "Add animations and interactivity", "status": "pending"},
            {"id": "step-4", "title": "Verify responsive design", "status": "pending"}
        ]
    }

    # Simulate verified application preview
    is_app_task = True
    mutating_tool_count = 3
    preview_status = "ready"
    all_checks_passed = True

    if is_app_task and mutating_tool_count > 0:
        if preview_status in ["ready", "compiled", "static"]:
            for s in plan.get("steps", []):
                if s.get("status") != "failed":
                    s["status"] = "completed"

    any_pending_or_failed = False
    for s in plan.get("steps", []):
        if s.get("status") == "in_progress":
            s["status"] = "completed" if all_checks_passed else "failed"
        elif s.get("status") in ["pending", "failed"]:
            any_pending_or_failed = True

    eval_status = "accomplished" if (all_checks_passed and not any_pending_or_failed) else "needs_revision"

    assert eval_status == "accomplished"
    assert all(s["status"] == "completed" for s in plan["steps"])


def test_coding_task_prevents_qa_research_false_accomplished():
    plan = {
        "intent_category": "code_modification",
        "steps": [
            {"id": "step-1", "title": "Update provider payload max tokens", "status": "in_progress"},
            {"id": "step-2", "title": "Add auto-continuation loop", "status": "pending"},
            {"id": "step-3", "title": "Run test suite", "status": "pending"}
        ]
    }

    intent_category = plan["intent_category"]
    mutating_tool_count = 0
    all_checks_passed = True

    if intent_category == "qa_research" and mutating_tool_count == 0:
        for s in plan.get("steps", []):
            if s.get("status") != "failed":
                s["status"] = "completed"
        eval_status = "accomplished"
    else:
        any_pending_or_failed = False
        for s in plan.get("steps", []):
            if s.get("status") == "in_progress":
                s["status"] = "completed" if all_checks_passed else "failed"
            elif s.get("status") in ["pending", "failed"]:
                any_pending_or_failed = True
        eval_status = "accomplished" if (all_checks_passed and not any_pending_or_failed) else "needs_revision"

    assert eval_status == "needs_revision"
    assert plan["steps"][0]["status"] == "completed"
    assert plan["steps"][1]["status"] == "pending"
    assert plan["steps"][2]["status"] == "pending"


def test_dangling_intent_blocks_preview_step_subsumption(tmp_path):
    plan = {
        "intent_category": "app_building",
        "steps": [
            {"id": "step-1", "title": "Scaffold workspace and HTML entry", "status": "in_progress"},
            {"id": "step-2", "title": "Implement CSS tokens and styles", "status": "pending"},
            {"id": "step-3", "title": "Add animations and interactivity", "status": "pending"},
            {"id": "step-4", "title": "Verify responsive design", "status": "pending"}
        ]
    }

    # Simulate verified application preview but with dangling in-flight intent on loop exit
    is_app_task = True
    mutating_tool_count = 3
    preview_status = "ready"
    all_checks_passed = True
    is_dangling_intent = True

    if is_app_task and mutating_tool_count > 0 and not is_dangling_intent:
        if preview_status in ["ready", "compiled", "static"]:
            for s in plan.get("steps", []):
                if s.get("status") != "failed":
                    s["status"] = "completed"

    any_pending_or_failed = False
    for s in plan.get("steps", []):
        if s.get("status") == "in_progress":
            s["status"] = "completed" if (all_checks_passed and not is_dangling_intent) else "failed"
        elif s.get("status") in ["pending", "failed"]:
            any_pending_or_failed = True

    eval_status = "accomplished" if (all_checks_passed and not any_pending_or_failed and not is_dangling_intent) else "needs_revision"

    assert eval_status == "needs_revision"
    assert plan["steps"][0]["status"] == "failed"
    assert plan["steps"][1]["status"] == "pending"
    assert plan["steps"][2]["status"] == "pending"
    assert plan["steps"][3]["status"] == "pending"


@pytest.mark.asyncio
async def test_evaluation_runner_detects_dangling_delivery(tmp_path):
    from app.core.evals.runner import evaluation_runner

    dangling_text = "All IDs match. Now let me verify the hero metrics and confirm the hero-ghci element that app.js may populate, plus check whether app.js references hero-ghci at all."
    scorecard = await evaluation_runner.evaluate_task(
        workspace_path=tmp_path,
        intent_category="app_building",
        is_app_task=True,
        preview_info={"status": "ready", "framework": "vanilla_html", "issues": []},
        tool_call_count=5,
        final_agent_text=dangling_text,
        model_succeeded=True
    )

    assert scorecard.status == "needs_revision"
    delivery_checks = [c for c in scorecard.checks if c.name == "Executive Delivery Completion"]
    assert len(delivery_checks) == 1
    assert delivery_checks[0].passed is False

    # Non-dangling clean delivery produces accomplished
    clean_text = "The interactive application has been constructed with all hero elements and styling verified in Live Preview."
    clean_scorecard = await evaluation_runner.evaluate_task(
        workspace_path=tmp_path,
        intent_category="app_building",
        is_app_task=True,
        preview_info={"status": "ready", "framework": "vanilla_html", "issues": []},
        tool_call_count=5,
        final_agent_text=clean_text,
        model_succeeded=True
    )
    assert clean_scorecard.status == "accomplished"
    clean_delivery_checks = [c for c in clean_scorecard.checks if c.name == "Executive Delivery Completion"]
    assert len(clean_delivery_checks) == 1
    assert clean_delivery_checks[0].passed is True


@pytest.mark.asyncio
async def test_preview_issues_block_subsumption_and_scorecard(tmp_path):
    from app.core.evals.runner import evaluation_runner

    # Simulate preview with DOM contract violation issues
    preview_with_issues = {
        "status": "js_dom_mismatch",
        "framework": "vanilla_html",
        "issues": ["DOM Contract Violation: JavaScript references element ID '#hero-metrics' via getElementById, but no element with id='hero-metrics' exists in 'index.html'."]
    }

    scorecard = await evaluation_runner.evaluate_task(
        workspace_path=tmp_path,
        intent_category="app_building",
        is_app_task=True,
        preview_info=preview_with_issues,
        tool_call_count=5,
        final_agent_text="The dashboard application is complete.",
        model_succeeded=True
    )

    assert scorecard.status == "needs_revision"
    preview_checks = [c for c in scorecard.checks if c.name == "Live Application Preview"]
    assert len(preview_checks) == 1
    assert preview_checks[0].passed is False
    assert "DOM Contract Violation" in preview_checks[0].diagnostics


@pytest.mark.asyncio
async def test_evaluation_runner_fails_on_empty_text(tmp_path):
    from app.core.evals.runner import evaluation_runner

    scorecard = await evaluation_runner.evaluate_task(
        workspace_path=tmp_path,
        intent_category="app_building",
        is_app_task=True,
        preview_info={"status": "ready", "framework": "vanilla_html", "issues": []},
        tool_call_count=5,
        final_agent_text="",
        model_succeeded=True
    )
    assert scorecard.status == "needs_revision"
    delivery_checks = [c for c in scorecard.checks if c.name == "Executive Delivery Completion"]
    assert len(delivery_checks) == 1
    assert delivery_checks[0].passed is False
    assert "No final executive summary delivered" in delivery_checks[0].diagnostics


@pytest.mark.asyncio
async def test_user_screenshot_dangling_intent_scenario(tmp_path):
    from app.core.evals.runner import evaluation_runner
    from app.agent.harness import Harness

    # Exact transitional utterance from user screenshot media_1790546748412.png
    dangling_text = "Now let me add all the missing scene-element CSS classes."

    is_dangling = Harness.is_dangling_action_intent(dangling_text)
    assert is_dangling is True

    scorecard = await evaluation_runner.evaluate_task(
        workspace_path=tmp_path,
        intent_category="app_building",
        is_app_task=True,
        preview_info={"status": "ready", "framework": "vanilla_html", "issues": []},
        tool_call_count=15,
        final_agent_text=dangling_text,
        model_succeeded=False
    )
    assert scorecard.status == "needs_revision"
    delivery_checks = [c for c in scorecard.checks if c.name == "Executive Delivery Completion"]
    assert len(delivery_checks) == 1
    assert delivery_checks[0].passed is False
    assert "in-flight transitional action promises" in delivery_checks[0].diagnostics


def test_extract_dsml_tool_calls_from_user_screenshot():
    from app.agent.providers.base import extract_markup_tool_calls

    # Exact payload from user screenshot media_1790549784320.png
    raw_dsml = (
        '< | DSML | | calls> < | DSML | | invoke name="run_command"> '
        '< | DSML | | parameter name="command" string="true">cd live_rooms && grep -rn "phx-no-format\\|phx-no-feedback" lib/ 2>/dev/null; '
        'echo "=== check for stray closing tags / duplicate forms ==="; '
        'grep -c "<form" lib/live_rooms_web/live/room_live.html.heex; '
        'grep -c "</form>" lib/live_rooms_web/live/room_live.html.heex</ | DSML | | parameter> '
        '</ | DSML | | invoke> </ | DSML | | calls>'
    )

    cleaned_text, tool_calls = extract_markup_tool_calls(raw_dsml)
    assert len(tool_calls) == 1
    assert tool_calls[0].tool_name == "run_command"
    assert "command" in tool_calls[0].tool_args
    assert "cd live_rooms" in tool_calls[0].tool_args["command"]
    assert "grep -c" in tool_calls[0].tool_args["command"]
    assert cleaned_text == ""


def test_extract_deepseek_special_token_and_xml_tool_calls():
    from app.agent.providers.base import extract_markup_tool_calls

    # DeepSeek special tokens
    special_tokens_msg = (
        'Inspecting repository.\n'
        '<｜tool_calls｜><｜tool_call_begin｜>function<｜tool_sep｜>run_command\n'
        '```json\n{"command": "pytest backend/tests/test_safeguards.py"}\n```\n'
        '<｜tool_call_end｜>'
    )
    cleaned_st, tcs_st = extract_markup_tool_calls(special_tokens_msg)
    assert len(tcs_st) == 1
    assert tcs_st[0].tool_name == "run_command"
    assert tcs_st[0].tool_args["command"] == "pytest backend/tests/test_safeguards.py"
    assert "Inspecting repository." in cleaned_st
    assert "<｜tool_calls｜>" not in cleaned_st

    # Generic <tool_call> XML
    xml_msg = (
        '<tool_call>\n'
        '{"name": "edit_file", "arguments": {"file_path": "test.txt", "content": "hello world"}}\n'
        '</tool_call>'
    )
    cleaned_xml, tcs_xml = extract_markup_tool_calls(xml_msg)
    assert len(tcs_xml) == 1
    assert tcs_xml[0].tool_name == "edit_file"
    assert tcs_xml[0].tool_args["file_path"] == "test.txt"
    assert tcs_xml[0].tool_args["content"] == "hello world"
    assert cleaned_xml == ""


def test_jailer_permits_compound_build_commands_and_grep_pipelines(tmp_path):
    # Exact Phoenix / Elixir build cleanup command from user screenshot media_1790550763306.png
    phoenix_cmd = (
        'cd /workspaces/sandbox-05b87f4b-67fd-4b7a-adfe-24f27ac167e2/live_rooms && '
        'rm -rf _build/dev/lib/live_rooms && '
        'timeout 55 mix compile 2>&1 | grep -v "phoenix/presence.ex" | '
        'grep -v "otp_app: :my_app" | grep -v "^\\s*|" | grep -v "^\\s*└─" | '
        'grep -v "^\\s*~" | grep -v "^$" | tail -20'
    )
    is_safe, err = jailer.validate_command_safety(phoenix_cmd, tmp_path)
    assert is_safe, f"Compound Phoenix compile command should be safe, got error: {err}"
    assert err is None

    # Rust cargo build cleanup
    cargo_cmd = "rm -rf target/debug && cargo build --release"
    is_safe, err = jailer.validate_command_safety(cargo_cmd, tmp_path)
    assert is_safe, f"Cargo clean command should be safe, got error: {err}"
    assert err is None

    # Node Vite / Next build cleanup
    node_cmd = "rm -rf .next && rm -rf dist && npm run build"
    is_safe, err = jailer.validate_command_safety(node_cmd, tmp_path)
    assert is_safe, f"Node clean command should be safe, got error: {err}"
    assert err is None


def test_workspace_tools_bypass_safety(tmp_path):
    res = WorkspaceTools.run_command(tmp_path, "rm -rf app", bypass_safety=True)
    assert "SECURITY CIRCUIT-BREAKER" not in res.get("error", "")
    assert "SECURITY CIRCUIT-BREAKER" not in res.get("stderr", "")


@pytest.mark.asyncio
async def test_agent_pool_approve_destructive_command_blocked(tmp_path):
    import uuid
    from app.db.session import async_session_factory
    from app.db.models import TaskModel, TaskApprovalModel, TaskMessageModel
    from app.agent.pool import agent_pool
    from sqlalchemy import select

    task_id = f"test-task-{uuid.uuid4().hex[:8]}"
    test_file = tmp_path / "scratch_test.txt"
    test_file.write_text("initial content", encoding="utf-8")

    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Test Blocked Command Approval",
            description="Testing approval routing",
            workspace_path=str(tmp_path),
            status="AWAITING_APPROVAL"
        )
        session.add(task)
        await session.flush()

        approval = TaskApprovalModel(
            task_id=task_id,
            action_type="DESTRUCTIVE_COMMAND_BLOCKED",
            action_details={
                "command": f"rm -f {test_file.name}",
                "description": f"Blocked command: rm -f {test_file.name}"
            },
            status="PENDING"
        )
        session.add(approval)
        await session.commit()

    # Resolve approval
    res = await agent_pool.approve_task(task_id, feedback="Approved by reviewer")
    assert res["ok"] is True
    assert res["status"] == "APPROVED"

    # Verify command was executed and file removed
    assert not test_file.exists()

    # Verify task status is IN_PROGRESS (not COMPLETED with bogus PR)
    async with async_session_factory() as session:
        t_stmt = select(TaskModel).where(TaskModel.id == task_id)
        t_res = await session.execute(t_stmt)
        updated_task = t_res.scalars().first()
        assert updated_task.status == "IN_PROGRESS"

        # Verify messages do not contain bogus 'Pull Request created: None'
        m_stmt = select(TaskMessageModel).where(TaskMessageModel.task_id == task_id)
        m_res = await session.execute(m_stmt)
        messages = m_res.scalars().all()
        assert len(messages) >= 1
        assert "Command executed:" in messages[0].content
        assert "None" not in messages[0].content


@pytest.mark.asyncio
async def test_pr_review_approval_chat_only(tmp_path):
    from app.db.session import async_session_factory
    from app.db.models import TaskModel, TaskApprovalModel, TaskMessageModel
    from app.agent.pool import agent_pool
    from sqlalchemy import select

    task_id = str(uuid.uuid4())

    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Test PR Review Approval",
            description="Testing PR review staging",
            workspace_path=str(tmp_path),
            status="AWAITING_APPROVAL"
        )
        session.add(task)
        await session.flush()

        approval = TaskApprovalModel(
            task_id=task_id,
            action_type="post_pull_request_review",
            action_details={
                "repository": "owner/test-repo",
                "pr_number": 42,
                "body": "### Automated PR Review\n- Logic looks solid.",
                "event": "COMMENT"
            },
            status="PENDING"
        )
        session.add(approval)
        await session.commit()

    # Approve with chat_only option
    res = await agent_pool.approve_task(task_id, custom_details={"chat_only": True})
    assert res["ok"] is True
    assert res["status"] == "APPROVED"

    async with async_session_factory() as session:
        t_stmt = select(TaskModel).where(TaskModel.id == task_id)
        t_res = await session.execute(t_stmt)
        updated_task = t_res.scalars().first()
        assert updated_task.status == "COMPLETED"
        assert "Review Preserved in Chat" in updated_task.result_summary

        m_stmt = select(TaskMessageModel).where(TaskMessageModel.task_id == task_id)
        m_res = await session.execute(m_stmt)
        messages = m_res.scalars().all()
        assert any("Review preserved in chat" in m.content for m in messages)





