import subprocess
import pytest
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel
from app.core.worktree import worktree_manager


@pytest.mark.asyncio
async def test_get_diff_context_direct_slicing(tmp_path):
    workspace = tmp_path / "sandbox-diff-context"
    workspace.mkdir(parents=True, exist_ok=True)

    # Create a 25-line source file
    code_lines = [f"line_{i} = {i} * 2" for i in range(1, 26)]
    src_file = workspace / "lib" / "sample.py"
    src_file.parent.mkdir(parents=True, exist_ok=True)
    src_file.write_text("\n".join(code_lines) + "\n", encoding="utf-8")

    # 1. Slice lines 5..10
    ctx = worktree_manager.get_diff_context(
        workspace_path=workspace,
        path="lib/sample.py",
        start_line=5,
        end_line=10
    )
    assert ctx["ok"] is True
    assert ctx["start_line"] == 5
    assert ctx["end_line"] == 10
    assert ctx["total_lines"] == 25
    assert len(ctx["lines"]) == 6
    assert ctx["lines"][0] == "line_5 = 5 * 2"
    assert ctx["lines"][-1] == "line_10 = 10 * 2"

    # 2. Out of bounds clamping (start=20, end=50)
    ctx_clamped = worktree_manager.get_diff_context(
        workspace_path=workspace,
        path="lib/sample.py",
        start_line=20,
        end_line=50
    )
    assert ctx_clamped["start_line"] == 20
    assert ctx_clamped["end_line"] == 25
    assert len(ctx_clamped["lines"]) == 6
    assert ctx_clamped["lines"][-1] == "line_25 = 25 * 2"

    # 3. Path traversal security check
    with pytest.raises(ValueError, match="Access denied"):
        worktree_manager.get_diff_context(
            workspace_path=workspace,
            path="../../secret.txt",
            start_line=1,
            end_line=5
        )


@pytest.mark.asyncio
async def test_get_diff_context_api_endpoint(tmp_path):
    workspace = tmp_path / "sandbox-task-diff-ctx"
    workspace.mkdir(parents=True, exist_ok=True)

    file_content = "\n".join([f"entry_{i}" for i in range(1, 31)]) + "\n"
    data_file = workspace / "entries.txt"
    data_file.write_text(file_content, encoding="utf-8")

    # Insert Task record
    async with async_session_factory() as session:
        task = TaskModel(
            id="task-diff-ctx-test",
            session_key="test-key",
            title="Diff Context Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Successful slice
        res = await client.get("/api/tasks/task-diff-ctx-test/diff/context?path=entries.txt&start_line=10&end_line=15")
        assert res.status_code == 200
        body = res.json()
        assert body["ok"] is True
        assert body["start_line"] == 10
        assert body["end_line"] == 15
        assert body["total_lines"] == 30
        assert body["lines"] == ["entry_10", "entry_11", "entry_12", "entry_13", "entry_14", "entry_15"]

        # 2. Path outside workspace yields 403
        res_sec = await client.get("/api/tasks/task-diff-ctx-test/diff/context?path=../../etc/passwd&start_line=1&end_line=5")
        assert res_sec.status_code == 403

        # 3. Nonexistent task yields 404
        res_404 = await client.get("/api/tasks/non-existent-task/diff/context?path=entries.txt&start_line=1&end_line=5")
        assert res_404.status_code == 404


@pytest.mark.asyncio
async def test_get_diff_context_git_commit_ref(tmp_path):
    repo = tmp_path / "git-diff-repo"
    repo.mkdir(parents=True, exist_ok=True)

    # Initialize git repo
    subprocess.run(["git", "init"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Tester"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "test@cyclode.local"], cwd=repo, check=True)

    app_file = repo / "app.py"
    app_file.write_text("v1_line1\nv1_line2\nv1_line3\n", encoding="utf-8")
    subprocess.run(["git", "add", "app.py"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-m", "commit 1"], cwd=repo, check=True)
    c1_sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, check=True, capture_output=True, text=True).stdout.strip()

    # Commit 2 alters file
    app_file.write_text("v2_line1\nv2_line2\nv2_line3\nv2_line4\n", encoding="utf-8")
    subprocess.run(["git", "add", "app.py"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-m", "commit 2"], cwd=repo, check=True)

    # Verify context read from c1_sha returns v1 content
    ctx_c1 = worktree_manager.get_diff_context(
        workspace_path=repo,
        path="app.py",
        start_line=1,
        end_line=3,
        mode="commit",
        commit_sha=c1_sha
    )
    assert ctx_c1["ok"] is True
    assert ctx_c1["lines"] == ["v1_line1", "v1_line2", "v1_line3"]
    assert ctx_c1["total_lines"] == 3
