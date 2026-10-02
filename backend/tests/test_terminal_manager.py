import asyncio
import os
import shutil
import pytest
from pathlib import Path
import httpx

from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel
from app.core.sandboxes.terminal_manager import terminal_manager


@pytest.mark.asyncio
async def test_terminal_manager_spawn_write_read(tmp_path):
    workspace = tmp_path / "term_ws"
    workspace.mkdir()

    session = await terminal_manager.spawn_session(
        task_id="task-test-term-1",
        workspace_path=workspace,
        session_id="term-test-1",
        cols=80,
        rows=24,
    )

    assert session.session_id == "term-test-1"
    assert session.task_id == "task-test-term-1"
    assert session.is_alive is True
    assert session.process.pid > 0

    # Write simple echo command
    ok = await terminal_manager.write_input("term-test-1", "echo CYCLODE_TERMINAL_OK\n")
    assert ok is True

    # Allow non-blocking reader to consume output
    for _ in range(20):
        await asyncio.sleep(0.1)
        if "CYCLODE_TERMINAL_OK" in session.get_scrollback():
            break

    scrollback = session.get_scrollback()
    assert "CYCLODE_TERMINAL_OK" in scrollback

    # Test resize
    resized = terminal_manager.resize_session("term-test-1", 120, 40)
    assert resized is True
    assert session.cols == 120
    assert session.rows == 40

    # Test kill
    killed = await terminal_manager.kill_session("term-test-1")
    assert killed is True
    assert terminal_manager.get_session("term-test-1") is None


@pytest.mark.asyncio
async def test_terminal_manager_secret_redaction(tmp_path):
    workspace = tmp_path / "term_secret_ws"
    workspace.mkdir()

    # Set mock secrets in host environment
    os.environ["GEMINI_API_KEY"] = "secret-gemini-token"
    os.environ["DATABASE_URL"] = "postgresql://user:pass@localhost/db"
    os.environ["GITHUB_TOKEN"] = "ghp_secret123"

    session = await terminal_manager.spawn_session(
        task_id="task-test-term-secret",
        workspace_path=workspace,
        session_id="term-test-secret",
    )

    # Ask the shell to print environment variables
    await terminal_manager.write_input("term-test-secret", "echo GEMINI: $GEMINI_API_KEY, GH: $GITHUB_TOKEN, DB: $DATABASE_URL\n")

    for _ in range(20):
        await asyncio.sleep(0.1)
        if "GEMINI:" in session.get_scrollback():
            break

    output = session.get_scrollback()
    assert "secret-gemini-token" not in output
    assert "postgresql://" not in output
    assert "ghp_secret123" not in output

    await terminal_manager.kill_session("term-test-secret")


@pytest.mark.asyncio
async def test_terminal_api_endpoints(tmp_path):
    workspace = tmp_path / "api_term_ws"
    workspace.mkdir()

    # Create dummy task in database
    task_id = "task-term-api-test"
    async with async_session_factory() as db:
        t = TaskModel(
            id=task_id,
            title="Terminal API Test Task",
            workspace_path=str(workspace),
            status="RUNNING"
        )
        db.add(t)
        await db.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Spawn terminal session via POST
        res = await client.post(f"/api/tasks/{task_id}/terminals", json={"cols": 100, "rows": 30})
        assert res.status_code == 200
        data = res.json()
        session_id = data["session_id"]
        assert session_id is not None
        assert data["is_alive"] is True

        # 2. List sessions via GET
        list_res = await client.get(f"/api/tasks/{task_id}/terminals")
        assert list_res.status_code == 200
        sessions_list = list_res.json()
        assert any(s["session_id"] == session_id for s in sessions_list)

        # 3. Write input via POST
        input_res = await client.post(f"/api/tasks/{task_id}/terminals/{session_id}/input", json={"data": "echo API_TEST_SUCCESS\n"})
        assert input_res.status_code == 200
        assert input_res.json()["ok"] is True

        # Wait for output
        await asyncio.sleep(0.5)

        # 4. Fetch scrollback via GET
        sb_res = await client.get(f"/api/tasks/{task_id}/terminals/{session_id}/scrollback")
        assert sb_res.status_code == 200
        sb_data = sb_res.json()
        assert "API_TEST_SUCCESS" in sb_data["scrollback"]

        # 5. Resize terminal via POST
        resize_res = await client.post(f"/api/tasks/{task_id}/terminals/{session_id}/resize", json={"cols": 140, "rows": 45})
        assert resize_res.status_code == 200
        assert resize_res.json()["cols"] == 140

        # 6. Delete terminal session via DELETE
        del_res = await client.delete(f"/api/tasks/{task_id}/terminals/{session_id}")
        assert del_res.status_code == 200
        assert del_res.json()["ok"] is True

    await terminal_manager.cleanup_task_sessions(task_id)
