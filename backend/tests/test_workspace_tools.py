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

