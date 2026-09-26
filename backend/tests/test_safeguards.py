import pytest
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
    # Cues indicating conversational transition before tool execution
    transitions = [
        "The JS is complete, but I need to align a few class names and add the hero orb. Let me fix these precisely:",
        "I have created the files. Now let me implement the tests:",
        "Next, I will run the test suite to verify:",
        "Let me fix the following components:"
    ]

    for t in transitions:
        raw = t.strip()
        ends_with_colon = raw.endswith(":")
        tail_lower = raw.lower()[-120:]
        forward_phrases = [
            "let me ", "let us ", "let's ", "i will now", "i'll now", "i will proceed",
            "i am going to", "now let me", "next, i will", "next, let's", "next step is to",
            "let me fix", "let me implement", "let me update", "let me create", "let me add"
        ]
        is_dangling = ends_with_colon or any(p in tail_lower for p in forward_phrases)
        assert is_dangling is True, f"Failed to detect dangling transition: {t}"

    # Complete non-dangling conclusions
    completed = [
        "I have completed all tasks according to the implementation plan. All tests pass.",
        "The application is now fully built, styled, and verified in Live Preview."
    ]
    for c in completed:
        raw = c.strip()
        ends_with_colon = raw.endswith(":")
        tail_lower = raw.lower()[-120:]
        forward_phrases = [
            "let me ", "let us ", "let's ", "i will now", "i'll now", "i will proceed",
            "i am going to", "now let me", "next, i will", "next, let's", "next step is to",
            "let me fix", "let me implement", "let me update", "let me create", "let me add"
        ]
        is_dangling = ends_with_colon or any(p in tail_lower for p in forward_phrases)
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
