import pytest
import tempfile
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel, get_utc_now


@pytest.mark.asyncio
async def test_search_sandbox_files_endpoint():
    with tempfile.TemporaryDirectory() as tmpdir:
        ws_path = Path(tmpdir)
        (ws_path / "main.py").write_text("""
from fastapi import FastAPI

app = FastAPI()

@app.get("/api/users")
def get_users():
    return [{"id": 1, "name": "Alice"}]
""", encoding="utf-8")

        async with async_session_factory() as session:
            task = TaskModel(
                id="test-task-search-01",
                title="Test Search Task",
                persona="IssueResolver",
                workspace_path=str(ws_path),
                status="completed",
                created_at=get_utc_now()
            )
            session.add(task)
            await session.commit()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Text grep search
            res = await client.get("/api/tasks/test-task-search-01/files/search?query=get_users&mode=text")
            assert res.status_code == 200
            data = res.json()
            assert data["mode"] == "text"
            assert data["total_matches"] >= 1
            assert any(m["file_path"] == "main.py" for m in data["matches"])

            # 2. AST search for @app.get decorator
            res_ast = await client.get("/api/tasks/test-task-search-01/files/search?query=@app.get&mode=ast")
            assert res_ast.status_code == 200
            data_ast = res_ast.json()
            assert data_ast["mode"] == "ast"
            assert data_ast["total_matches"] >= 1
            assert any(m["symbol"] == "get_users" for m in data_ast["matches"])

            # 3. Non-existent task returns 404
            res_404 = await client.get("/api/tasks/non-existent-task-id/files/search?query=test")
            assert res_404.status_code == 404
