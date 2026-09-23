import pytest
import pytest_asyncio
import tempfile
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel


@pytest.mark.asyncio
async def test_get_sandbox_file_raw_image_and_text(tmp_path):
    # Setup mock workspace
    workspace = tmp_path / "sandbox-task-raw-test"
    workspace.mkdir(parents=True, exist_ok=True)

    # Create test image (dummy png bytes)
    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    image_file = workspace / "logo.png"
    image_file.write_bytes(png_bytes)

    # Create test SVG
    svg_content = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>'
    svg_file = workspace / "icon.svg"
    svg_file.write_text(svg_content, encoding="utf-8")

    # Create test CSV
    csv_content = "id,name,role\n1,Alice,Engineer\n2,Bob,Designer\n"
    csv_file = workspace / "data.csv"
    csv_file.write_text(csv_content, encoding="utf-8")

    # Insert Task record
    async with async_session_factory() as session:
        task = TaskModel(
            id="task-raw-test",
            session_key="test-key",
            title="Raw Endpoint Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Fetch PNG raw
        res_png = await client.get("/api/tasks/task-raw-test/files/raw?path=logo.png")
        assert res_png.status_code == 200
        assert "image/png" in res_png.headers.get("content-type", "")
        assert res_png.content == png_bytes

        # 2. Fetch SVG raw
        res_svg = await client.get("/api/tasks/task-raw-test/files/raw?path=icon.svg")
        assert res_svg.status_code == 200
        assert "image/svg+xml" in res_svg.headers.get("content-type", "")
        assert "<svg" in res_svg.text

        # 3. Fetch CSV raw
        res_csv = await client.get("/api/tasks/task-raw-test/files/raw?path=data.csv")
        assert res_csv.status_code == 200
        assert "text/csv" in res_csv.headers.get("content-type", "")
        assert "Alice" in res_csv.text

        # 4. Content endpoint includes raw_url
        res_content = await client.get("/api/tasks/task-raw-test/files/content?path=logo.png")
        assert res_content.status_code == 200
        content_json = res_content.json()
        assert content_json["is_binary"] is True
        assert "/api/tasks/task-raw-test/files/raw?path=logo.png" in content_json["raw_url"]

        # 5. Path traversal defense
        res_traversal = await client.get("/api/tasks/task-raw-test/files/raw?path=../../etc/passwd")
        assert res_traversal.status_code in (403, 404)

        # 6. Non-existent file
        res_404 = await client.get("/api/tasks/task-raw-test/files/raw?path=nonexistent.png")
        assert res_404.status_code == 404
