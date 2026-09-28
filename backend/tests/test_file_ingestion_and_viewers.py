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
