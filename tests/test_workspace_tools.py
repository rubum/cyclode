import pytest
import tempfile
from pathlib import Path
from app.agent.tools import WorkspaceTools


@pytest.fixture
def temp_workspace():
    with tempfile.TemporaryDirectory() as tmpdir:
        w_path = Path(tmpdir)

        # Create sample Python file
        py_file = w_path / "server.py"
        py_file.write_text("""
from fastapi import FastAPI, Depends

app = FastAPI()

class DatabaseConfig:
    host: str = "localhost"
    port: int = 5432

@app.get("/api/health")
async def health_check():
    \"\"\"Check server health.\"\"\"
    return {"status": "ok"}

@app.post("/api/users")
def create_user(name: str):
    \"\"\"Create a new user.\"\"\"
    return {"id": 1, "name": name}

def internal_helper(val: int) -> int:
    return val * 2
""", encoding="utf-8")

        # Create sample TypeScript file
        ts_file = w_path / "client.ts"
        ts_file.write_text("""
export interface UserPayload {
    name: string;
}

export async function fetchHealth(endpoint: string) {
    return fetch(endpoint);
}

export const HeaderComponent: React.FC = () => {
    return null;
};
""", encoding="utf-8")

        yield w_path


def test_search_code_literal(temp_workspace):
    res = WorkspaceTools.search_code(temp_workspace, "health_check")
    assert res["total_matches"] >= 1
    assert any("server.py" in m["file_path"] for m in res["matches"])
    assert any(m["line_number"] == 11 for m in res["matches"])


def test_search_code_regex(temp_workspace):
    res = WorkspaceTools.search_code(temp_workspace, r"def\s+[a-z_]+", is_regex=True)
    assert res["total_matches"] >= 3
    assert any("health_check" in m["line_content"] for m in res["matches"])


def test_search_code_file_filter(temp_workspace):
    res_py = WorkspaceTools.search_code(temp_workspace, "fetch", file_pattern="*.py")
    assert res_py["total_matches"] == 0

    res_ts = WorkspaceTools.search_code(temp_workspace, "fetch", file_pattern="*.ts")
    assert res_ts["total_matches"] >= 1


def test_find_symbols_python(temp_workspace):
    res = WorkspaceTools.find_symbols(temp_workspace)
    symbols = res["symbols"]
    assert len(symbols) >= 4

    names = {s["name"]: s for s in symbols}
    assert "DatabaseConfig" in names
    assert names["DatabaseConfig"]["type"] == "class"

    assert "health_check" in names
    assert names["health_check"]["type"] == "endpoint"
    assert any("app.get" in d and "/api/health" in d for d in names["health_check"]["decorators"])

    assert "internal_helper" in names
    assert names["internal_helper"]["type"] == "function"


def test_find_symbols_typescript(temp_workspace):
    res = WorkspaceTools.find_symbols(temp_workspace, file_pattern="*.ts")
    symbols = res["symbols"]
    assert len(symbols) >= 3

    names = {s["name"]: s for s in symbols}
    assert "UserPayload" in names
    assert names["UserPayload"]["type"] == "interface"

    assert "fetchHealth" in names
    assert names["fetchHealth"]["type"] == "function"


def test_find_symbols_caching(temp_workspace):
    # First call builds cache
    res1 = WorkspaceTools.find_symbols(temp_workspace)
    cache_file = temp_workspace / ".cyclode_symbols_cache.json"
    assert cache_file.exists()

    # Second call reads cache
    res2 = WorkspaceTools.find_symbols(temp_workspace)
    assert res1["total_found"] == res2["total_found"]


def test_tgrep_ast_decorator(temp_workspace):
    res = WorkspaceTools.tgrep_ast(temp_workspace, "@app.get")
    assert res["total_matches"] >= 1
    assert any(m["symbol"] == "health_check" for m in res["matches"])


def test_tgrep_ast_class(temp_workspace):
    res = WorkspaceTools.tgrep_ast(temp_workspace, "DatabaseConfig")
    assert res["total_matches"] >= 1
    assert res["matches"][0]["type"] == "class"


@pytest.mark.asyncio
async def test_github_pr_tools(monkeypatch):
    monkeypatch.setenv("GITHUB_MOCK_TEST_MODE", "1")
    # 1. Test get_pull_request_details
    details = await WorkspaceTools.get_pull_request_details("confident-ai/deepeval", 101)
    assert details["repository"] == "confident-ai/deepeval"
    assert details["number"] == 101
    assert "title" in details
    assert "head_branch" in details

    # 2. Test get_pull_request_diff
    diff_res = await WorkspaceTools.get_pull_request_diff("confident-ai/deepeval", 101)
    assert diff_res["repository"] == "confident-ai/deepeval"
    assert diff_res["number"] == 101
    assert "diff" in diff_res
    assert len(diff_res["diff"]) > 0

    # 3. Test list_pull_requests
    list_res = await WorkspaceTools.list_pull_requests("confident-ai/deepeval", state="open")
    assert list_res["repository"] == "confident-ai/deepeval"
    assert list_res["total_found"] >= 1
    assert len(list_res["pull_requests"]) >= 1

    # 4. Test post_pull_request_review
    review_res = await WorkspaceTools.post_pull_request_review(
        "confident-ai/deepeval", 101, body="Looks good to merge!", event="APPROVE"
    )
    assert review_res["ok"] is True

    # 5. Test post_pull_request_line_comment
    comment_res = await WorkspaceTools.post_pull_request_line_comment(
        "confident-ai/deepeval", 101, body="Verify null safety here", commit_sha="a1b2c3d4", path="server.py", line=25
    )
    assert comment_res["ok"] is True


def test_compact_command_output():
    from app.agent.tools import compact_command_output
    
    # Short output remains unchanged
    short_out = "Running tests...\nAll 5 passed!"
    assert compact_command_output(short_out) == short_out
    
    # Long output with > 50 lines gets middle-elided
    long_lines = [f"Step {i}: executing subtask" for i in range(100)]
    long_out = "\n".join(long_lines)
    compacted = compact_command_output(long_out)
    assert "Omitted 50 lines of intermediate command logs" in compacted
    assert "Step 0:" in compacted
    assert "Step 99:" in compacted
    
    # ANSI escape codes are stripped
    ansi_text = "\x1b[32mSuccess\x1b[0m: compilation complete"
    assert compact_command_output(ansi_text) == "Success: compilation complete"


def test_read_file_slicing_and_lockfile_guard(temp_workspace):
    # Test line slicing
    res = WorkspaceTools.read_file(temp_workspace, "server.py", start_line=10, end_line=13)
    assert "health_check" in res["content"]
    assert "10: @app.get" in res["content"]
    assert res["start_line"] == 10
    assert res["end_line"] == 13
    
    # Test lockfile guard
    lockfile = temp_workspace / "package-lock.json"
    lockfile.write_text("{\n" + '  "packages": {}\n' * 200 + "}", encoding="utf-8")
    lock_res = WorkspaceTools.read_file(temp_workspace, "package-lock.json")
    assert lock_res.get("truncated") is True
    assert "generated lockfile or bundle" in lock_res["content"]


def test_replace_file_content(temp_workspace):
    file_path = "server.py"
    target = 'class DatabaseConfig:\n    host: str = "localhost"\n    port: int = 5432'
    replacement = 'class DatabaseConfig:\n    host: str = "postgres.internal"\n    port: int = 5432\n    ssl: bool = True'
    
    res = WorkspaceTools.replace_file_content(
        workspace_path=temp_workspace,
        file_path=file_path,
        target_content=target,
        replacement_content=replacement
    )
    assert res["status"] == "replaced"
    assert res["replacements_count"] == 1
    
    content = (temp_workspace / file_path).read_text(encoding="utf-8")
    assert 'host: str = "postgres.internal"' in content
    assert 'ssl: bool = True' in content


def test_get_file_outline(temp_workspace):
    # Python outline
    py_res = WorkspaceTools.get_file_outline(temp_workspace, "server.py")
    assert py_res["symbol_count"] >= 3
    assert "Outline for server.py" in py_res["outline"]
    assert "DatabaseConfig" in py_res["outline"]
    assert "health_check" in py_res["outline"]
    
    # TypeScript outline
    ts_res = WorkspaceTools.get_file_outline(temp_workspace, "client.ts")
    assert ts_res["symbol_count"] >= 3
    assert "UserPayload" in ts_res["outline"]
    assert "fetchHealth" in ts_res["outline"]

