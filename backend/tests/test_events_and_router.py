import pytest
import uuid
import subprocess
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
    slack_payload = {"text": "/cyclode fix memory leak in worker pool"}
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
async def test_realtime_event_broadcast_and_webhook_listener_registration(monkeypatch):
    from app.core.router import event_router
    from app.api.websocket import ws_manager
    from app.integrations.github_client import github_client
    from app.integrations.manager import integration_manager

    # 1. Test EventRouter broadcasts EVENT_RECEIVED over WebSocket
    broadcasts = []
    async def mock_broadcast(event_type, data):
        broadcasts.append((event_type, data))

    monkeypatch.setattr(ws_manager, "broadcast", mock_broadcast)

    payload = {
        "repository": {"full_name": "listener-org/listener-service", "clone_url": "https://github.com/listener-org/listener-service"},
        "pull_request": {"number": 15, "head": {"ref": "fix-stripe-checkout", "sha": "a1b2c3d"}},
        "sender": {"login": "octocat"}
    }

    res = await event_router.route_and_dispatch(
        source="github",
        event_type="pull_request.opened",
        payload=payload,
        signature_valid=True
    )

    assert res["ok"] is True
    assert res["session_key"] == "github:listener-org/listener-service:pr:15"
    assert res["persona"] == "CodeReviewer"

    # Verify WebSocket broadcast occurred
    event_broadcasts = [b for b in broadcasts if b[0] == "EVENT_RECEIVED"]
    assert len(event_broadcasts) >= 1
    ev_type, ev_data = event_broadcasts[0]
    assert ev_type == "EVENT_RECEIVED"
    assert ev_data["source"] == "github"
    assert ev_data["event_type"] == "pull_request.opened"
    assert ev_data["signature_valid"] is True
    assert ev_data["task_id"] == res["task_id"]

    # 2. Test GitHub Webhook Listener Creation via IntegrationManager
    async def mock_create_hook(owner, repo, webhook_url, secret=None, events=None, custom_token=None):
        return {
            "success": True,
            "hook_id": 998877,
            "status": "active",
            "message": f"Successfully registered webhook listener on {owner}/{repo}.",
            "events": events or ["pull_request", "issues"],
            "webhook_url": webhook_url
        }

    monkeypatch.setattr(github_client, "create_or_update_webhook", mock_create_hook)

    hook_res = await integration_manager.install_repo_webhook(
        full_name="listener-org/listener-service",
        webhook_url="http://localhost:8000/api/webhooks/github",
        custom_token="ghp_mocktoken12345678"
    )

    assert hook_res["success"] is True
    assert hook_res["hook_id"] == 998877
    assert hook_res["status"] == "active"


@pytest.mark.asyncio
async def test_repository_simulate_event_endpoint():
    from app.db.session import async_session_factory
    from app.db.models import RepositoryConfigModel, get_utc_now
    from app.core.security import encrypt_secret
    from app.api.repositories import simulate_repository_event

    u_id = uuid.uuid4().hex[:6]
    repo_name = f"sim-checkout-{u_id}"
    full_name = f"sim-org/{repo_name}"

    async with async_session_factory() as session:
        repo = RepositoryConfigModel(
            name=repo_name,
            full_name=full_name,
            clone_url=f"https://github.com/{full_name}",
            default_branch="main",
            encrypted_token=encrypt_secret("ghp_testtoken9999"),
            auth_provider="github",
            status="CONNECTED",
            created_at=get_utc_now(),
            updated_at=get_utc_now()
        )
        session.add(repo)
        await session.commit()
        await session.refresh(repo)
        repo_id = repo.id

    async with async_session_factory() as session:
        res = await simulate_repository_event(repo_id=repo_id, event_type="pull_request.opened", db=session)
        assert res["ok"] is True
        assert res["result"]["session_key"] == f"github:{full_name}:pr:99"
        assert res["result"]["persona"] == "CodeReviewer"
