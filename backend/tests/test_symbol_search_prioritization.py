import pytest
from pathlib import Path
from app.agent.tools import WorkspaceTools
from httpx import AsyncClient, ASGITransport
from app.main import app


@pytest.fixture
def search_workspace(tmp_path):
    ws = tmp_path / "test_ws"
    ws.mkdir()

    # File A (current file)
    file_a = ws / "active_module.py"
    file_a.write_text(
        "class ClusterManager:\n"
        "    def __init__(self):\n"
        "        self.cluster_nodes = []\n"
        "    def sync_cluster(self):\n"
        "        pass\n",
        encoding="utf-8"
    )

    # File B (secondary file)
    file_b = ws / "worker.py"
    file_b.write_text(
        "from active_module import ClusterManager\n"
        "def run_worker():\n"
        "    cm = ClusterManager()\n"
        "    cm.sync_cluster()\n",
        encoding="utf-8"
    )

    # File C (third file)
    file_c = ws / "config.py"
    file_c.write_text(
        "CLUSTER_DEFAULT_PORT = 4000\n",
        encoding="utf-8"
    )

    return ws


def test_search_code_current_file_prioritization(search_workspace):
    # Search without current_file
    res_no_curr = WorkspaceTools.search_code(search_workspace, "Cluster")
    assert res_no_curr["total_matches"] >= 4

    # Search with current_file="active_module.py"
    res_with_curr = WorkspaceTools.search_code(search_workspace, "Cluster", current_file="active_module.py")
    assert res_with_curr["total_matches"] >= 4
    matches = res_with_curr["matches"]
    
    # First matches MUST be from active_module.py
    assert matches[0]["file_path"] == "active_module.py"
    assert matches[1]["file_path"] == "active_module.py"


def test_tgrep_ast_current_file_prioritization(search_workspace):
    # AST search with current_file
    res = WorkspaceTools.tgrep_ast(search_workspace, "ClusterManager", current_file="active_module.py")
    assert res["total_matches"] >= 1
    assert res["matches"][0]["file_path"] == "active_module.py"
    assert res["matches"][0]["symbol"] == "ClusterManager"


@pytest.mark.asyncio
async def test_search_api_endpoint_with_current_file():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create a task
        create_res = await client.post("/api/tasks", json={
            "title": "Search API Test Session",
            "description": "Testing search prioritization",
            "persona": "SoftwareEngineer"
        })
        assert create_res.status_code == 200
        task_id = create_res.json()["task_id"]

        # Call search with current_file
        search_res = await client.get(
            f"/api/tasks/{task_id}/files/search?query=def&mode=text&current_file=test.py"
        )
        assert search_res.status_code == 200
        data = search_res.json()
        assert "matches" in data
        assert "total_matches" in data
