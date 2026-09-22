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
