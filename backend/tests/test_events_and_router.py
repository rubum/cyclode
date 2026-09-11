import pytest
from app.core.router import event_router
from app.agent.pool import estimate_tokens


def test_router_param_resolution():
    # GitHub issue event
    gh_payload = {"issue": {"number": 104, "title": "Crash on empty user profile", "body": "Details here"}}
    title, desc, persona, action = event_router._resolve_task_params("github", "issues.opened", gh_payload)
    assert "GitHub Issue #104" in title
    assert persona == "IssueResolver"
    assert action == "spawn_task"

    # GitHub PR opened
    pr_payload = {
        "repository": {"full_name": "octocat/fintech-api"},
        "pull_request": {"number": 42, "title": "Add Stripe webhooks", "body": "Security fix"}
    }
    title, desc, persona, action = event_router._resolve_task_params("github", "pull_request.opened", pr_payload)
    assert "PR #42" in title
    assert persona == "CodeReviewer"
    assert action == "spawn_task"

    # GitHub PR synchronize (new commit)
    sync_payload = {
        "repository": {"full_name": "octocat/fintech-api"},
        "pull_request": {"number": 42, "head": {"sha": "98a1c4f"}},
        "after": "98a1c4f9999"
    }
    title, desc, persona, action = event_router._resolve_task_params("github", "pull_request.synchronize", sync_payload)
    assert "Incremental Review on PR #42" in title
    assert action == "awaken_session"

    # AppSignal exception alert
    as_payload = {"incident": {"exception_name": "NoMethodError", "error_message": "undefined method for nil"}}
    title, desc, persona, action = event_router._resolve_task_params("appsignal", "exception", as_payload)
    assert "AppSignal Alert: NoMethodError" in title
    assert persona == "APMTriage"

    # Slack slash command
    slack_payload = {"text": "/adappty fix memory leak in worker pool"}
    title, desc, persona, action = event_router._resolve_task_params("slack", "slash_command", slack_payload)
    assert persona == "IssueResolver"


def test_router_metadata_extraction():
    # GitHub PR session key
    pr_payload = {
        "repository": {"full_name": "acme/payment-gw", "clone_url": "https://github.com/acme/payment-gw.git"},
        "pull_request": {
            "number": 108,
            "head": {"ref": "feature/idempotency", "sha": "abc1234"}
        }
    }
    session_key, repo_name, repo_url, branch, commit_sha = event_router._extract_metadata("github", "pull_request.opened", pr_payload)
    assert session_key == "github:acme/payment-gw:pr:108"
    assert repo_name == "acme/payment-gw"
    assert branch == "feature/idempotency"
    assert commit_sha == "abc1234"

    # Sentry session key
    sentry_payload = {
        "project": "auth-service",
        "incident": {"id": "SENTRY-99"}
    }
    session_key, repo_name, repo_url, branch, commit_sha = event_router._extract_metadata("sentry", "issue.created", sentry_payload)
    assert session_key == "sentry:auth-service:issue:SENTRY-99"


def test_token_estimation():
    short_text = "Hello world"
    tokens = estimate_tokens(short_text)
    assert tokens >= 2

    long_code = "def authenticate_user(username: str, token: str) -> bool:\n    return hmac.compare_digest(hash(token), expected)"
    code_tokens = estimate_tokens(long_code)
    assert code_tokens > 10


def test_clone_exceptions():
    from app.core.sandboxes.base import CloneAuthRequiredException, CloneFailedException
    auth_exc = CloneAuthRequiredException(repo_url="https://github.com/private/repo", stderr="fatal: could not read Username")
    assert "https://github.com/private/repo" in str(auth_exc)
    assert "fatal: could not read Username" in auth_exc.stderr

    fail_exc = CloneFailedException(repo_url="https://github.com/invalid/repo", stderr="Repository not found")
    assert "Failed to clone repository" in str(fail_exc)


@pytest.mark.asyncio
async def test_conversational_auth_guidance(tmp_path):
    from app.agent.harness import antigravity_harness
    messages_captured = []

    async def mock_msg(sender, content):
        messages_captured.append((sender, content))

    res = await antigravity_harness._execute_local_intent(
        task_id="task-test",
        title="how do I get that?",
        prompt='"Paste your Token here in Chat" - how do I get that?',
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res.get("status") == "AWAITING_INPUT"
    assert len(messages_captured) > 0
    sender, content = messages_captured[0]
    assert sender == "agent"
    assert "Personal Access Token" in content
    assert "github.com/settings/tokens" in content
    assert "repo" in content


@pytest.mark.asyncio
async def test_repository_analysis_intent(tmp_path):
    from app.agent.harness import antigravity_harness
    from app.core.worktree import worktree_manager

    # Initialize sample repo in tmp_path
    worktree_manager.init_sample_repo_if_needed(tmp_path)

    messages_captured = []
    async def mock_msg(sender, content):
        messages_captured.append((sender, content))

    # Test 1: "Analyse it"
    res1 = await antigravity_harness._execute_local_intent(
        task_id="task-analysis-1",
        title="Analyse it",
        prompt="Analyse it",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res1.get("status") == "COMPLETED"
    assert len(messages_captured) == 1
    sender, content = messages_captured[0]
    assert sender == "agent"
    assert "Repository & Architecture Analysis" in content
    assert "Tech Stack & Environment" in content
    assert "app/auth_service.py" in content or "app" in content

    # Test 2: Follow-up question "Where is the repo analysis"
    messages_captured.clear()
    res2 = await antigravity_harness._execute_local_intent(
        task_id="task-analysis-2",
        title="Where is the repo analysis",
        prompt="Where is the repo analysis",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res2.get("status") == "COMPLETED"
    assert len(messages_captured) == 1
    sender, content = messages_captured[0]
    assert "Repository & Architecture Analysis" in content
    assert "Quick Navigation" not in content


@pytest.mark.asyncio
async def test_unauthenticated_private_repo_connect_and_analyze(tmp_path):
    from app.agent.harness import antigravity_harness
    messages_captured = []

    async def mock_msg(sender, content):
        messages_captured.append((sender, content))

    res = await antigravity_harness._execute_local_intent(
        task_id="task-private-repo",
        title="Connect and analyze repository https://github.com/gowaylo/waylo",
        prompt="Connect and analyze repository https://github.com/gowaylo/waylo",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res.get("status") == "AWAITING_INPUT"
    assert len(messages_captured) == 1
    sender, content = messages_captured[0]
    assert sender == "agent"
    assert "GitHub Authentication Required" in content
    assert "private repository" in content
    assert "Personal Access Token" in content
    assert "Integration & Repository Configuration Updated" not in content
    assert "Ready to execute autonomous tasks" not in content
