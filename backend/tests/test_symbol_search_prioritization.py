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

        # Call search with current_file in text mode
        search_res = await client.get(
            f"/api/tasks/{task_id}/files/search?query=def&mode=text&current_file=test.py"
        )
        assert search_res.status_code == 200
        data = search_res.json()
        assert "matches" in data
        assert "total_matches" in data

        # Call search in ast mode
        ast_res = await client.get(
            f"/api/tasks/{task_id}/files/search?query=test&mode=ast&current_file=test.py"
        )
        assert ast_res.status_code == 200
        ast_data = ast_res.json()
        assert "matches" in ast_data
        assert "total_matches" in ast_data


def test_multi_language_symbol_extraction(tmp_path):
    ws = tmp_path / "polyglot_ws"
    ws.mkdir()

    # Elixir file
    ex_file = ws / "cluster.ex"
    ex_file.write_text(
        "defmodule Horde.Cluster do\n"
        "  def set_members(cluster, members) do\n"
        "    :ok\n"
        "  end\n"
        "  defp internal_sync() do\n"
        "    :ok\n"
        "  end\n"
        "end\n",
        encoding="utf-8"
    )

    # Go file
    go_file = ws / "server.go"
    go_file.write_text(
        "package main\n"
        "func StartServer(port int) error {\n"
        "  return nil\n"
        "}\n"
        "type Config struct {\n"
        "  Port int\n"
        "}\n",
        encoding="utf-8"
    )

    # Rust file
    rs_file = ws / "lib.rs"
    rs_file.write_text(
        "pub struct Engine;\n"
        "pub async fn init_engine() -> Engine {\n"
        "  Engine\n"
        "}\n",
        encoding="utf-8"
    )

    # 1. Test AST search on Elixir symbols
    elixir_res = WorkspaceTools.tgrep_ast(ws, "set_members", current_file="cluster.ex")
    assert elixir_res["total_matches"] >= 1
    assert elixir_res["matches"][0]["symbol"] == "set_members"
    assert elixir_res["matches"][0]["file_path"] == "cluster.ex"

    # 2. Test AST search on Go symbols
    go_res = WorkspaceTools.tgrep_ast(ws, "StartServer")
    assert go_res["total_matches"] >= 1
    assert go_res["matches"][0]["symbol"] == "StartServer"

    # 3. Test AST search on Rust symbols
    rs_res = WorkspaceTools.tgrep_ast(ws, "init_engine")
    assert rs_res["total_matches"] >= 1
    assert rs_res["matches"][0]["symbol"] == "init_engine"

    # 4. Test fallback on non-AST invocation term
    fallback_res = WorkspaceTools.tgrep_ast(ws, "internal_sync")
    assert fallback_res["total_matches"] >= 1
    assert fallback_res["matches"][0]["file_path"] == "cluster.ex"


def test_haskell_and_polyglot_symbol_extraction(tmp_path):
    ws = tmp_path / "polyglot_v2_ws"
    ws.mkdir()

    # 1. Haskell file
    hs_file = ws / "Main.hs"
    hs_file.write_text(
        "module Data.Engine.Core where\n\n"
        "data ServerState = Idle | Running Int\n\n"
        "class Summarizer a where\n"
        "  summarize :: a -> String\n\n"
        "computeScore :: Int -> Float -> Double\n"
        "computeScore count factor = fromIntegral count * realToFrac factor\n",
        encoding="utf-8"
    )

    # 2. C# file
    cs_file = ws / "Service.cs"
    cs_file.write_text(
        "namespace App.Core;\n"
        "public class PaymentProcessor {\n"
        "    public async Task<bool> ProcessPaymentAsync(decimal amount) {\n"
        "        return true;\n"
        "    }\n"
        "}\n",
        encoding="utf-8"
    )

    # 3. Swift file
    swift_file = ws / "Model.swift"
    swift_file.write_text(
        "public struct UserSession {\n"
        "    public func validateToken() -> Bool {\n"
        "        return true\n"
        "    }\n"
        "}\n",
        encoding="utf-8"
    )

    # 4. Dart file
    dart_file = ws / "widget.dart"
    dart_file.write_text(
        "class DashboardCard extends StatelessWidget {\n"
        "  Future<void> refreshState() async {\n"
        "  }\n"
        "}\n",
        encoding="utf-8"
    )

    # 5. Terraform / HCL file
    tf_file = ws / "main.tf"
    tf_file.write_text(
        'resource "aws_s3_bucket" "data_lake" {\n'
        '  bucket = "cyclode-data-lake"\n'
        '}\n'
        'module "vpc" {\n'
        '  source = "terraform-aws-modules/vpc/aws"\n'
        '}\n',
        encoding="utf-8"
    )

    # 6. Solidity file
    sol_file = ws / "Token.sol"
    sol_file.write_text(
        "contract LiquidityPool {\n"
        "    function swapTokens(uint256 amountIn) external returns (uint256) {}\n"
        "}\n",
        encoding="utf-8"
    )

    # 7. Zig file
    zig_file = ws / "math.zig"
    zig_file.write_text(
        "pub const Vector3 = struct {\n"
        "    x: f32,\n"
        "    y: f32,\n"
        "    z: f32,\n"
        "};\n"
        "pub fn dotProduct(a: Vector3, b: Vector3) f32 {\n"
        "    return a.x * b.x + a.y * b.y + a.z * b.z;\n"
        "}\n",
        encoding="utf-8"
    )

    # Extract all symbols via find_symbols
    sym_res = WorkspaceTools.find_symbols(ws, max_results=100)
    assert sym_res["total_found"] >= 10
    symbols = sym_res["symbols"]
    sym_names = [s["name"] for s in symbols]

    # Haskell assertions
    assert "Data.Engine.Core" in sym_names
    assert "ServerState" in sym_names
    assert "Summarizer" in sym_names
    assert "computeScore" in sym_names

    # C# assertions
    assert "PaymentProcessor" in sym_names
    assert "ProcessPaymentAsync" in sym_names

    # Swift assertions
    assert "UserSession" in sym_names
    assert "validateToken" in sym_names

    # Dart assertions
    assert "DashboardCard" in sym_names
    assert "refreshState" in sym_names

    # Terraform assertions
    assert "aws_s3_bucket.data_lake" in sym_names
    assert "vpc" in sym_names

    # Solidity assertions
    assert "LiquidityPool" in sym_names
    assert "swapTokens" in sym_names

    # Zig assertions
    assert "Vector3" in sym_names
    assert "dotProduct" in sym_names

    # Test get_file_outline on Haskell file
    outline = WorkspaceTools.get_file_outline(ws, "Main.hs")
    assert "symbols" in outline
    assert len(outline["symbols"]) >= 3


