import pytest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
from pathlib import Path
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel, TaskMessageModel, TaskLogModel
from app.core.sandboxes.container.lifecycle import ContainerLifecycleManager
from app.core.sandboxes.container_provider import ContainerSandboxProvider
from app.core.sandboxes.manager import sandbox_manager


@pytest.mark.asyncio
async def test_container_lifecycle_bulk_destruction():
    mock_client = AsyncMock()
    mock_client.is_available.return_value = True
    mock_client.run_cli.return_value = (0, "", "")

    mgr = ContainerLifecycleManager(client=mock_client)
    task_ids = [f"task-bulk-{i}" for i in range(120)]
    success = await mgr.destroy_containers_bulk(task_ids)
    assert success is True
    # 120 containers in batches of 50 = 3 CLI calls
    assert mock_client.run_cli.call_count == 3


@pytest.mark.asyncio
async def test_container_lifecycle_prune_orphaned():
    mock_client = AsyncMock()
    mock_client.is_available.return_value = True
    # Return 3 containers: 1 active running, 1 orphaned running, 1 exited
    mock_client.run_cli.side_effect = [
        (0, "cyclode-sb-active-1 running\ncyclode-sb-orphan-1 running\ncyclode-sb-active-2 exited\n", ""),
        (0, "", "")
    ]

    mgr = ContainerLifecycleManager(client=mock_client)
    active_task_ids = {"active-1"}
    pruned_count = await mgr.prune_orphaned_containers(active_task_ids)
    # orphan-1 (not in active) and active-2 (exited) should be pruned
    assert pruned_count == 2
    assert mock_client.run_cli.call_count == 2


@pytest.mark.asyncio
async def test_fast_task_deletion_api(tmp_path):
    task_id = "task-fast-delete-test"
    workspace = tmp_path / f"sandbox-{task_id}"
    workspace.mkdir(parents=True, exist_ok=True)

    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            session_key="test-key-fast-delete",
            title="Fast Delete Test",
            persona="IssueResolver",
            status="COMPLETED",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    with patch.object(sandbox_manager, "bulk_destroy", new_callable=AsyncMock) as mock_bulk:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.delete(f"/api/tasks/{task_id}")
            assert res.status_code == 200
            data = res.json()
            assert data["ok"] is True
            assert data["deleted_task_id"] == task_id

            # Allow background fire-and-forget task to execute
            await asyncio.sleep(0.05)
            assert mock_bulk.call_count >= 1

    # Verify task is deleted in DB
    async with async_session_factory() as session:
        db_task = await session.get(TaskModel, task_id)
        assert db_task is None


@pytest.mark.asyncio
async def test_fast_clear_all_tasks_api(tmp_path):
    task_ids = ["task-clear-1", "task-clear-2", "task-clear-3"]
    async with async_session_factory() as session:
        for tid in task_ids:
            task = TaskModel(
                id=tid,
                session_key=f"test-key-{tid}",
                title=f"Clear Test {tid}",
                persona="IssueResolver",
                status="COMPLETED",
                workspace_path=str(tmp_path / f"sandbox-{tid}")
            )
            session.add(task)
        await session.commit()

    with patch.object(sandbox_manager, "bulk_destroy", new_callable=AsyncMock) as mock_bulk:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.delete("/api/tasks")
            assert res.status_code == 200
            data = res.json()
            assert data["ok"] is True

            await asyncio.sleep(0.05)
            assert mock_bulk.call_count >= 1


@pytest.mark.asyncio
async def test_sandbox_hygiene_and_prune_endpoints():
    with patch.object(sandbox_manager, "prune_orphans", new_callable=AsyncMock, return_value=5), \
         patch.object(sandbox_manager, "get_hygiene_summary", new_callable=AsyncMock, return_value={
             "available": True,
             "engine": "docker",
             "total_containers": 10,
             "running_containers": 5,
             "orphaned_containers": 5
         }):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Hygiene GET
            h_res = await client.get("/api/tasks/sandbox/hygiene")
            assert h_res.status_code == 200
            h_data = h_res.json()
            assert h_data["ok"] is True
            assert h_data["hygiene"]["orphaned_containers"] == 5

            # 2. Prune POST
            p_res = await client.post("/api/tasks/sandbox/prune")
            assert p_res.status_code == 200
            p_data = p_res.json()
            assert p_data["ok"] is True
            assert p_data["pruned_count"] == 5
