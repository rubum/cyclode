import subprocess
import pytest
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel
from app.core.worktree import worktree_manager


@pytest.mark.asyncio
async def test_get_git_blame_committed_file(tmp_path):
    workspace = tmp_path / "sandbox-blame-test"
    workspace.mkdir(parents=True, exist_ok=True)

    git_env = worktree_manager._get_git_env()
    subprocess.run(["git", "init"], cwd=workspace, capture_output=True, env=git_env)

    src_file = workspace / "sample.py"
    src_file.write_text("def hello():\n    return 'world'\n", encoding="utf-8")
    subprocess.run(["git", "add", "sample.py"], cwd=workspace, capture_output=True, env=git_env)
    subprocess.run(
        ["git", "commit", "--author=Alice Developer <alice@cyclode.ai>", "-m", "feat: initial hello function"],
        cwd=workspace,
        capture_output=True,
        env=git_env
    )

    # 1. Parse full blame
    blame = worktree_manager.get_git_blame(
        workspace_path=workspace,
        file_path="sample.py"
    )
    assert blame["ok"] is True
    assert blame["total_lines"] == 2
    assert "1" in blame["lines"]
    assert "2" in blame["lines"]
    assert blame["lines"]["1"]["author"] == "Alice Developer"
    assert blame["lines"]["1"]["email"] == "alice@cyclode.ai"
    assert blame["lines"]["1"]["summary"] == "feat: initial hello function"
    assert blame["lines"]["1"]["is_uncommitted"] is False
    assert len(blame["lines"]["1"]["short_sha"]) == 7


@pytest.mark.asyncio
async def test_get_git_blame_uncommitted_and_untracked(tmp_path):
    workspace = tmp_path / "sandbox-blame-uncommitted"
    workspace.mkdir(parents=True, exist_ok=True)

    git_env = worktree_manager._get_git_env()
    subprocess.run(["git", "init"], cwd=workspace, capture_output=True, env=git_env)

    src_file = workspace / "main.py"
    src_file.write_text("line_1 = 100\n", encoding="utf-8")
    subprocess.run(["git", "add", "main.py"], cwd=workspace, capture_output=True, env=git_env)
    subprocess.run(
        ["git", "commit", "--author=Bob Contributor <bob@cyclode.ai>", "-m", "initial line 1"],
        cwd=workspace,
        capture_output=True,
        env=git_env
    )

    # Append uncommitted lines
    src_file.write_text("line_1 = 100\nline_2_dirty = 200\n", encoding="utf-8")

    blame = worktree_manager.get_git_blame(
        workspace_path=workspace,
        file_path="main.py"
    )
    assert blame["ok"] is True
    assert blame["lines"]["1"]["author"] == "Bob Contributor"
    assert blame["lines"]["1"]["is_uncommitted"] is False
    assert blame["lines"]["2"]["author"] == "You"
    assert blame["lines"]["2"]["is_uncommitted"] is True

    # Test completely untracked new file
    new_file = workspace / "new_module.py"
    new_file.write_text("print('hello world')\n", encoding="utf-8")
    untracked_blame = worktree_manager.get_git_blame(
        workspace_path=workspace,
        file_path="new_module.py"
    )
    assert untracked_blame["ok"] is True
    assert untracked_blame["lines"]["1"]["is_uncommitted"] is True
    assert untracked_blame["lines"]["1"]["author"] == "You"


@pytest.mark.asyncio
async def test_get_git_blame_api_endpoint(tmp_path):
    workspace = tmp_path / "sandbox-task-blame-endpoint"
    workspace.mkdir(parents=True, exist_ok=True)

    git_env = worktree_manager._get_git_env()
    subprocess.run(["git", "init"], cwd=workspace, capture_output=True, env=git_env)

    src_file = workspace / "app.py"
    src_file.write_text("import os\n\ndef run():\n    pass\n", encoding="utf-8")
    subprocess.run(["git", "add", "app.py"], cwd=workspace, capture_output=True, env=git_env)
    subprocess.run(
        ["git", "commit", "--author=Carol Lead <carol@cyclode.ai>", "-m", "feat: base app runner"],
        cwd=workspace,
        capture_output=True,
        env=git_env
    )

    async with async_session_factory() as session:
        task = TaskModel(
            id="task-blame-endpoint-test",
            session_key="test-blame-key",
            title="Blame Endpoint Test",
            persona="PairProgrammer",
            status="RUNNING",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Successful blame lookup
        res = await client.get("/api/tasks/task-blame-endpoint-test/files/blame?path=app.py")
        assert res.status_code == 200
        body = res.json()
        assert body["ok"] is True
        assert body["file_path"] == "app.py"
        assert body["total_lines"] >= 3
        assert body["lines"]["1"]["author"] == "Carol Lead"
        assert body["lines"]["1"]["summary"] == "feat: base app runner"

        # 2. Path traversal security block
        res_sec = await client.get("/api/tasks/task-blame-endpoint-test/files/blame?path=../../etc/passwd")
        assert res_sec.status_code == 403

        # 3. Nonexistent task yields 404
        res_404 = await client.get("/api/tasks/missing-task-id-123/files/blame?path=app.py")
        assert res_404.status_code == 404
