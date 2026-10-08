import pytest
import zipfile
import tarfile
import json
from io import BytesIO
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel
from app.agent.tools import WorkspaceTools


@pytest.mark.asyncio
async def test_file_upload_endpoint(tmp_path):
    # Setup test workspace
    workspace = tmp_path / "sandbox-task-upload-test"
    workspace.mkdir(parents=True, exist_ok=True)

    task_id = "task-upload-test"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            session_key="test-key",
            title="Upload Endpoint Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Upload files into workspace root
        csv_bytes = b"id,val\n1,100\n2,200\n"
        py_bytes = b"def hello():\n    return 'world'\n"
        files = [
            ("files", ("metrics.csv", csv_bytes, "text/csv")),
            ("files", ("script.py", py_bytes, "text/x-python")),
        ]
        data = {"target_type": "workspace"}
        res = await client.post(f"/api/tasks/{task_id}/files/upload", files=files, data=data)
        assert res.status_code == 200
        res_json = res.json()
        assert res_json["count"] == 2
        assert len(res_json["uploaded"]) == 2
        assert (workspace / "metrics.csv").exists()
        assert (workspace / "script.py").exists()
        assert (workspace / "metrics.csv").read_bytes() == csv_bytes

        # 1b. Upload nested folder structure
        header_bytes = b"export const Header = () => <h1>Header</h1>;"
        utils_bytes = b"export const add = (a, b) => a + b;"
        folder_files = [
            ("files", ("src/components/Header.tsx", header_bytes, "text/plain")),
            ("files", ("src/utils/math.ts", utils_bytes, "text/plain")),
        ]
        res_folder = await client.post(f"/api/tasks/{task_id}/files/upload", files=folder_files, data=data)
        assert res_folder.status_code == 200
        assert (workspace / "src" / "components" / "Header.tsx").exists()
        assert (workspace / "src" / "utils" / "math.ts").exists()
        assert (workspace / "src" / "components" / "Header.tsx").read_bytes() == header_bytes

        # 2. Upload file to attachment directory
        json_bytes = b'{"status": "ok"}'
        files_att = [("files", ("response.json", json_bytes, "application/json"))]
        data_att = {"target_type": "attachment"}
        res_att = await client.post(f"/api/tasks/{task_id}/files/upload", files=files_att, data=data_att)
        assert res_att.status_code == 200
        att_json = res_att.json()
        assert att_json["count"] == 1
        assert (workspace / ".cyclode" / "attachments" / "response.json").exists()

        # 3. Path traversal security checks
        traversal_files = [("files", ("../../evil.sh", b"echo evil", "text/plain"))]
        res_trav = await client.post(f"/api/tasks/{task_id}/files/upload", files=traversal_files, data=data)
        assert res_trav.status_code == 200
        # Should sanitize filename to 'evil.sh' inside workspace root
        assert not (tmp_path / "evil.sh").exists()
        assert (workspace / "evil.sh").exists()


@pytest.mark.asyncio
async def test_query_table_endpoint_and_sql(tmp_path):
    workspace = tmp_path / "sandbox-task-table-test"
    workspace.mkdir(parents=True, exist_ok=True)

    task_id = "task-table-test"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            session_key="test-key",
            title="Table Endpoint Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    # Create CSV dataset
    csv_content = "name,department,salary\nAlice,Engineering,120000\nBob,Design,95000\nCharlie,Engineering,140000\nDiana,Marketing,85000\n"
    csv_file = workspace / "employees.csv"
    csv_file.write_text(csv_content, encoding="utf-8")

    # Create JSONL dataset
    jsonl_content = '{"user": "alice", "score": 98}\n{"user": "bob", "score": 85}\n{"user": "charlie", "score": 92}\n'
    jsonl_file = workspace / "scores.jsonl"
    jsonl_file.write_text(jsonl_content, encoding="utf-8")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Basic table query & column stats
        res = await client.post(
            f"/api/tasks/{task_id}/files/query-table",
            json={"path": "employees.csv", "page": 1, "page_size": 10}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["headers"] == ["name", "department", "salary"]
        assert data["total_rows"] == 4
        assert len(data["rows"]) == 4
        assert "salary" in data["summary_stats"]
        assert data["summary_stats"]["salary"]["type"] == "number"
        assert data["summary_stats"]["salary"]["min"] == 85000.0
        assert data["summary_stats"]["salary"]["max"] == 140000.0

        # 2. SQL query execution on data_table
        sql_req = {
            "path": "employees.csv",
            "sql_query": "SELECT name, salary FROM data_table WHERE department = 'Engineering' ORDER BY CAST(salary AS INT) DESC",
            "page": 1,
            "page_size": 10
        }
        res_sql = await client.post(f"/api/tasks/{task_id}/files/query-table", json=sql_req)
        assert res_sql.status_code == 200
        sql_data = res_sql.json()
        assert sql_data["is_sql_result"] is True
        assert sql_data["headers"] == ["name", "salary"]
        assert len(sql_data["rows"]) == 2
        assert sql_data["rows"][0] == ["Charlie", "140000"]
        assert sql_data["rows"][1] == ["Alice", "120000"]

        # 3. JSONL query
        res_jsonl = await client.post(
            f"/api/tasks/{task_id}/files/query-table",
            json={"path": "scores.jsonl", "page": 1, "page_size": 10}
        )
        assert res_jsonl.status_code == 200
        jsonl_data = res_jsonl.json()
        assert jsonl_data["headers"] == ["user", "score"]
        assert jsonl_data["total_rows"] == 3


@pytest.mark.asyncio
async def test_archive_inspect_endpoint(tmp_path):
    workspace = tmp_path / "sandbox-task-archive-test"
    workspace.mkdir(parents=True, exist_ok=True)

    task_id = "task-archive-test"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            session_key="test-key",
            title="Archive Endpoint Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    # 1. Create a sample zip archive
    zip_path = workspace / "bundle.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("src/main.py", "print('hello from archive')\n")
        zf.writestr("src/utils.py", "def add(a, b): return a + b\n")
        zf.writestr("README.md", "# Archive Test\n")

    # 2. Create a sample tar.gz archive
    tar_path = workspace / "archive.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tf:
        info1 = tarfile.TarInfo("app/server.py")
        content1 = b"import socket\n"
        info1.size = len(content1)
        tf.addfile(info1, BytesIO(content1))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Inspect zip
        res_zip = await client.get(f"/api/tasks/{task_id}/files/archive-inspect?path=bundle.zip")
        assert res_zip.status_code == 200
        zip_data = res_zip.json()
        assert zip_data["format"] == "zip"
        assert zip_data["total_files"] == 3
        paths = [e["path"] for e in zip_data["entries"]]
        assert "src/main.py" in paths
        assert "README.md" in paths

        # Traversal protection
        res_trav = await client.get(f"/api/tasks/{task_id}/files/archive-inspect?path=../../etc/passwd.zip")
        assert res_trav.status_code in (403, 404)


def test_workspace_tools_tabular_and_archive(tmp_path):
    # Test WorkspaceTools.query_table()
    csv_file = tmp_path / "data.csv"
    csv_file.write_text("item,price,quantity\nApple,1.5,10\nBanana,0.75,20\nCherry,3.0,5\n", encoding="utf-8")

    res = WorkspaceTools.query_table(tmp_path, "data.csv")
    assert "error" not in res
    assert res["headers"] == ["item", "price", "quantity"]
    assert res["total_rows"] == 3
    assert res["summary_stats"]["price"]["min"] == 0.75

    # Test SQL execution via WorkspaceTools
    sql_res = WorkspaceTools.query_table(
        tmp_path,
        "data.csv",
        sql_query="SELECT item, price FROM data_table WHERE CAST(price AS REAL) > 1.0 ORDER BY item ASC"
    )
    assert "error" not in sql_res
    assert sql_res["is_sql_result"] is True
    assert sql_res["rows"] == [["Apple", "1.5"], ["Cherry", "3.0"]]

    # Test WorkspaceTools.inspect_archive()
    zip_file = tmp_path / "pkg.zip"
    with zipfile.ZipFile(zip_file, "w") as zf:
        zf.writestr("module/index.js", "console.log('hi');")
        zf.writestr("package.json", '{"name": "pkg"}')

    arch_res = WorkspaceTools.inspect_archive(tmp_path, "pkg.zip")
    assert "error" not in arch_res
    assert arch_res["format"] == "zip"
    assert arch_res["total_files"] == 2
    entry_names = [e["name"] for e in arch_res["entries"]]
    assert "index.js" in entry_names or "module/index.js" in [e["path"] for e in arch_res["entries"]]


@pytest.mark.asyncio
async def test_workspace_tools_view_image(tmp_path):
    from PIL import Image

    # 1. Create a synthetic test PNG image
    img_path = tmp_path / "test_screenshot.png"
    img = Image.new("RGB", (120, 80), color=(73, 109, 137))
    img.save(img_path, format="PNG")

    res = await WorkspaceTools.view_image(tmp_path, "test_screenshot.png")
    assert "error" not in res
    assert res["name"] == "test_screenshot.png"
    assert res["mime_type"] == "image/png"
    assert res["format"] == "PNG"
    assert res["dimensions"] == "120x80 px"
    assert "visual_analysis" in res

    # 2. Test SVG image inspection
    svg_path = tmp_path / "diagram.svg"
    svg_path.write_text('<svg width="100" height="100"><circle cx="50" cy="50" r="40" stroke="green" /></svg>', encoding="utf-8")

    svg_res = await WorkspaceTools.view_image(tmp_path, "diagram.svg")
    assert "error" not in svg_res
    assert svg_res["mime_type"] == "image/svg+xml"
    assert "svg_preview" in svg_res

    # 3. Test attachment fallback in .cyclode/attachments/
    att_dir = tmp_path / ".cyclode" / "attachments"
    att_dir.mkdir(parents=True, exist_ok=True)
    att_img = att_dir / "uploaded_ui.png"
    img.save(att_img, format="PNG")

    att_res = await WorkspaceTools.view_image(tmp_path, "uploaded_ui.png")
    assert "error" not in att_res
    assert att_res["name"] == "uploaded_ui.png"

    # 4. Nonexistent file test
    err_res = await WorkspaceTools.view_image(tmp_path, "nonexistent.png")
    assert "error" in err_res


def test_attachment_fallback_across_tools(tmp_path):
    att_dir = tmp_path / ".cyclode" / "attachments"
    att_dir.mkdir(parents=True, exist_ok=True)

    # 1. Test read_file attachment fallback
    (att_dir / "notes.txt").write_text("Attachment content notes", encoding="utf-8")
    read_res = WorkspaceTools.read_file(tmp_path, "notes.txt")
    assert "error" not in read_res
    assert "Attachment content notes" in read_res["content"]

    # 2. Test query_table attachment fallback
    (att_dir / "data.csv").write_text("item,qty\napple,10\nbanana,20\n", encoding="utf-8")
    table_res = WorkspaceTools.query_table(tmp_path, "data.csv")
    assert "error" not in table_res
    assert table_res["headers"] == ["item", "qty"]
    assert len(table_res["rows"]) == 2

    # 3. Test inspect_archive attachment fallback
    zip_bytes = BytesIO()
    with zipfile.ZipFile(zip_bytes, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("test.txt", "inside zip")
    (att_dir / "archive.zip").write_bytes(zip_bytes.getvalue())

    arch_res = WorkspaceTools.inspect_archive(tmp_path, "archive.zip")
    assert "error" not in arch_res
    assert arch_res["format"] == "zip"
    assert arch_res["total_files"] == 1


@pytest.mark.asyncio
async def test_query_table_excel_spreadsheet_and_attachment_fallback(tmp_path):
    workspace = tmp_path / "sandbox-task-excel-test"
    att_dir = workspace / ".cyclode" / "attachments"
    att_dir.mkdir(parents=True, exist_ok=True)

    task_id = "task-excel-test"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            session_key="excel-key",
            title="Excel Table Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    # Create dummy xlsx
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>""")
        z.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>""")
        z.writestr("xl/workbook.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets><sheet name="Sheet1" sheetId="1" id="rId1"/></sheets>
</workbook>""")
        z.writestr("xl/sharedStrings.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
  <si><t>Item</t></si>
  <si><t>Qty</t></si>
  <si><t>Widget A</t></si>
  <si><t>Gadget B</t></si>
</sst>""")
        z.writestr("xl/worksheets/sheet1.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2"><v>15</v></c>
    </row>
    <row r="3">
      <c r="A3" t="s"><v>3</v></c>
      <c r="B3"><v>45</v></c>
    </row>
  </sheetData>
</worksheet>""")

    excel_file = att_dir / "inventory.xlsx"
    excel_file.write_bytes(buf.getvalue())

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Query by relative attachment path
        res1 = await client.post(
            f"/api/tasks/{task_id}/files/query-table",
            json={"path": ".cyclode/attachments/inventory.xlsx", "page": 1, "page_size": 10}
        )
        assert res1.status_code == 200
        data1 = res1.json()
        assert data1["headers"] == ["Item", "Qty"]
        assert data1["total_rows"] == 2
        assert len(data1["rows"]) == 2

        # 2. Query by basename with fallback resolution
        res2 = await client.post(
            f"/api/tasks/{task_id}/files/query-table",
            json={"path": "inventory.xlsx", "page": 1, "page_size": 10}
        )
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["headers"] == ["Item", "Qty"]
        assert data2["total_rows"] == 2

        # 3. SQL query on Excel data table
        res_sql = await client.post(
            f"/api/tasks/{task_id}/files/query-table",
            json={
                "path": "inventory.xlsx",
                "sql_query": "SELECT Item FROM data_table WHERE CAST(Qty AS INT) > 20",
                "page": 1,
                "page_size": 10
            }
        )
        assert res_sql.status_code == 200
        sql_data = res_sql.json()
        assert sql_data["headers"] == ["Item"]
        assert len(sql_data["rows"]) == 1
        assert sql_data["rows"][0] == ["Gadget B"]


@pytest.mark.asyncio
async def test_notebook_complete_retrieval_without_truncation(tmp_path):
    workspace = tmp_path / "sandbox-task-notebook-test"
    workspace.mkdir(parents=True, exist_ok=True)

    task_id = "task-notebook-test"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            session_key="test-key-nb",
            title="Notebook File Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    # Generate a realistic Jupyter notebook with > 1200 lines
    cells = []
    for i in range(150):
        cells.append({
            "cell_type": "code",
            "execution_count": i + 1,
            "metadata": {},
            "source": [
                f"# Cell {i + 1}\n",
                f"import math\n",
                f"val_{i} = math.sqrt({i} * 42)\n",
                f"print(f'Computed {i}: {{val_{i}}}')\n"
            ],
            "outputs": [
                {
                    "output_type": "stream",
                    "name": "stdout",
                    "text": [f"Computed {i}: {i * 6.48:.2f}\n"]
                }
            ]
        })

    notebook_data = {
        "cells": cells,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3 (ipykernel)",
                "language": "python",
                "name": "python3"
            },
            "language_info": {
                "name": "python",
                "version": "3.11.0"
            }
        },
        "nbformat": 4,
        "nbformat_minor": 5
    }

    nb_text = json.dumps(notebook_data, indent=2)
    assert len(nb_text.splitlines()) > 1000

    nb_file = workspace / "analysis_pipeline.ipynb"
    nb_file.write_text(nb_text, encoding="utf-8")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get(f"/api/tasks/{task_id}/files/content?path=analysis_pipeline.ipynb")
        assert res.status_code == 200
        data = res.json()

        # Should NOT be truncated despite having > 1000 lines
        assert data["is_truncated"] is False
        assert data["lines"] > 1000
        assert data["language"] == "jupyter"

        # Content must parse cleanly as valid JSON without 'Unexpected end of JSON'
        parsed = json.loads(data["content"])
        assert len(parsed["cells"]) == 150
        assert parsed["cells"][0]["source"][0] == "# Cell 1\n"


@pytest.mark.asyncio
async def test_docx_inspect_and_save_endpoints(tmp_path):
    workspace = tmp_path / "sandbox-task-docx-test"
    workspace.mkdir(parents=True, exist_ok=True)

    task_id = "task-docx-test"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            session_key="test-key-docx",
            title="DOCX Inspection and Save Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    docx_path = workspace / "report.docx"
    initial_html = (
        "<h1>Q3 Financial Report</h1>"
        "<p>This document summarizes our <strong>Q3 revenue</strong> and performance metrics.</p>"
        "<h2>Highlights</h2>"
        "<ul>"
        "<li>Revenue exceeded forecast by 15%</li>"
        "<li>Customer retention reached 94%</li>"
        "</ul>"
        "<table>"
        "<tr><td>Metric</td><td>Value</td></tr>"
        "<tr><td>ARR</td><td>$12.5M</td></tr>"
        "</table>"
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Save new DOCX file
        save_payload = {"path": "report.docx", "html": initial_html}
        save_res = await client.post(f"/api/tasks/{task_id}/files/docx-save", json=save_payload)
        assert save_res.status_code == 200
        save_data = save_res.json()
        assert save_data["ok"] is True
        assert docx_path.exists()
        assert save_data["paragraphs_count"] >= 3
        assert save_data["words_count"] > 10

        # 2. Inspect saved DOCX file
        inspect_res = await client.get(f"/api/tasks/{task_id}/files/docx-inspect?path=report.docx")
        assert inspect_res.status_code == 200
        inspect_data = inspect_res.json()
        assert len(inspect_data["headings"]) >= 2
        assert inspect_data["headings"][0]["text"] == "Q3 Financial Report"
        assert inspect_data["headings"][0]["level"] == 1
        assert "Q3 Financial Report" in inspect_data["text"]
        assert "Revenue exceeded forecast by 15%" in inspect_data["text"]
        assert inspect_data["tables_count"] >= 1

        # 3. Verify get_sandbox_file_content endpoint returns DOCX metadata
        content_res = await client.get(f"/api/tasks/{task_id}/files/content?path=report.docx")
        assert content_res.status_code == 200
        content_data = content_res.json()
        assert content_data["language"] == "docx"
        assert content_data["is_binary"] is False
        assert "Q3 Financial Report" in content_data["content"]
        assert "docx_metadata" in content_data
        assert content_data["docx_metadata"]["words_count"] > 10

        # 4. Modify document and save again
        updated_html = "<h1>Q4 Revised Strategy</h1><p>New updated <strong>growth plan</strong>.</p>"
        update_res = await client.post(f"/api/tasks/{task_id}/files/docx-save", json={"path": "report.docx", "html": updated_html})
        assert update_res.status_code == 200
        reinspect = await client.get(f"/api/tasks/{task_id}/files/docx-inspect?path=report.docx")
        assert "Q4 Revised Strategy" in reinspect.json()["text"]


@pytest.mark.asyncio
async def test_docx_agent_read_file_tool(tmp_path):
    workspace = tmp_path / "sandbox-task-docx-agent"
    workspace.mkdir(parents=True, exist_ok=True)

    task_id = "task-docx-agent"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            session_key="test-key-docx-agent",
            title="DOCX Agent Tool Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    from app.api.tasks import _save_docx_native
    docx_file = workspace / "spec.docx"
    _save_docx_native(docx_file, "<h1>Architecture Spec</h1><p>System uses <strong>PostgreSQL</strong> for storage.</p>")

    from app.agent.tools import WorkspaceTools
    read_res = WorkspaceTools.read_file(workspace, "spec.docx")
    assert "error" not in read_res
    assert read_res["is_binary"] is False
    assert "Architecture Spec" in read_res["content"]
    assert "PostgreSQL" in read_res["content"]


@pytest.mark.asyncio
async def test_multiturn_uploaded_files_persistence(tmp_path):
    """
    Verifies that uploaded files and folders persist across multi-turn session executions
    and are not wiped when subsequent turns or sandbox reattachments occur.
    """
    from app.core.sandboxes.overlay_provider import OverlayFSSandboxProvider

    provider = OverlayFSSandboxProvider(base_dir=str(tmp_path))
    task_id = "task-multiturn-upload-persist"
    workspace = tmp_path / f"sandbox-{task_id}"

    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            session_key="test-key-multiturn",
            title="MultiTurn Upload Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(workspace),
            git_branch="cyclode/task-test-branch"
        )
        session.add(task)
        await session.commit()

    # 1. Create initial sandbox
    ctx1 = await provider.create_sandbox(task_id=task_id)
    assert ctx1.workspace_path.exists()

    # 2. Upload a nested design folder with files
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        files = [
            ("files", ("Waylo Design/spec.docx", b"dummy docx bytes", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
            ("files", ("Waylo Design/mockup.png", b"\x89PNG\r\n\x1a\nfake", "image/png")),
            ("files", ("Waylo Design/notes.md", b"# Design Notes\nPersistent across turns.", "text/markdown"))
        ]
        res = await client.post(
            f"/api/tasks/{task_id}/files/upload",
            files=files,
            data={"target_type": "workspace", "destination_path": ""}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["count"] == 3

    # Verify files exist on disk
    spec_path = workspace / "Waylo Design" / "spec.docx"
    notes_path = workspace / "Waylo Design" / "notes.md"
    assert spec_path.exists()
    assert notes_path.exists()
    assert notes_path.read_text(encoding="utf-8") == "# Design Notes\nPersistent across turns."

    # 3. Simulate turn 2 execution: Clear in-memory cache to simulate worker completion / reload
    provider._active_sandboxes.clear()

    # 4. Re-provision sandbox for turn 2 (even if repo_url is passed or re-evaluated)
    ctx2 = await provider.create_sandbox(
        task_id=task_id,
        repo_name="waylo/platform",
        repo_url="https://github.com/waylo/platform"
    )

    # 5. Assert that the uploaded files were NOT deleted or overhauled
    assert ctx2.workspace_path.exists()
    assert spec_path.exists(), "Uploaded spec.docx was lost after turn 2 sandbox reattachment!"
    assert notes_path.exists(), "Uploaded notes.md was lost after turn 2 sandbox reattachment!"
    assert notes_path.read_text(encoding="utf-8") == "# Design Notes\nPersistent across turns."


@pytest.mark.asyncio
async def test_docx_numbering_and_hierarchical_lists(tmp_path):
    """
    Tests that word/numbering.xml lists (ordered decimal with custom start numbers
    and unordered sub-bullets) are parsed with correct HTML tags, start offsets,
    and preserved text markers.
    """
    import zipfile
    from app.api.tasks import _parse_docx_native, _save_docx_native

    doc_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="ListParagraph"/>
        <w:numPr>
          <w:ilvl w:val="0"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
      <w:r>
        <w:rPr><w:b/></w:rPr>
        <w:t>Indexed in Typesense.</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="ListParagraph"/>
        <w:numPr>
          <w:ilvl w:val="1"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
      <w:r>
        <w:t>Every saved or changed file is split by Waylo into passages.</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="ListParagraph"/>
        <w:numPr>
          <w:ilvl w:val="1"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
      <w:r>
        <w:t>Each passage is indexed with the tenant.</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="ListParagraph"/>
        <w:numPr>
          <w:ilvl w:val="0"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
      <w:r>
        <w:rPr><w:b/></w:rPr>
        <w:t>Treated as data, never as instructions.</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="ListParagraph"/>
        <w:numPr>
          <w:ilvl w:val="1"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
      <w:r>
        <w:t>Text in knowledge files is shown inside wrapper.</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="ListParagraph"/>
        <w:numPr>
          <w:ilvl w:val="0"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
      <w:r>
        <w:rPr><w:b/></w:rPr>
        <w:t>Limits and visibility.</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>
'''

    numbering_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:start w:val="4"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="-"/>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
</w:numbering>
'''

    test_docx = tmp_path / "typesense_spec.docx"
    with zipfile.ZipFile(test_docx, "w") as z:
        z.writestr("word/document.xml", doc_xml)
        z.writestr("word/numbering.xml", numbering_xml)

    parsed = _parse_docx_native(test_docx)

    # Verify HTML maintains ordered list with start="4"
    assert '<ol start="4">' in parsed["html"]
    assert "<strong>Indexed in Typesense.</strong>" in parsed["html"]
    # Verify sub-bullets are nested in <ul>
    assert "<ul>" in parsed["html"]
    assert "<li>Every saved or changed file is split by Waylo into passages.</li>" in parsed["html"]
    assert "<strong>Treated as data, never as instructions.</strong>" in parsed["html"]
    assert "<strong>Limits and visibility.</strong>" in parsed["html"]

    # Verify plain text contains the numbering and bullets
    assert "4. Indexed in Typesense." in parsed["text"]
    assert "- Every saved or changed file is split by Waylo into passages." in parsed["text"]
    assert "- Each passage is indexed with the tenant." in parsed["text"]
    assert "5. Treated as data, never as instructions." in parsed["text"]
    assert "- Text in knowledge files is shown inside wrapper." in parsed["text"]
    assert "6. Limits and visibility." in parsed["text"]


@pytest.mark.asyncio
async def test_view_image_deepseek_vision_cascade(tmp_path, monkeypatch):
    from PIL import Image
    from unittest.mock import AsyncMock, patch
    from app.config import settings
    from app.agent.providers.deepseek import DeepSeekProvider

    # 1. Create a synthetic test PNG image
    img_path = tmp_path / "ui_mockup.png"
    img = Image.new("RGB", (200, 100), color=(50, 150, 250))
    img.save(img_path, format="PNG")

    # 2. Simulate Gemini key absent, DeepSeek key present
    monkeypatch.setattr(settings, "GEMINI_API_KEY", None)
    monkeypatch.setattr(settings, "GOOGLE_API_KEY", None)
    monkeypatch.setattr(settings, "DEEPSEEK_API_KEY", "sk-mock-deepseek-key")

    mock_analysis = "DeepSeek-V4.1-Flash Visual Analysis: Responsive navbar with logo and [Deploy] action button."
    with patch.object(DeepSeekProvider, "analyze_visual", new_callable=AsyncMock) as mock_ds_vis:
        mock_ds_vis.return_value = mock_analysis

        res = await WorkspaceTools.view_image(tmp_path, "ui_mockup.png", prompt="Extract UI elements")
        assert "error" not in res
        assert res["name"] == "ui_mockup.png"
        assert res["visual_analysis"] == mock_analysis
        mock_ds_vis.assert_awaited_once()
