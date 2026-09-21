import pytest
import asyncio
import httpx
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel, TaskPRModel, RepositoryConfigModel
from app.core.router import event_router


@pytest.mark.asyncio
async def test_pr_listener_api_and_state():
    async with async_session_factory() as session:
        # Create a test task and PR
        task = TaskModel(
            title="PR Listener Test Session",
            session_key="github:octocat/Hello-World:pr:101",
            repo_name="octocat/Hello-World",
            repo_url="https://github.com/octocat/Hello-World",
            is_listening=False
        )
        session.add(task)
        await session.commit()
        await session.refresh(task)

        pr = TaskPRModel(
            task_id=task.id,
            pr_number=101,
            title="Feature: Add listener sentinel",
            head_branch="feature/listener",
            base_branch="main",
            is_listening=False,
            listening_events="check_run,pull_request_review_comment"
        )
        session.add(pr)
        await session.commit()
        await session.refresh(pr)
        task_id = task.id
        pr_number = pr.pr_number

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Query initial PR listen config
        get_res = await client.get(f"/api/tasks/{task_id}/prs/{pr_number}/listen")
        assert get_res.status_code == 200
        data = get_res.json()
        assert data["is_listening"] is False
        assert "check_run" in data["listening_events"]

        # 2. Update PR listen config to active
        post_res = await client.post(
            f"/api/tasks/{task_id}/prs/{pr_number}/listen",
            json={
                "is_listening": True,
                "listening_events": ["check_run", "pull_request_review_comment", "push"],
                "listener_persona": "CodeReviewer",
                "auto_commit_fixes": True
            }
        )
        assert post_res.status_code == 200
        updated = post_res.json()
        assert updated["is_listening"] is True
        assert updated["listener_persona"] == "CodeReviewer"
        assert len(updated["listening_events"]) == 3

        # 3. Query again to verify persistence
        get_res2 = await client.get(f"/api/tasks/{task_id}/prs/{pr_number}/listen")
        assert get_res2.status_code == 200
        assert get_res2.json()["is_listening"] is True


@pytest.mark.asyncio
async def test_repo_listener_api_and_state():
    async with async_session_factory() as session:
        repo = RepositoryConfigModel(
            name="Hello-World",
            full_name="octocat/Hello-World",
            clone_url="https://github.com/octocat/Hello-World.git",
            is_listening=False,
            subscribed_events="pull_request.opened,issues.opened"
        )
        session.add(repo)
        await session.commit()
        await session.refresh(repo)
        repo_id = repo.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Query repo listener config
        get_res = await client.get(f"/api/repositories/{repo_id}/listen")
        assert get_res.status_code == 200
        data = get_res.json()
        assert data["is_listening"] is False
        assert "pull_request.opened" in data["subscribed_events"]

        # 2. Activate repo sentinel listening
        post_res = await client.post(
            f"/api/repositories/{repo_id}/listen",
            json={
                "is_listening": True,
                "subscribed_events": ["pull_request.opened", "issues.opened", "check_run"],
                "default_persona": "AUTONOMOUS_WORKER"
            }
        )
        assert post_res.status_code == 200
        updated = post_res.json()
        assert updated["is_listening"] is True
        assert len(updated["subscribed_events"]) == 3

        # 3. Verify in repository serialization
        list_res = await client.get("/api/repositories")
        assert list_res.status_code == 200
        repos = list_res.json()
        matching = [r for r in repos if r["id"] == repo_id]
        assert len(matching) == 1
        assert matching[0]["is_listening"] is True


@pytest.mark.asyncio
async def test_pr_listening_event_awakening():
    async with async_session_factory() as session:
        task = TaskModel(
            title="Listening PR Task",
            session_key="github:octocat/Hello-World:pr:200",
            repo_name="octocat/Hello-World",
            repo_url="https://github.com/octocat/Hello-World",
            is_listening=True,
            listener_persona="PAIR_PROGRAMMER"
        )
        session.add(task)
        await session.commit()
        await session.refresh(task)

        pr = TaskPRModel(
            task_id=task.id,
            pr_number=200,
            title="Listening PR #200",
            head_branch="feature/listen-test",
            base_branch="main",
            is_listening=True,
            listening_events="check_run,pull_request_review_comment"
        )
        session.add(pr)
        await session.commit()
        await session.refresh(pr)

    # Route a comment event for PR #200
    comment_payload = {
        "action": "created",
        "comment": {
            "body": "@cyclode please inspect test coverage."
        },
        "issue": {
            "number": 200,
            "title": "Listening PR #200"
        },
        "repository": {
            "full_name": "octocat/Hello-World"
        }
    }

    result = await event_router.route_and_dispatch(
        source="github",
        event_type="issue_comment",
        payload=comment_payload,
        signature_valid=True
    )

    assert result["ok"] is True
    assert result["is_awakened"] is True
    assert result["task_id"] == task.id
