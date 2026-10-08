import pytest
from app.integrations.github_client import github_client
from app.agent.tools import WorkspaceTools


@pytest.mark.asyncio
async def test_github_client_check_runs_and_reviews(monkeypatch):
    monkeypatch.setenv("GITHUB_MOCK_TEST_MODE", "1")

    # 1. Test check runs
    checks = await github_client.get_check_runs("confident-ai", "deepeval", "a1b2c3d4e5f6")
    assert checks["total_count"] == 3
    assert checks["conclusion"] == "success"
    assert len(checks["check_runs"]) == 3
    assert checks["check_runs"][0]["name"] == "pytest / test-backend (3.11)"
    assert checks["check_runs"][0]["conclusion"] == "success"

    # 2. Test reviews rollup
    reviews = await github_client.get_pull_request_reviews("confident-ai", "deepeval", 101)
    assert reviews["verdict"] == "APPROVED"
    assert reviews["total_reviews"] == 1
    assert "senior-eng" in reviews["approvals"]
    assert len(reviews["reviews"]) == 1


@pytest.mark.asyncio
async def test_workspace_tools_composite_pr_telemetry(monkeypatch):
    monkeypatch.setenv("GITHUB_MOCK_TEST_MODE", "1")

    # Verify get_pull_request_details returns full telemetry
    details = await WorkspaceTools.get_pull_request_details("confident-ai/deepeval", 101)
    assert details["repository"] == "confident-ai/deepeval"
    assert details["number"] == 101
    assert details["mergeable"] is True
    assert details["mergeable_state"] == "clean"
    assert details["checks_summary"]["conclusion"] == "success"
    assert details["checks_summary"]["total_checks"] == 3
    assert details["reviews_summary"]["verdict"] == "APPROVED"
    assert "senior-eng" in details["reviews_summary"]["approvals"]

    # Verify dedicated get_pull_request_checks tool
    pr_checks = await WorkspaceTools.get_pull_request_checks("confident-ai/deepeval", 101)
    assert pr_checks["repository"] == "confident-ai/deepeval"
    assert pr_checks["number"] == 101
    assert pr_checks["conclusion"] == "success"
    assert pr_checks["total_checks"] == 3
    assert len(pr_checks["check_runs"]) == 3
