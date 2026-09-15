import os
import uuid
import shutil
import tempfile
from pathlib import Path
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel


@pytest.fixture
def temp_workspace():
    tmp_dir = tempfile.mkdtemp(prefix="cyclode_preview_test_")
    yield Path(tmp_dir)
    shutil.rmtree(tmp_dir, ignore_errors=True)


@pytest.mark.asyncio
async def test_preview_inspect_static_app(temp_workspace: Path):
    (temp_workspace / "index.html").write_text(
        "<!DOCTYPE html><html><head><title>My Awesome Dashboard</title></head><body><h1>Hello World</h1></body></html>",
        encoding="utf-8"
    )
    (temp_workspace / "styles.css").write_text("body { background: #1e1e1e; }", encoding="utf-8")
    (temp_workspace / "app.js").write_text("console.log('App ready');", encoding="utf-8")

    task_id = f"test-preview-{uuid.uuid4()}"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Build Dashboard App",
            description="Testing workspace preview inspection",
            persona="PairProgrammer",
            model_name="gemini-2.5-pro",
            status="RUNNING",
            workspace_path=str(temp_workspace),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get(f"/api/tasks/{task_id}/preview/inspect")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_preview"] is True
        assert data["type"] == "static"
        assert data["entry_point"] == "index.html"
        assert data["title"] == "My Awesome Dashboard"
        assert data["assets_count"] == 3
        assert "index.html" in data["available_entry_points"]
        assert data["preview_url"] == f"/api/tasks/{task_id}/preview/index.html"


@pytest.mark.asyncio
async def test_preview_inspect_nested_public_index(temp_workspace: Path):
    public_dir = temp_workspace / "public"
    public_dir.mkdir(parents=True, exist_ok=True)
    (public_dir / "index.html").write_text(
        "<!DOCTYPE html><html><head><title>SPA React App</title></head><body><div id='root'></div></body></html>",
        encoding="utf-8"
    )
    (public_dir / "logo.svg").write_text("<svg></svg>", encoding="utf-8")

    task_id = f"test-preview-{uuid.uuid4()}"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Create SPA",
            description="Nested index.html test",
            persona="PairProgrammer",
            model_name="gemini-2.5-pro",
            status="RUNNING",
            workspace_path=str(temp_workspace),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get(f"/api/tasks/{task_id}/preview/inspect")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_preview"] is True
        assert data["entry_point"] == "public/index.html"
        assert data["title"] == "SPA React App"
        assert data["assets_count"] == 2


@pytest.mark.asyncio
async def test_preview_inspect_dev_server_package_json(temp_workspace: Path):
    (temp_workspace / "package.json").write_text(
        '{"name": "vite-next-project", "scripts": {"dev": "vite"}}',
        encoding="utf-8"
    )

    task_id = f"test-preview-{uuid.uuid4()}"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Next App Task",
            description="Dev server package.json test",
            persona="PairProgrammer",
            model_name="gemini-2.5-pro",
            status="RUNNING",
            workspace_path=str(temp_workspace),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get(f"/api/tasks/{task_id}/preview/inspect")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_preview"] is True
        assert data["type"] == "dev_server"
        assert data["entry_point"] == "package.json"


@pytest.mark.asyncio
async def test_preview_inspect_empty_workspace(temp_workspace: Path):
    task_id = f"test-preview-{uuid.uuid4()}"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Empty Task",
            description="No files",
            persona="PairProgrammer",
            model_name="gemini-2.5-pro",
            status="RUNNING",
            workspace_path=str(temp_workspace),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get(f"/api/tasks/{task_id}/preview/inspect")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_preview"] is False
        assert data["entry_point"] is None


@pytest.mark.asyncio
async def test_preview_serve_static_files(temp_workspace: Path):
    (temp_workspace / "index.html").write_text("<!DOCTYPE html><html><body><h1>App</h1></body></html>", encoding="utf-8")
    (temp_workspace / "style.css").write_text("h1 { color: red; }", encoding="utf-8")
    (temp_workspace / "script.js").write_text("console.log('test');", encoding="utf-8")
    (temp_workspace / "data.json").write_text('{"key": "value"}', encoding="utf-8")

    task_id = f"test-preview-{uuid.uuid4()}"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Serve Test Task",
            description="Testing file server",
            persona="PairProgrammer",
            model_name="gemini-2.5-pro",
            status="RUNNING",
            workspace_path=str(temp_workspace),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp_html = await ac.get(f"/api/tasks/{task_id}/preview/index.html")
        assert resp_html.status_code == 200
        assert "text/html" in resp_html.headers.get("content-type", "")
        assert resp_html.headers.get("x-frame-options") == "SAMEORIGIN"
        assert "<h1>App</h1>" in resp_html.text

        resp_css = await ac.get(f"/api/tasks/{task_id}/preview/style.css")
        assert resp_css.status_code == 200
        assert "text/css" in resp_css.headers.get("content-type", "")
        assert "color: red" in resp_css.text

        resp_js = await ac.get(f"/api/tasks/{task_id}/preview/script.js")
        assert resp_js.status_code == 200
        assert "javascript" in resp_js.headers.get("content-type", "")
        assert "console.log" in resp_js.text

        resp_json = await ac.get(f"/api/tasks/{task_id}/preview/data.json")
        assert resp_json.status_code == 200
        assert "json" in resp_json.headers.get("content-type", "")
        assert resp_json.json() == {"key": "value"}


@pytest.mark.asyncio
async def test_preview_path_traversal_blocked(temp_workspace: Path):
    task_id = f"test-preview-{uuid.uuid4()}"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Security Test Task",
            description="Testing directory traversal rejection",
            persona="PairProgrammer",
            model_name="gemini-2.5-pro",
            status="RUNNING",
            workspace_path=str(temp_workspace),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get(f"/api/tasks/{task_id}/preview/../../../../etc/passwd")
        assert resp.status_code in (403, 404)


@pytest.mark.asyncio
async def test_preview_missing_file_returns_404(temp_workspace: Path):
    task_id = f"test-preview-{uuid.uuid4()}"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Missing File Test Task",
            description="Testing 404 on missing file",
            persona="PairProgrammer",
            model_name="gemini-2.5-pro",
            status="RUNNING",
            workspace_path=str(temp_workspace),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get(f"/api/tasks/{task_id}/preview/nonexistent.html")
        assert resp.status_code == 404
