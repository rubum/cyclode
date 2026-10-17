import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel, KnowledgeEntryModel


@pytest.mark.asyncio
async def test_memory_api_crud_recall_graph_and_voting():
    task_id = "test-task-api-mem"
    async with async_session_factory() as session:
        task = TaskModel(id=task_id, title="API Memory Task")
        session.add(task)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. POST /api/memories (create with CortexDB inline entities/relations & slug)
        create_res = await ac.post(
            "/api/memories",
            json={
                "source_task_id": task_id,
                "source_turn_index": 1,
                "category": "architecture_rule",
                "trigger_pattern": "FASTAPI_CONCURRENT_BROADCAST",
                "insight": "Always broadcast WebSocket events concurrently with asyncio.gather in websocket.py",
                "context_files": ["websocket.py"],
                "status": "PROMOTED"
            }
        )
        assert create_res.status_code == 200
        data = create_res.json()
        assert data["trigger_pattern"] == "FASTAPI_CONCURRENT_BROADCAST"
        assert data["slug"] is not None
        assert "websocket.py" in data["entities"]
        assert len(data["relations"]) >= 1
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

        # 4. POST /api/memories/{memory_id}/vote (+0.5 -> promotes epistemic_grade to 'verified')
        vote_res = await ac.post(f"/api/memories/{memory_id}/vote", json={"delta": 0.5})
        assert vote_res.status_code == 200
        voted_json = vote_res.json()
        assert voted_json["utility_score"] == 1.5
        assert voted_json["epistemic_grade"] == "verified"

        # 5. POST /api/memories/recall (CortexDB 3-lane RRF + Context Pack)
        recall_res = await ac.post(
            "/api/memories/recall",
            json={
                "query": "How should WebSocket events be broadcast in websocket.py?",
                "target_files": ["websocket.py"],
                "limit": 5,
            }
        )
        assert recall_res.status_code == 200
        recall_data = recall_res.json()
        assert recall_data["plan"]["should_recall"] is True
        assert any(e["id"] == memory_id for e in recall_data["entries"])
        assert "[VERIFIED]" in recall_data["context_pack"]

        # 6. GET /api/memories/graph (CortexDB Knowledge Graph & Epistemic Contract Tally)
        graph_res = await ac.get(f"/api/memories/graph?task_id={task_id}")
        assert graph_res.status_code == 200
        graph_data = graph_res.json()
        assert graph_data["contract_tally"]["verified"] >= 1
        assert len(graph_data["nodes"]) >= 1
        assert len(graph_data["edges"]) >= 1

        # 7. DELETE /api/memories/{memory_id}
        del_res = await ac.delete(f"/api/memories/{memory_id}")
        assert del_res.status_code == 200
        assert del_res.json()["ok"] is True
