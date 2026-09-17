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
            persona="SoftwareEngineer",
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
            persona="SoftwareEngineer",
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
            persona="SoftwareEngineer",
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
            persona="SoftwareEngineer",
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
            persona="SoftwareEngineer",
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
            persona="SoftwareEngineer",
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
            persona="SoftwareEngineer",
            model_name="gemini-2.5-pro",
            status="RUNNING",
            workspace_path=str(temp_workspace),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get(f"/api/tasks/{task_id}/preview/nonexistent.html")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_preview_html_telemetry_injection(temp_workspace: Path):
    (temp_workspace / "index.html").write_text(
        "<!DOCTYPE html><html><head><title>Telemetry Test</title></head><body><h1>Live Preview</h1></body></html>",
        encoding="utf-8"
    )

    task_id = f"test-diag-{uuid.uuid4()}"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Telemetry Injection Test",
            description="Testing script injection",
            persona="AppBuilder",
            model_name="gemini-2.5-flash",
            status="RUNNING",
            workspace_path=str(temp_workspace),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get(f"/api/tasks/{task_id}/preview/index.html")
        assert resp.status_code == 200
        html = resp.text
        assert "cyclode-preview-telemetry" in html
        assert f'<base href="/api/tasks/{task_id}/preview/">' in html
        assert "cyclode-preview-console" in html


@pytest.mark.asyncio
async def test_preview_diagnostic_fallback_on_missing_index(temp_workspace: Path):
    # Create raw React/TSX source without built index.html
    src_dir = temp_workspace / "src"
    src_dir.mkdir(parents=True, exist_ok=True)
    (src_dir / "App.tsx").write_text("export default function App() { return <div>Hello</div>; }", encoding="utf-8")
    (temp_workspace / "package.json").write_text('{"name": "raw-react-app"}', encoding="utf-8")

    task_id = f"test-diag-{uuid.uuid4()}"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Build React App",
            description="Raw React source",
            persona="AppBuilder",
            model_name="gemini-2.5-flash",
            status="RUNNING",
            workspace_path=str(temp_workspace),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Requesting index.html should return diagnostic page with 200 status
        resp = await ac.get(f"/api/tasks/{task_id}/preview/index.html")
        assert resp.status_code == 200
        html = resp.text
        assert "Cyclode App Preview Diagnostics" in html
        assert "React / Vite / TSX" in html
        assert "App.tsx" in html

        # Inspect diagnostics endpoint
        diag_resp = await ac.get(f"/api/tasks/{task_id}/preview/diagnostics")
        assert diag_resp.status_code == 200
        data = diag_resp.json()
        assert data["workspace_exists"] is True
        assert "React" in data["framework"]
        assert data["files_count"] >= 2


@pytest.mark.asyncio
async def test_inquiry_respond_api_and_resolution():
    from app.db.models import TaskApprovalModel
    task_id = f"test-inquiry-{uuid.uuid4()}"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Inquiry Test Session",
            description="Testing interactive inquiries",
            persona="AppBuilder",
            model_name="gemini-2.5-flash",
            status="AWAITING_INPUT",
        )
        session.add(task)

        approval = TaskApprovalModel(
            task_id=task_id,
            action_type="user_inquiry",
            action_details={
                "question": "Which theme do you prefer?",
                "options": [
                    {"id": "opt_dark", "label": "Dark OneDark Theme"},
                    {"id": "opt_light", "label": "Clean Light Theme"}
                ],
                "default_option_id": "opt_dark",
                "timeout_seconds": 30
            },
            status="PENDING"
        )
        session.add(approval)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.post(
            f"/api/tasks/{task_id}/inquiry/respond",
            json={"selected_option_id": "opt_light", "custom_response": "I prefer Light Theme"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["status"] == "RESOLVED"

    # Verify DB status updated to APPROVED
    async with async_session_factory() as session:
        from sqlalchemy import select
        res = await session.execute(
            select(TaskApprovalModel).where(TaskApprovalModel.task_id == task_id)
        )
        app_record = res.scalars().first()
        assert app_record is not None
        assert app_record.status == "APPROVED"


@pytest.mark.asyncio
async def test_verify_workspace_preview_needs_build(temp_workspace: Path):
    from app.api.preview import verify_workspace_preview
    # Scaffold an unbuilt Vite app in client/
    client_dir = temp_workspace / "client"
    client_dir.mkdir(parents=True, exist_ok=True)
    (client_dir / "package.json").write_text('{"name": "client", "scripts": {"build": "vite build"}}', encoding="utf-8")
    (client_dir / "index.html").write_text(
        '<!DOCTYPE html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
        encoding="utf-8"
    )

    res = verify_workspace_preview(temp_workspace, "test-task-1")
    assert res["has_preview"] is True
    assert res["status"] == "needs_build"
    assert res["build_status"] == "needs_build"
    assert "uncompiled development template" in res["issues"][0].lower()


@pytest.mark.asyncio
async def test_verify_workspace_preview_ready_with_dist(temp_workspace: Path):
    from app.api.preview import verify_workspace_preview
    # Create built client/dist/index.html
    dist_dir = temp_workspace / "client" / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    (dist_dir / "index.html").write_text(
        '<!DOCTYPE html><html><head><title>Built Social App</title></head><body><div id="root"></div><script src="/assets/index.js"></script></body></html>',
        encoding="utf-8"
    )

    res = verify_workspace_preview(temp_workspace, "test-task-2")
    assert res["has_preview"] is True
    assert res["status"] == "ready"
    assert res["build_status"] == "compiled"
    assert res["entry_point"] == "client/dist/index.html"
    assert res["title"] == "Built Social App"


@pytest.mark.asyncio
async def test_preview_smart_bundle_redirection_and_base(temp_workspace: Path):
    # Both client/index.html and client/dist/index.html exist
    client_dir = temp_workspace / "client"
    dist_dir = client_dir / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    (client_dir / "index.html").write_text('<html><body>Raw Template</body></html>', encoding="utf-8")
    (dist_dir / "index.html").write_text('<!DOCTYPE html><html><head><title>Prod App</title></head><body><script src="/assets/main.js"></script><h1>Prod Build</h1></body></html>', encoding="utf-8")

    task_id = f"test-bundle-{uuid.uuid4()}"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Smart Bundle Test",
            description="Testing smart bundle resolution",
            persona="AppBuilder",
            model_name="gemini-2.5-flash",
            status="RUNNING",
            workspace_path=str(temp_workspace),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Requesting client/index.html should serve the compiled bundle from client/dist/index.html
        resp = await ac.get(f"/api/tasks/{task_id}/preview/client/index.html")
        assert resp.status_code == 200
        assert "Prod Build" in resp.text
        # Base href must be correctly nested to client/dist/
        assert f'<base href="/api/tasks/{task_id}/preview/client/dist/">' in resp.text
        # /assets/main.js must be rewritten to ./assets/main.js
        assert 'src="./assets/main.js"' in resp.text


@pytest.mark.asyncio
async def test_verify_workspace_preview_detects_uncompiled_css(temp_workspace: Path):
    from app.api.preview import verify_workspace_preview
    dist_dir = temp_workspace / "dist"
    assets_dir = dist_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    
    (dist_dir / "index.html").write_text(
        '<!DOCTYPE html><html><head><link rel="stylesheet" href="./assets/index.css"></head><body><h1>Broken CSS</h1></body></html>',
        encoding="utf-8"
    )
    # Write uncompiled @tailwind directive into CSS asset
    (assets_dir / "index.css").write_text(
        '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
        encoding="utf-8"
    )

    res = verify_workspace_preview(temp_workspace, "test-uncompiled-css")
    assert res["status"] == "uncompiled_css"
    assert res["build_status"] == "uncompiled_css"
    assert any("uncompiled" in issue.lower() for issue in res["issues"])


@pytest.mark.asyncio
async def test_verify_workspace_preview_detects_stale_build(temp_workspace: Path):
    import time
    from app.api.preview import verify_workspace_preview

    dist_dir = temp_workspace / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    dist_file = dist_dir / "index.html"
    dist_file.write_text("<!DOCTYPE html><html><body><h1>Old Build</h1></body></html>", encoding="utf-8")

    src_dir = temp_workspace / "src"
    src_dir.mkdir(parents=True, exist_ok=True)
    src_file = src_dir / "App.tsx"
    src_file.write_text("export const App = () => <div>Updated Theme</div>;", encoding="utf-8")

    # Set dist_file mtime to 100 seconds ago, and src_file mtime to now
    now = time.time()
    os.utime(dist_file, (now - 100, now - 100))
    os.utime(src_file, (now, now))

    res = verify_workspace_preview(temp_workspace, "test-stale-task")
    assert res["is_stale"] is True
    assert res["status"] == "needs_rebuild"
    assert res["build_status"] == "stale"
    assert res["build_timestamp"] is not None


@pytest.mark.asyncio
async def test_verify_workspace_preview_fresh_build(temp_workspace: Path):
    import time
    from app.api.preview import verify_workspace_preview

    src_dir = temp_workspace / "src"
    src_dir.mkdir(parents=True, exist_ok=True)
    src_file = src_dir / "App.tsx"
    src_file.write_text("export const App = () => <div>App</div>;", encoding="utf-8")

    dist_dir = temp_workspace / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    dist_file = dist_dir / "index.html"
    dist_file.write_text("<!DOCTYPE html><html><body><h1>Fresh Build</h1></body></html>", encoding="utf-8")

    # Set src_file mtime to 100 seconds ago, and dist_file mtime to now
    now = time.time()
    os.utime(src_file, (now - 100, now - 100))
    os.utime(dist_file, (now, now))

    res = verify_workspace_preview(temp_workspace, "test-fresh-task")
    assert res["is_stale"] is False
    assert res["status"] == "ready"
    assert res["build_status"] == "compiled"
    assert res["build_timestamp"] is not None


@pytest.mark.asyncio
async def test_inspect_preview_exposes_stale_and_build_timestamp(temp_workspace: Path):
    import time
    dist_dir = temp_workspace / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    (dist_dir / "index.html").write_text("<!DOCTYPE html><html><body><h1>App</h1></body></html>", encoding="utf-8")

    task_id = f"test-stale-api-{uuid.uuid4()}"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Inspect Metadata Test",
            description="Testing is_stale and build_timestamp",
            persona="AppBuilder",
            model_name="gemini-2.5-flash",
            status="RUNNING",
            workspace_path=str(temp_workspace),
        )
        session.add(task)
        await session.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get(f"/api/tasks/{task_id}/preview/inspect")
        assert resp.status_code == 200
        data = resp.json()
        assert "is_stale" in data
        assert "build_timestamp" in data
        assert data["is_stale"] is False
        assert data["build_timestamp"] is not None


@pytest.mark.asyncio
async def test_verify_workspace_preview_detects_unlinked_assets(temp_workspace: Path):
    from app.api.preview import verify_workspace_preview

    css_dir = temp_workspace / "css"
    js_dir = temp_workspace / "js"
    css_dir.mkdir(parents=True, exist_ok=True)
    js_dir.mkdir(parents=True, exist_ok=True)

    (css_dir / "styles.css").write_text("body { background: #000; }", encoding="utf-8")
    (js_dir / "app.js").write_text("const { createApp } = Vue; createApp({}).mount('#app');", encoding="utf-8")

    res = verify_workspace_preview(temp_workspace, "test-unlinked")
    assert res["status"] == "unlinked_assets"
    assert res["has_preview"] is False
    assert "CSS and JavaScript assets exist" in res["issues"][0]


@pytest.mark.asyncio
async def test_verify_workspace_preview_detects_empty_ui(temp_workspace: Path):
    from app.api.preview import verify_workspace_preview

    css_dir = temp_workspace / "css"
    css_dir.mkdir(parents=True, exist_ok=True)
    (css_dir / "styles.css").write_text("body { background: #000; }", encoding="utf-8")

    (temp_workspace / "index.html").write_text("""<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="./css/styles.css" />
</head>
<body>
  <div id="app"></div>
  <script src="./js/audio.js"></script>
  <script src="./js/engine.js"></script>
</body>
</html>""", encoding="utf-8")

    js_dir = temp_workspace / "js"
    js_dir.mkdir(parents=True, exist_ok=True)
    (js_dir / "audio.js").write_text("class AudioFX { constructor() {} }", encoding="utf-8")
    (js_dir / "engine.js").write_text("class MathEngine { constructor() {} }", encoding="utf-8")

    res = verify_workspace_preview(temp_workspace, "test-empty-ui")
    assert res["status"] == "empty_ui"
    assert res["has_preview"] is True
    assert any("empty container (<div id=\"app\">)" in iss for iss in res["issues"])


