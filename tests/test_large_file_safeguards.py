import pytest
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from app.agent.tools import WorkspaceTools
from app.core.worktree import WorktreeManager
from app.api.tasks import get_sandbox_file_content, get_sandbox_folder_children
from app.db.models import TaskModel


def test_read_file_default_line_cap_and_truncation(tmp_path: Path):
    # Create 500-line test file
    lines = [f"line {i} with some content" for i in range(1, 501)]
    test_file = tmp_path / "large_text.txt"
    test_file.write_text("\n".join(lines), encoding="utf-8")

    # Unpaginated read should cap at 250 lines
    res = WorkspaceTools.read_file(tmp_path, "large_text.txt")
    assert res.get("truncated") is True
    assert res.get("total_lines") == 500
    assert "File truncated at line 250 of 500" in res.get("content", "")
    assert "line 1 with some content" in res.get("content", "")
    assert "line 250 with some content" in res.get("content", "")
    assert "line 251 with some content" not in res.get("content", "")


def test_read_file_pagination_and_line_slices(tmp_path: Path):
    lines = [f"line_{i}" for i in range(1, 101)]
    test_file = tmp_path / "paginated.txt"
    test_file.write_text("\n".join(lines), encoding="utf-8")

    res = WorkspaceTools.read_file(tmp_path, "paginated.txt", start_line=20, end_line=30)
    assert res.get("start_line") == 20
    assert res.get("end_line") == 30
    assert res.get("total_lines") == 100
    assert "20: line_20" in res.get("content", "")
    assert "30: line_30" in res.get("content", "")
    assert "19: line_19" not in res.get("content", "")
    assert "31: line_31" not in res.get("content", "")


def test_read_file_binary_detection(tmp_path: Path):
    bin_file = tmp_path / "binary_data.bin"
    bin_file.write_bytes(b"\x00\x01\x02\x03\x04\x00\xff")

    res = WorkspaceTools.read_file(tmp_path, "binary_data.bin")
    assert res.get("is_binary") is True
    assert "is a binary file" in res.get("content", "")


def test_read_file_runaway_line_sanitization(tmp_path: Path):
    runaway_line = "A" * 2500
    test_file = tmp_path / "runaway.txt"
    test_file.write_text(f"short line\n{runaway_line}\nshort line 3", encoding="utf-8")

    res = WorkspaceTools.read_file(tmp_path, "runaway.txt")
    assert "Line truncated: length exceeded 1000 characters" in res.get("content", "")
    assert len(res.get("content", "")) < 2000


def test_find_symbols_file_size_ceiling(tmp_path: Path):
    # Create normal small python file
    small_py = tmp_path / "small.py"
    small_py.write_text("def valid_function():\n    return 42\n", encoding="utf-8")

    # Create oversized python file (>500KB)
    large_py = tmp_path / "huge.py"
    huge_content = "def huge_func(): pass\n" + ("# filler\n" * 70000)
    large_py.write_text(huge_content, encoding="utf-8")
    assert large_py.stat().st_size > 500 * 1024

    res = WorkspaceTools.find_symbols(tmp_path)
    symbols = res.get("symbols", [])
    symbol_names = [s.get("name") for s in symbols]

    assert "valid_function" in symbol_names
    # Oversized file must be skipped
    assert "huge_func" not in symbol_names


def test_find_symbols_skips_bundles_and_runaway_lines(tmp_path: Path):
    # Minified / bundle file
    bundle_file = tmp_path / "bundle.min.js"
    bundle_file.write_text("function minifiedBundle(){var x=1;}\n", encoding="utf-8")

    # File with runaway single line
    long_line_file = tmp_path / "generated.ts"
    long_line_file.write_text("const DATA = " + ("1," * 3000) + ";\nfunction afterData(){}\n", encoding="utf-8")

    # Clean TS file
    clean_ts = tmp_path / "clean.ts"
    clean_ts.write_text("export function cleanFunction() { return true; }\n", encoding="utf-8")

    res = WorkspaceTools.find_symbols(tmp_path)
    symbols = res.get("symbols", [])
    symbol_names = [s.get("name") for s in symbols]

    assert "cleanFunction" in symbol_names
    assert "minifiedBundle" not in symbol_names
    assert "afterData" not in symbol_names


def test_git_diff_budgeting_and_fallback_fix(tmp_path: Path):
    # Initialize a git repo
    git_env = {"GIT_CONFIG_GLOBAL": "/dev/null", "PATH": "/usr/bin:/bin:/usr/local/bin"}
    subprocess.run(["git", "init"], cwd=tmp_path, capture_output=True, env=git_env)
    subprocess.run(["git", "config", "user.name", "Tester"], cwd=tmp_path, capture_output=True, env=git_env)
    subprocess.run(["git", "config", "user.email", "tester@test.com"], cwd=tmp_path, capture_output=True, env=git_env)

    # Initial commit
    f1 = tmp_path / "file1.txt"
    f1.write_text("initial\n", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=tmp_path, capture_output=True, env=git_env)
    subprocess.run(["git", "commit", "-m", "init"], cwd=tmp_path, capture_output=True, env=git_env)
    subprocess.run(["git", "branch", "-M", "main"], cwd=tmp_path, capture_output=True, env=git_env)

    # Add a massive change (>1200 lines) to file1
    big_lines = [f"mod line {i}" for i in range(1, 1500)]
    f1.write_text("\n".join(big_lines), encoding="utf-8")

    # Add a second normal file
    f2 = tmp_path / "file2.txt"
    f2.write_text("hello world\n", encoding="utf-8")

    # Add a lockfile with many lines
    lock_file = tmp_path / "package-lock.json"
    lock_lines = [f'  "dep_{i}": {{ "version": "1.0.{i}" }}' for i in range(200)]
    lock_file.write_text("{\n" + ",\n".join(lock_lines) + "\n}\n", encoding="utf-8")

    mgr = WorktreeManager()
    diffs = mgr.get_git_diff(tmp_path, mode="working_tree")

    diff_map = {d["file_path"]: d for d in diffs}

    assert "file1.txt" in diff_map
    assert diff_map["file1.txt"].get("diff_truncated") is True
    assert "... [Diff truncated:" in diff_map["file1.txt"].get("diff_content", "")

    assert "file2.txt" in diff_map
    assert diff_map["file2.txt"].get("diff_truncated") is False
    assert "hello world" in diff_map["file2.txt"].get("diff_content", "")
    # Crucial: file2 diff must NEVER contain file1's diff (no fallback to raw_diff)
    assert "mod line 10" not in diff_map["file2.txt"].get("diff_content", "")

    assert "package-lock.json" in diff_map
    assert diff_map["package-lock.json"].get("diff_truncated") is True
    assert "[Lockfile update:" in diff_map["package-lock.json"].get("diff_content", "")


@pytest.mark.asyncio
async def test_get_sandbox_file_content_pagination_endpoint(tmp_path: Path):
    test_file = tmp_path / "api_test.py"
    lines = [f"print({i})" for i in range(1, 2001)]
    test_file.write_text("\n".join(lines), encoding="utf-8")

    mock_task = MagicMock(spec=TaskModel)
    mock_task.id = "task-123"
    mock_task.workspace_path = str(tmp_path)

    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = mock_task
    mock_db.execute.return_value = mock_result

    # Unpaginated: should cap at 1000 lines
    res = await get_sandbox_file_content("task-123", "api_test.py", db=mock_db)
    assert res["is_truncated"] is True
    assert res["lines"] == 1000
    assert res["total_lines"] == 2000
    assert res["start_line"] == 1
    assert res["end_line"] == 1000

    # Paginated: lines 1201 to 1400
    res_page = await get_sandbox_file_content("task-123", "api_test.py", start_line=1201, end_line=1400, db=mock_db)
    assert res_page["lines"] == 200
    assert res_page["start_line"] == 1201
    assert res_page["end_line"] == 1400
    assert res_page["is_truncated"] is True
    assert "print(1201)" in res_page["content"]
    assert "print(1400)" in res_page["content"]
    assert "print(1200)" not in res_page["content"]


@pytest.mark.asyncio
async def test_get_sandbox_folder_children_endpoint(tmp_path: Path):
    sub_dir = tmp_path / "submodule"
    sub_dir.mkdir()
    (sub_dir / "mod_a.py").write_text("x = 1\n")
    (sub_dir / "mod_b.py").write_text("y = 2\n")
    inner_dir = sub_dir / "inner"
    inner_dir.mkdir()
    (inner_dir / "item.txt").write_text("hi\n")

    mock_task = MagicMock(spec=TaskModel)
    mock_task.id = "task-123"
    mock_task.workspace_path = str(tmp_path)

    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = mock_task
    mock_db.execute.return_value = mock_result

    res = await get_sandbox_folder_children("task-123", path="submodule", db=mock_db)
    assert res["path"] == "submodule"
    assert res["total_entries"] == 3
    assert res["has_more"] is False

    child_names = [c["name"] for c in res["children"]]
    assert "inner" in child_names
    assert "mod_a.py" in child_names
    assert "mod_b.py" in child_names

    # Check that directory child has child_count without loading recursive children
    inner_node = next(c for c in res["children"] if c["name"] == "inner")
    assert inner_node["is_dir"] is True
    assert inner_node["child_count"] == 1
    assert inner_node["children"] == []
