import os
import shutil
import pytest
import asyncio
from pathlib import Path
from app.core.sandboxes.base import SandboxContext
from app.core.sandboxes.overlay_provider import OverlayFSSandboxProvider
from app.core.sandboxes.jailer import Jailer
from app.core.sandboxes.manager import SandboxManager
from app.agent.tools import WorkspaceTools
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel


@pytest.fixture
def temp_cow_workspace(tmp_path):
    base_root = tmp_path / "cache"
    overlay_root = tmp_path / "sandboxes"
    base_root.mkdir()
    overlay_root.mkdir()

    # Create dummy base repo
    sample_repo = base_root / "sample-repo"
    sample_repo.mkdir()
    (sample_repo / "main.py").write_text("def hello():\n    return 'original'\n")
    (sample_repo / "test_main.py").write_text(
        "from main import hello\ndef test_hello():\n    assert hello() == 'patched'\n"
    )

    provider = OverlayFSSandboxProvider(base_dir=str(overlay_root), cache_dir=str(base_root))
    yield provider, sample_repo, tmp_path


@pytest.mark.asyncio
async def test_overlay_provider_lifecycle(temp_cow_workspace):
    provider, sample_repo, tmp_path = temp_cow_workspace
    task_id = "test-cow-task-1"

    # 1. Create sandbox
    ctx = await provider.create_sandbox(task_id=task_id)
    assert ctx.task_id == task_id
    assert ctx.workspace_path.exists()
    
    (ctx.workspace_path / "main.py").write_text("def hello():\n    return 'original'\n")
    assert (ctx.workspace_path / "main.py").exists()
    assert (ctx.workspace_path / "main.py").read_text() == "def hello():\n    return 'original'\n"

    # 2. Run command
    res = await provider.run_command(ctx, "echo 'hello from sandbox'")
    assert res.exit_code == 0
    assert "hello from sandbox" in res.stdout

    # 3. Snapshot and turn rollback
    snap_res = await provider.create_snapshot(ctx, "turn-1")
    assert snap_res == "turn-1"

    # Modify file
    (ctx.workspace_path / "main.py").write_text("def hello():\n    return 'modified'\n")
    (ctx.workspace_path / "new_file.txt").write_text("new ephemeral file")
    assert (ctx.workspace_path / "main.py").read_text() == "def hello():\n    return 'modified'\n"

    # Rollback to turn-1
    rollback_ok = await provider.rollback_snapshot(ctx, "turn-1")
    assert rollback_ok is True
    assert (ctx.workspace_path / "main.py").read_text() == "def hello():\n    return 'original'\n"
    assert not (ctx.workspace_path / "new_file.txt").exists()

    # 4. Instant Forking
    fork_id = "test-cow-task-1-fork"
    child_ctx = await provider.fork_sandbox(ctx, fork_id)
    assert child_ctx.task_id == fork_id
    assert child_ctx.workspace_path.exists()
    assert (child_ctx.workspace_path / "main.py").read_text() == "def hello():\n    return 'original'\n"

    # Modify child workspace and check isolation from parent
    WorkspaceTools.edit_file(child_ctx.workspace_path, "main.py", "def hello():\n    return 'child_only'\n")
    assert (child_ctx.workspace_path / "main.py").read_text() == "def hello():\n    return 'child_only'\n"
    assert (ctx.workspace_path / "main.py").read_text() == "def hello():\n    return 'original'\n"

    # 5. CoW Telemetry Metrics
    metrics = await provider.get_cow_metrics(ctx)
    assert "base_size_bytes" in metrics
    assert "diff_size_bytes" in metrics
    assert "shared_savings_bytes" in metrics
    assert metrics["is_cow_active"] is True

    # 6. Destroy sandboxes
    await provider.destroy_sandbox(child_ctx)
    await provider.destroy_sandbox(ctx)
    assert not child_ctx.workspace_path.exists()
    assert not ctx.workspace_path.exists()


def test_jailer_secret_sanitization():
    jailer = Jailer()
    dirty_env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "USER": "appuser",
        "GEMINI_API_KEY": "AIzaSySecretApiKey123",
        "GOOGLE_API_KEY": "AIzaSySecretApiKey456",
        "GITHUB_TOKEN": "ghp_VerySecretGithubToken",
        "DATABASE_URL": "postgresql://user:pass@db:5432/main",
        "POSTGRES_PASSWORD": "supersecretpassword",
        "AWS_SECRET_ACCESS_KEY": "aws-secret-123",
        "CUSTOM_SAFE_VAR": "hello_world"
    }

    clean_env = jailer.get_clean_environment(dirty_env)

    assert "PATH" in clean_env
    assert "USER" in clean_env
    assert "CUSTOM_SAFE_VAR" in clean_env
    assert clean_env["CUSTOM_SAFE_VAR"] == "hello_world"

    # Assert all sensitive variables stripped
    assert "GEMINI_API_KEY" not in clean_env
    assert "GOOGLE_API_KEY" not in clean_env
    assert "GITHUB_TOKEN" not in clean_env
    assert "DATABASE_URL" not in clean_env
    assert "POSTGRES_PASSWORD" not in clean_env
    assert "AWS_SECRET_ACCESS_KEY" not in clean_env


def test_jailer_wrap_command(tmp_path):
    jailer = Jailer()
    cmd, is_shell = jailer.wrap_command(tmp_path, "pytest tests/")
    assert isinstance(cmd, list)
    assert len(cmd) > 0
    # Must contain target command either wrapped or fallback
    assert any("pytest" in part for part in cmd)


@pytest.mark.asyncio
async def test_speculative_branch_test(tmp_path, monkeypatch):
    from app.core.sandboxes.manager import sandbox_manager
    monkeypatch.setattr(sandbox_manager.provider, "base_dir", tmp_path / "sandboxes")
    monkeypatch.setattr(sandbox_manager.provider, "cache_dir", tmp_path / "cache")
    
    workspace = tmp_path / "sandbox-spec_ws"
    workspace.mkdir()

    (workspace / "math_ops.py").write_text("def add(a, b):\n    return a - b\n")  # intentional bug
    (workspace / "test_ops.py").write_text(
        "import sys\nfrom math_ops import add\nif add(2, 3) != 5:\n    sys.exit(1)\n"
    )

    # 1. Test failing candidate
    bad_candidate = {
        "name": "candidate_bad",
        "edits": [
            {
                "file_path": "math_ops.py",
                "target_content": "return a - b",
                "replacement_content": "return a * b"
            }
        ]
    }

    # 2. Test passing candidate
    good_candidate = {
        "name": "candidate_good",
        "edits": [
            {
                "file_path": "math_ops.py",
                "target_content": "return a - b",
                "replacement_content": "return a + b"
            }
        ]
    }

    res = await WorkspaceTools.speculative_branch_test(
        workspace_path=workspace,
        test_command="python3 test_ops.py",
        hypotheses=[bad_candidate, good_candidate]
    )

    assert "all_results" in res
    assert len(res["all_results"]) == 2
    assert res["winning_hypothesis"] == "candidate_good"


@pytest.mark.asyncio
async def test_sandbox_api_fork_and_rollback(tmp_path, monkeypatch):
    from app.core.sandboxes.manager import sandbox_manager
    monkeypatch.setattr(sandbox_manager.provider, "base_dir", tmp_path / "sandboxes")
    monkeypatch.setattr(sandbox_manager.provider, "cache_dir", tmp_path / "cache")

    # Setup test task in db
    async with async_session_factory() as db:
        task = TaskModel(
            title="CoW Test Task",
            description="Testing fork and rollback API endpoints",
            status="ACTIVE",
            workspace_path=str(tmp_path / "api_ws")
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)
        task_id = task.id

    ws_dir = tmp_path / "api_ws"
    ws_dir.mkdir()
    (ws_dir / "app.py").write_text("print('version 1')\n")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Get sandbox info
        info_res = await client.get(f"/api/tasks/{task_id}/sandbox")
        assert info_res.status_code == 200
        info_json = info_res.json()
        assert "resources" in info_json
        assert "cow_layers" in info_json["resources"]
        assert "jail" in info_json["resources"]

        # Fork sandbox
        fork_res = await client.post(f"/api/tasks/{task_id}/sandbox/fork")
        assert fork_res.status_code == 200
        fork_json = fork_res.json()
        assert fork_json["ok"] is True
        assert "forked_task_id" in fork_json

        # Promote cache
        promote_res = await client.post(f"/api/tasks/{task_id}/sandbox/promote_cache")
        # May return 400 or ok depending on memory presence, but should not 500
        assert promote_res.status_code in (200, 400)

