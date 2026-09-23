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


@pytest.mark.asyncio
async def test_task_pr_endpoints_and_actions():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create a task
        create_res = await client.post("/api/tasks", json={
            "title": "Task for PR Testing",
            "description": "Validating PR tab mission control",
            "persona": "CodeReviewer",
            "repo_name": "octocat/Hello-World"
        })
        assert create_res.status_code == 200
        task_id = create_res.json()["task_id"]

        # 2. Attach a PR to the task
        attach_res = await client.post(f"/api/tasks/{task_id}/prs", json={
            "pr_number": 42,
            "title": "Fix race condition in session loop",
            "head_branch": "fix/session-race",
            "base_branch": "main",
            "author": "octocat",
            "html_url": "https://github.com/octocat/Hello-World/pull/42"
        })
        assert attach_res.status_code == 200
        pr_id = attach_res.json()["pr_id"]

        # 3. GET /api/tasks/{task_id}/prs returns the attached PR
        list_prs_res = await client.get(f"/api/tasks/{task_id}/prs")
        assert list_prs_res.status_code == 200
        prs = list_prs_res.json()
        assert len(prs) == 1
        assert prs[0]["pr_number"] == 42
        assert prs[0]["title"] == "Fix race condition in session loop"
        assert prs[0]["status"] == "OPEN"

        # 4. GET /api/tasks/{task_id} includes prs list in detail
        task_detail_res = await client.get(f"/api/tasks/{task_id}")
        assert task_detail_res.status_code == 200
        task_detail = task_detail_res.json()
        assert "prs" in task_detail
        assert len(task_detail["prs"]) == 1
        assert task_detail["prs"][0]["pr_number"] == 42

        # 5. Trigger PR action (run_tests)
        action_res = await client.post(f"/api/tasks/{task_id}/prs/{pr_id}/action", json={
            "action": "run_tests"
        })
        assert action_res.status_code == 200
        action_data = action_res.json()
        assert action_data["ok"] is True
        assert action_data["status"] in ["TESTS_PASSING", "TESTS_FAILED"]

        # 6. Check GET /api/tasks/{task_id}/prs/{pr_number}/diff
        diff_res = await client.get(f"/api/tasks/{task_id}/prs/42/diff")
        assert diff_res.status_code == 200
        diff_data = diff_res.json()
        assert diff_data["ok"] is True
        assert "diffs" in diff_data

        # 7. Test POST /api/tasks/{task_id}/prs/sync_repo
        sync_res = await client.post(f"/api/tasks/{task_id}/prs/sync_repo")
        assert sync_res.status_code == 200
        sync_data = sync_res.json()
        assert sync_data["ok"] is True
        assert "count" in sync_data

        # 8. Test scoped and author filtering on GET /api/tasks/{task_id}/prs
        session_scoped_res = await client.get(f"/api/tasks/{task_id}/prs?scope=session")
        assert session_scoped_res.status_code == 200
        session_prs = session_scoped_res.json()
        assert any(p["pr_number"] == 42 and p["is_session_scoped"] is True for p in session_prs)

        author_filter_res = await client.get(f"/api/tasks/{task_id}/prs?author=octocat")
        assert author_filter_res.status_code == 200
        author_prs = author_filter_res.json()
        assert all("octocat" in p["author"].lower() for p in author_prs)

        # 9. Test GET and POST PR comments
        post_comment_res = await client.post(f"/api/tasks/{task_id}/prs/42/comments", json={
            "body": "Automated code review: verified thread safety."
        })
        assert post_comment_res.status_code == 200
        post_comment_data = post_comment_res.json()
        assert post_comment_data["ok"] is True
        assert post_comment_data["pr_number"] == 42

        get_comments_res = await client.get(f"/api/tasks/{task_id}/prs/42/comments")
        assert get_comments_res.status_code == 200
        comments_data = get_comments_res.json()
        assert "comments" in comments_data
        assert "count" in comments_data


@pytest.mark.asyncio
async def test_task_sandbox_resources_diagnostics():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create a task
        create_res = await client.post("/api/tasks", json={
            "title": "Resource Inspection Test",
            "description": "Checking sandbox CPU, disk, limits, and confinement",
            "persona": "IssueResolver"
        })
        assert create_res.status_code == 200
        task_id = create_res.json()["task_id"]

        # Call /api/tasks/{task_id}/sandbox
        sb_res = await client.get(f"/api/tasks/{task_id}/sandbox")
        assert sb_res.status_code == 200
        sb_data = sb_res.json()

        assert "resources" in sb_data
        res = sb_data["resources"]
        assert "cpu" in res
        assert res["cpu"]["allocation_mode"] == "shared_dynamic"
        assert res["cpu"]["logical_cores"] >= 1
        assert "CFS" in res["cpu"]["scheduler"]

        assert "disk" in res
        assert "partition_total_bytes" in res["disk"]
        assert "partition_free_bytes" in res["disk"]

        assert "limits" in res
        assert res["limits"]["command_timeout_seconds"] == 60
        assert res["limits"]["git_clone_timeout_seconds"] == 300
        assert res["limits"]["archive_download_timeout_seconds"] == 45

        assert "confinement" in res
        assert res["confinement"]["path_jail_enforced"] is True


@pytest.mark.asyncio
async def test_task_stop_and_cancel_endpoints():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create a task
        create_res = await client.post("/api/tasks", json={
            "title": "Stop Task Test Session",
            "description": "Task to be stopped via API",
            "persona": "SoftwareEngineer"
        })
        assert create_res.status_code == 200
        task_id = create_res.json()["task_id"]

        # 1. Call POST /api/tasks/{task_id}/stop
        stop_res = await client.post(f"/api/tasks/{task_id}/stop")
        assert stop_res.status_code == 200
        stop_data = stop_res.json()
        assert stop_data["ok"] is True
        assert stop_data["status"] == "CANCELLED"

        # Verify task detail reflects CANCELLED status
        detail_res = await client.get(f"/api/tasks/{task_id}")
        assert detail_res.status_code == 200
        assert detail_res.json()["status"] == "CANCELLED"

        # 2. Call POST /api/tasks/{task_id}/cancel (idempotent stop)
        cancel_res = await client.post(f"/api/tasks/{task_id}/cancel")
        assert cancel_res.status_code == 200
        assert cancel_res.json()["ok"] is True




