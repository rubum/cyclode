import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel, KnowledgeEntryModel


@pytest.mark.asyncio
async def test_memory_api_crud_and_voting():
    task_id = "test-task-api-mem"
    async with async_session_factory() as session:
        task = TaskModel(id=task_id, title="API Memory Task")
        session.add(task)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. POST /api/memories (create)
        create_res = await ac.post(
            "/api/memories",
            json={
                "source_task_id": task_id,
                "source_turn_index": 1,
                "category": "architecture_rule",
                "trigger_pattern": "FASTAPI_CONCURRENT_BROADCAST",
                "insight": "Always broadcast WebSocket events concurrently with asyncio.gather",
                "context_files": ["websocket.py"],
                "status": "PROMOTED"
            }
        )
        assert create_res.status_code == 200
        data = create_res.json()
        assert data["trigger_pattern"] == "FASTAPI_CONCURRENT_BROADCAST"
        memory_id = data["id"]

        # 2. GET /api/memories/task/{task_id}
        task_res = await ac.get(f"/api/memories/task/{task_id}")
        assert task_res.status_code == 200
        task_mems = task_res.json()
        assert len(task_mems) >= 1
        assert any(m["id"] == memory_id for m in task_mems)

        # 3. GET /api/memories?query=WebSocket
        search_res = await ac.get("/api/memories?query=WebSocket")
        assert search_res.status_code == 200
        search_data = search_res.json()
        assert search_data["total"] >= 1

        # 4. POST /api/memories/{memory_id}/vote (+0.5)
        vote_res = await ac.post(f"/api/memories/{memory_id}/vote", json={"delta": 0.5})
        assert vote_res.status_code == 200
        assert vote_res.json()["utility_score"] == 1.5

        # 5. DELETE /api/memories/{memory_id}
        del_res = await ac.delete(f"/api/memories/{memory_id}")
        assert del_res.status_code == 200
        assert del_res.json()["ok"] is True
