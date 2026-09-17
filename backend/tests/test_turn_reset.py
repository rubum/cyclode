import os
import uuid
import pytest
import subprocess
from pathlib import Path
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.agent.harness import ensure_workspace_git_repo, create_turn_snapshot, rollback_workspace_to_commit
from app.agent.pool import agent_pool
from app.db.session import async_session_factory
from app.db.models import TaskModel, TaskMessageModel, TaskLogModel, TaskDiffModel
from sqlalchemy import select


def test_workspace_git_snapshot_and_rollback(tmp_path):
    workspace = tmp_path / "test_workspace"
    workspace.mkdir()

    # 1. Initialize git repo
    ensure_workspace_git_repo(workspace)
    assert (workspace / ".git").exists()

    # 2. Turn 1: Create initial files
    (workspace / "index.html").write_text("<h1>Version 1</h1>")
    sha1 = create_turn_snapshot(workspace, 1)
    assert sha1 is not None

    # 3. Turn 2: Modify index.html and add styles.css
    (workspace / "index.html").write_text("<h1>Version 2</h1>")
    (workspace / "styles.css").write_text("body { background: #000; }")
    sha2 = create_turn_snapshot(workspace, 2)
    assert sha2 is not None

    # 4. Corrupt state / uncommitted changes
    (workspace / "index.html").write_text("<h1>Broken State</h1>")
    (workspace / "junk.tmp").write_text("temporary file")

    # 5. Rollback to Turn 1
    rolled_back = rollback_workspace_to_commit(workspace, sha1)
    assert rolled_back is True
    assert (workspace / "index.html").read_text() == "<h1>Version 1</h1>"
    assert not (workspace / "styles.css").exists()
    assert not (workspace / "junk.tmp").exists()

    # 6. Rollback to Turn 2
    rolled_back2 = rollback_workspace_to_commit(workspace, sha2)
    assert rolled_back2 is True
    assert (workspace / "index.html").read_text() == "<h1>Version 2</h1>"
    assert (workspace / "styles.css").exists()


@pytest.mark.asyncio
async def test_agent_pool_reset_task_turn(tmp_path):
    workspace = tmp_path / "pool_workspace"
    workspace.mkdir()
    ensure_workspace_git_repo(workspace)

    (workspace / "app.js").write_text("// turn 1")
    sha1 = create_turn_snapshot(workspace, 1)

    (workspace / "app.js").write_text("// turn 2 modified")
    sha2 = create_turn_snapshot(workspace, 2)

    now = datetime.now(timezone.utc)
    task_id = f"test-reset-task-{uuid.uuid4().hex[:8]}"

    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Test Reset Task",
            description="Testing reset turn mechanism",
            persona="AppBuilder",
            status="RUNNING",
            workspace_path=str(workspace),
            plan={
                "objective": "Build app",
                "steps": [
                    {"id": "step-1", "title": "Scaffold", "status": "completed"},
                    {"id": "step-2", "title": "Build UI", "status": "completed"},
                ],
                "evaluation": {"status": "accomplished", "summary": "Done"}
            }
        )
        session.add(task)

        # Add messages with staggered timestamps
        msg1 = TaskMessageModel(
            id=f"msg-1-{uuid.uuid4().hex[:6]}",
            task_id=task_id,
            sender="user",
            content="Create app",
            created_at=now - timedelta(minutes=10)
        )
        msg2 = TaskMessageModel(
            id=f"msg-2-{uuid.uuid4().hex[:6]}",
            task_id=task_id,
            sender="agent",
            content="Created scaffold",
            created_at=now - timedelta(minutes=5)
        )
        msg3 = TaskMessageModel(
            id=f"msg-3-{uuid.uuid4().hex[:6]}",
            task_id=task_id,
            sender="agent",
            content="Completed UI",
            created_at=now
        )
        session.add_all([msg1, msg2, msg3])

        log1 = TaskLogModel(
            id=f"log-1-{uuid.uuid4().hex[:6]}",
            task_id=task_id,
            tool_name="edit_file",
            tool_input="{}",
            created_at=now - timedelta(minutes=5)
        )
        log2 = TaskLogModel(
            id=f"log-2-{uuid.uuid4().hex[:6]}",
            task_id=task_id,
            tool_name="edit_file",
            tool_input="{}",
            created_at=now
        )
        session.add_all([log1, log2])

        diff1 = TaskDiffModel(
            id=f"diff-1-{uuid.uuid4().hex[:6]}",
            task_id=task_id,
            file_path="app.js",
            diff_content="+ // turn 1",
            created_at=now - timedelta(minutes=5)
        )
        diff2 = TaskDiffModel(
            id=f"diff-2-{uuid.uuid4().hex[:6]}",
            task_id=task_id,
            file_path="app.js",
            diff_content="+ // turn 2 modified",
            created_at=now
        )
        session.add_all([diff1, diff2])

        await session.commit()

    # Perform turn reset to turn 1
    res = await agent_pool.reset_task_turn(task_id, turn_index=1)
    assert res["ok"] is True
    assert res["status"] == "PAUSED"

    # Verify workspace file rolled back
    assert (workspace / "app.js").read_text() == "// turn 1"

    # Verify database records pruned and plan restored
    async with async_session_factory() as session:
        stmt_t = select(TaskModel).where(TaskModel.id == task_id)
        res_t = await session.execute(stmt_t)
        updated_task = res_t.scalars().first()
        assert updated_task.status == "PAUSED"
        assert updated_task.plan["steps"][0]["status"] in ["in_progress", "completed"]
        assert updated_task.plan["evaluation"]["status"] == "in_progress"

        stmt_m = select(TaskMessageModel).where(TaskMessageModel.task_id == task_id)
        res_m = await session.execute(stmt_m)
        remaining_msgs = res_m.scalars().all()
        # Most recent message was pruned
        assert len(remaining_msgs) < 3


@pytest.mark.asyncio
async def test_reset_turn_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create a task
        create_res = await client.post("/api/tasks", json={
            "title": f"Turn Reset Endpoint Task {uuid.uuid4().hex[:6]}",
            "description": "API Test for reset-turn",
            "persona": "IssueResolver",
        })
        assert create_res.status_code == 200
        task_id = create_res.json()["task_id"]

        # Call reset-turn endpoint
        reset_res = await client.post(f"/api/tasks/{task_id}/reset-turn", json={
            "turn_index": 1
        })
        assert reset_res.status_code == 200
        body = reset_res.json()
        assert body["ok"] is True
        assert body["task_id"] == task_id
        assert body["status"] == "PAUSED"
