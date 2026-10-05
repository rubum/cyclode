import pytest
import subprocess
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel


@pytest.mark.asyncio
async def test_rename_sandbox_file_lifecycle(tmp_path):
    workspace = tmp_path / "sandbox-task-rename-test"
    workspace.mkdir(parents=True, exist_ok=True)

    # Create test files
    file_a = workspace / "original.txt"
    file_a.write_text("Hello Cyclode", encoding="utf-8")

    file_b = workspace / "existing.txt"
    file_b.write_text("Already exists", encoding="utf-8")

    sub_dir = workspace / "subfolder"
    sub_dir.mkdir(parents=True, exist_ok=True)
    nested_file = sub_dir / "nested.py"
    nested_file.write_text("print('nested')", encoding="utf-8")

    async with async_session_factory() as session:
        task = TaskModel(
            id="task-rename-test",
            session_key="rename-test-key",
            title="File Rename Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Rename single file
        res = await client.post(
            "/api/tasks/task-rename-test/files/rename",
            json={"old_path": "original.txt", "new_path": "renamed.txt"}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert data["new_path"] == "renamed.txt"
        assert not (workspace / "original.txt").exists()
        assert (workspace / "renamed.txt").exists()
        assert (workspace / "renamed.txt").read_text(encoding="utf-8") == "Hello Cyclode"

        # 2. Move file into auto-created subfolder
        res_move = await client.post(
            "/api/tasks/task-rename-test/files/rename",
            json={"old_path": "renamed.txt", "new_path": "deep/folder/moved.txt"}
        )
        assert res_move.status_code == 200
        assert (workspace / "deep" / "folder" / "moved.txt").exists()
        assert not (workspace / "renamed.txt").exists()

        # 3. Rename directory
        res_dir = await client.post(
            "/api/tasks/task-rename-test/files/rename",
            json={"old_path": "subfolder", "new_path": "renamed_folder"}
        )
        assert res_dir.status_code == 200
        assert (workspace / "renamed_folder" / "nested.py").exists()
        assert not (workspace / "subfolder").exists()

        # 4. Error: Source file not found
        res_404 = await client.post(
            "/api/tasks/task-rename-test/files/rename",
            json={"old_path": "non_existent.txt", "new_path": "out.txt"}
        )
        assert res_404.status_code == 404

        # 5. Error: Collision with existing file
        res_409 = await client.post(
            "/api/tasks/task-rename-test/files/rename",
            json={"old_path": "deep/folder/moved.txt", "new_path": "existing.txt"}
        )
        assert res_409.status_code == 409

        # 6. Error: Path traversal outside workspace
        res_traversal = await client.post(
            "/api/tasks/task-rename-test/files/rename",
            json={"old_path": "existing.txt", "new_path": "../outside.txt"}
        )
        assert res_traversal.status_code == 403

        # 7. Error: Protected .git directory operations
        res_git = await client.post(
            "/api/tasks/task-rename-test/files/rename",
            json={"old_path": "existing.txt", "new_path": ".git/forbidden.txt"}
        )
        assert res_git.status_code == 403


@pytest.mark.asyncio
async def test_rename_sandbox_file_in_git_repo(tmp_path):
    workspace = tmp_path / "sandbox-git-rename-test"
    workspace.mkdir(parents=True, exist_ok=True)

    # Initialize a clean git repository
    subprocess.run(["git", "init", "-b", "main"], cwd=str(workspace), check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test Agent"], cwd=str(workspace), check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "agent@test.local"], cwd=str(workspace), check=True, capture_output=True)

    tracked_file = workspace / "tracked.py"
    tracked_file.write_text("def test(): pass\n", encoding="utf-8")
    subprocess.run(["git", "add", "tracked.py"], cwd=str(workspace), check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "add tracked.py"], cwd=str(workspace), check=True, capture_output=True)

    async with async_session_factory() as session:
        task = TaskModel(
            id="task-git-rename-test",
            session_key="git-rename-key",
            title="Git Rename Test",
            persona="IssueResolver",
            status="RUNNING",
            workspace_path=str(workspace)
        )
        session.add(task)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/tasks/task-git-rename-test/files/rename",
            json={"old_path": "tracked.py", "new_path": "module/tracked_renamed.py"}
        )
        assert res.status_code == 200
        assert (workspace / "module" / "tracked_renamed.py").exists()
        assert not (workspace / "tracked.py").exists()

        # Check git status reflects the rename
        status_res = subprocess.run(["git", "status", "--porcelain"], cwd=str(workspace), capture_output=True, text=True)
        assert "R" in status_res.stdout or "module/tracked_renamed.py" in status_res.stdout
