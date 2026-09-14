import pytest
import shutil
import tempfile
from pathlib import Path
from app.agent.handlers.base import IntentContext
from app.agent.handlers.repo_handlers import PRReviewHandler
from app.agent.handlers import intent_registry
from app.integrations.github_client import github_client
from app.core.worktree import WorktreeManager


def make_test_ctx(prompt: str, workspace_path: Path) -> IntentContext:
    messages = []
    tool_calls = []

    async def mock_thought(t): pass
    async def mock_msg(s, m): messages.append((s, m))
    async def mock_tool_start(n, a): tool_calls.append(("start", n, a))
    async def mock_tool_end(n, o, e, d): tool_calls.append(("end", n, o))

    ctx = IntentContext(
        task_id="pr-test-task-123",
        title=prompt,
        prompt=prompt,
        lower_prompt=prompt.lower().strip(),
        persona_name="CodeReviewer",
        workspace_path=workspace_path,
        emit_thought=mock_thought,
        emit_message=mock_msg,
        call_tool_start=mock_tool_start,
        call_tool_end=mock_tool_end,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None,
        extra={"captured_messages": messages, "captured_tools": tool_calls}
    )
    return ctx


def test_pr_review_handler_matching():
    handler = PRReviewHandler()

    ctx1 = make_test_ctx("Get the pending prs in @myproject", Path("/tmp"))
    assert handler.matches_strict(ctx1) is True
    assert handler.matches(ctx1) is True

    ctx2 = make_test_ctx("fetch open pull requests for @payment-service", Path("/tmp"))
    assert handler.matches_strict(ctx2) is True
    assert handler.matches(ctx2) is True

    ctx3 = make_test_ctx("review pending prs on @acme/frontend", Path("/tmp"))
    assert handler.matches_strict(ctx3) is True

    ctx4 = make_test_ctx("how do i write a pull request in git", Path("/tmp"))
    assert handler.matches_strict(ctx4) is False


@pytest.mark.asyncio
async def test_github_client_list_pull_requests():
    prs = await github_client.list_pull_requests("acme", "auth-service")
    assert isinstance(prs, list)
    assert len(prs) >= 2
    pr_numbers = [p["number"] for p in prs]
    assert 101 in pr_numbers
    assert 104 in pr_numbers


@pytest.mark.asyncio
async def test_github_client_get_pr_diff():
    diff_101 = await github_client.get_pull_request_diff("acme", "auth-service", 101)
    assert "diff --git" in diff_101
    assert "auth_service.py" in diff_101

    diff_104 = await github_client.get_pull_request_diff("acme", "auth-service", 104)
    assert "cache.py" in diff_104


def test_worktree_manager_pr_sandboxing():
    temp_dir = Path(tempfile.mkdtemp(prefix="cyclode_test_wt_"))
    try:
        wt_mgr = WorktreeManager(root_dir=str(temp_dir))
        workspace = temp_dir / "task-pr-test"

        prs = [
            {"number": 101, "title": "fix: auth null check", "simulated": True},
            {"number": 104, "title": "feat: cache storage", "simulated": True}
        ]

        enriched = wt_mgr.setup_pr_worktrees(
            workspace_path=workspace,
            repo_url=None,
            token=None,
            prs=prs
        )

        assert len(enriched) == 2
        assert (workspace / "prs" / "pr-101").exists()
        assert (workspace / "prs" / "pr-104").exists()

        diffs_101 = wt_mgr.get_pr_diffs(workspace, 101)
        assert len(diffs_101) > 0
        diff_files = [d["file_path"] for d in diffs_101]
        assert any("auth_service.py" in f for f in diff_files)

        # Run test inside PR worktree
        test_res = wt_mgr.run_test_in_pr_worktree(
            workspace_path=workspace,
            pr_num=101,
            test_command="python3 -m unittest discover tests"
        )
        assert "ok" in test_res
        assert test_res["ok"] is True
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.mark.asyncio
async def test_pr_review_handler_execution():
    temp_dir = Path(tempfile.mkdtemp(prefix="cyclode_test_handler_"))
    try:
        handler = PRReviewHandler()
        ctx = make_test_ctx("Get the pending prs in @auth-service", temp_dir)
        res = await handler.execute(ctx)
        assert res["handled"] is True
        assert res["final_output"] is not None
        assert "Pull Requests" in res["final_output"]
        assert "101" in res["final_output"]
        assert "104" in res["final_output"]
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.mark.asyncio
async def test_github_client_post_pull_request_review():
    review_res = await github_client.post_pull_request_review(
        owner="acme",
        repo="auth-service",
        pr_number=101,
        body="LGTM! Defensive null checks are correctly implemented.",
        event="COMMENT"
    )
    assert review_res["ok"] is True
    assert review_res["pr_number"] == 101
    assert review_res["event"] == "COMMENT"

