import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel


@pytest.mark.asyncio
async def test_subsession_creation_and_filtering():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create a primary task
        primary_res = await client.post("/api/tasks", json={
            "title": "Primary Task Session",
            "description": "Root session for main work",
            "persona": "IssueResolver",
            "is_subsession": False
        })
        assert primary_res.status_code == 200
        primary_id = primary_res.json()["task_id"]

        # 2. Create a review sub-session attached to the primary task
        subsession_res = await client.post("/api/tasks", json={
            "title": "Code Review: org/repo #104 - Fix Memory Leak",
            "description": "PR Review Popover Sub-session",
            "persona": "CodeReviewer",
            "session_key": "review:org/repo:pr:104",
            "is_subsession": True,
            "parent_task_id": primary_id,
            "repo_name": "org/repo"
        })
        assert subsession_res.status_code == 200
        subsession_id = subsession_res.json()["task_id"]

        # 3. Default GET /api/tasks MUST filter out subsessions
        list_res = await client.get("/api/tasks")
        assert list_res.status_code == 200
        tasks = list_res.json()
        task_ids = [t["id"] for t in tasks]
        assert primary_id in task_ids
        assert subsession_id not in task_ids

        # 4. GET /api/tasks?is_subsession=true returns subsessions
        sub_list_res = await client.get("/api/tasks?is_subsession=true")
        assert sub_list_res.status_code == 200
        sub_tasks = sub_list_res.json()
        sub_ids = [t["id"] for t in sub_tasks]
        assert subsession_id in sub_ids
        assert primary_id not in sub_ids

        # 5. GET /api/tasks?session_key=review:org/repo:pr:104 returns the specific review sub-session
        key_res = await client.get("/api/tasks?session_key=review:org/repo:pr:104")
        assert key_res.status_code == 200
        key_tasks = key_res.json()
        assert len(key_tasks) >= 1
        assert key_tasks[0]["id"] == subsession_id
        assert key_tasks[0]["is_subsession"] is True
        assert key_tasks[0]["parent_task_id"] == primary_id

        # 6. GET /api/tasks/{task_id} on subsession includes is_subsession and parent_task_id
        detail_res = await client.get(f"/api/tasks/{subsession_id}")
        assert detail_res.status_code == 200
        detail = detail_res.json()
        assert detail["is_subsession"] is True
        assert detail["parent_task_id"] == primary_id
