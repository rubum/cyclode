import pytest
import shutil
from pathlib import Path
from unittest.mock import patch

from app.core.search import SearchBridge
from app.agent.tools import WorkspaceTools


@pytest.fixture
def sample_workspace(tmp_path: Path) -> Path:
    """Creates a realistic multi-language workspace for testing SearchBridge."""
    # Python file
    py_file = tmp_path / "main.py"
    py_file.write_text(
        "from fastapi import FastAPI\n\n"
        "app = FastAPI()\n\n"
        "@app.get('/health')\n"
        "async def health_check():\n"
        "    return {'status': 'healthy'}\n\n"
        "class MetricsCollector:\n"
        "    def collect(self):\n"
        "        return 42\n",
        encoding="utf-8"
    )

    # Rust file
    rs_file = tmp_path / "engine.rs"
    rs_file.write_text(
        "pub struct EngineConfig {\n"
        "    pub threads: usize,\n"
        "}\n\n"
        "pub fn start_engine(config: EngineConfig) {\n"
        "    println!(\"Engine started\");\n"
        "}\n",
        encoding="utf-8"
    )

    # Secondary Python file for prioritization testing
    sub_dir = tmp_path / "sub"
    sub_dir.mkdir(parents=True, exist_ok=True)
    sub_file = sub_dir / "worker.py"
    sub_file.write_text(
        "async def health_check():\n"
        "    return 'worker_ok'\n",
        encoding="utf-8"
    )

    return tmp_path


def test_tier1_rust_search_text(sample_workspace: Path):
    """Verifies Tier 1 Native Rust full-text search when cyclode-searchd is present."""
    rust_bin = SearchBridge._get_rust_binary()
    assert rust_bin is not None and rust_bin.exists(), "cyclode-searchd release binary should exist"

    res = SearchBridge.search_text(
        sample_workspace,
        query="health_check",
        is_regex=False,
        case_sensitive=False,
        max_results=10
    )

    assert res.get("engine") == "rust_native"
    assert res.get("total_matches") == 2
    paths = [m["file_path"] for m in res.get("matches", [])]
    assert "main.py" in paths
    assert any("worker.py" in p for p in paths)


def test_tier1_rust_search_ast(sample_workspace: Path):
    """Verifies Tier 1 Native Rust Tree-sitter AST symbol search."""
    res = SearchBridge.search_ast(
        sample_workspace,
        pattern="MetricsCollector",
        max_results=10
    )

    assert res.get("engine") == "rust_native"
    assert res.get("total_matches") >= 1
    match = res["matches"][0]
    assert match["symbol"] == "MetricsCollector"
    assert match["type"] == "class"
    assert "main.py" in match["file_path"]


def test_tier1_current_file_prioritization(sample_workspace: Path):
    """Verifies that active current_file matches are pinned at the top (index 0)."""
    res = SearchBridge.search_text(
        sample_workspace,
        query="health_check",
        current_file="sub/worker.py",
        max_results=10
    )

    assert res.get("total_matches") == 2
    matches = res.get("matches", [])
    assert len(matches) == 2
    # First match MUST be sub/worker.py
    assert "sub/worker.py" in matches[0]["file_path"]
    assert "main.py" in matches[1]["file_path"]


def test_tier2_ripgrep_fallback(sample_workspace: Path):
    """Verifies fallback to Tier 2 (ripgrep) when Rust binary is unavailable."""
    with patch.object(SearchBridge, "_get_rust_binary", return_value=None):
        res = SearchBridge.search_text(
            sample_workspace,
            query="start_engine",
            max_results=10
        )

        if shutil.which("rg"):
            assert res.get("engine") == "ripgrep"
            assert res.get("total_matches") == 1
            assert "engine.rs" in res["matches"][0]["file_path"]
        else:
            assert res.get("engine") == "python_fallback"
            assert res.get("total_matches") == 1


def test_tier3_pure_python_fallback(sample_workspace: Path):
    """Verifies resilient fallback to Tier 3 (pure Python) when both Rust and ripgrep are unavailable."""
    with patch.object(SearchBridge, "_get_rust_binary", return_value=None), \
         patch("shutil.which", return_value=None):

        res_text = SearchBridge.search_text(
            sample_workspace,
            query="EngineConfig",
            max_results=10,
            current_file="engine.rs"
        )
        assert res_text.get("engine") == "python_fallback"
        assert res_text.get("total_matches") >= 1
        assert "engine.rs" in res_text["matches"][0]["file_path"]

        res_ast = SearchBridge.search_ast(
            sample_workspace,
            pattern="MetricsCollector",
            max_results=10
        )
        assert res_ast.get("engine") == "python_fallback"
        assert res_ast.get("total_matches") >= 1


def test_workspace_tools_delegation(sample_workspace: Path):
    """Verifies that WorkspaceTools.search_code and WorkspaceTools.tgrep_ast delegate seamlessly."""
    res_code = WorkspaceTools.search_code(
        sample_workspace,
        query="health_check",
        max_results=10
    )
    assert "matches" in res_code
    assert res_code.get("total_matches") == 2

    res_ast = WorkspaceTools.tgrep_ast(
        sample_workspace,
        pattern="MetricsCollector",
        max_results=10
    )
    assert "matches" in res_ast
    assert res_ast.get("total_matches") >= 1


def test_empty_query_error_handling(sample_workspace: Path):
    """Verifies clean error responses for empty or whitespace-only queries."""
    res = SearchBridge.search_text(sample_workspace, query="   ")
    assert "error" in res
    assert res["matches"] == []

    res_ast = SearchBridge.search_ast(sample_workspace, pattern="")
    assert "error" in res_ast
    assert res_ast["matches"] == []
