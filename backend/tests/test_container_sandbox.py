import pytest
import tempfile
import shutil
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.core.sandboxes.container.client import ContainerClient
from app.core.sandboxes.container.policies import ContainerSecurityPolicy
from app.core.sandboxes.container.images import ImageResolver
from app.core.sandboxes.container.executor import ContainerExecutor
from app.core.sandboxes.container.lifecycle import ContainerLifecycleManager
from app.core.sandboxes.container_provider import ContainerSandboxProvider
from app.core.sandboxes.base import SandboxContext


@pytest.fixture
def temp_workspace():
    tmp = tempfile.mkdtemp(prefix="cyclode_container_test_")
    yield Path(tmp)
    shutil.rmtree(tmp, ignore_errors=True)


def test_container_security_policy_cli_args():
    policy = ContainerSecurityPolicy(
        cpus=2.0,
        memory="2g",
        pids_limit=256,
        cap_drop=["ALL"],
        cap_add=["CHOWN", "SETUID"],
        security_opts=["no-new-privileges:true"]
    )
    args = policy.to_cli_args()
    assert "--cpus" in args
    assert "2.0" in args
    assert "--memory" in args
    assert "2g" in args
    assert "--pids-limit" in args
    assert "256" in args
    assert "--cap-drop" in args
    assert "ALL" in args
    assert "--cap-add" in args
    assert "CHOWN" in args
    assert "--security-opt" in args
    assert "no-new-privileges:true" in args


def test_image_resolver_manifest_detection(temp_workspace: Path):
    resolver = ImageResolver()

    # Default
    assert "debian" in resolver.resolve_image_for_workspace(temp_workspace)

    # Node
    (temp_workspace / "package.json").write_text("{}", encoding="utf-8")
    assert "node" in resolver.resolve_image_for_workspace(temp_workspace)

    # Rust
    (temp_workspace / "package.json").unlink()
    (temp_workspace / "Cargo.toml").write_text("[package]", encoding="utf-8")
    assert "rust" in resolver.resolve_image_for_workspace(temp_workspace)

    # Flutter
    (temp_workspace / "Cargo.toml").unlink()
    (temp_workspace / "pubspec.yaml").write_text("name: test", encoding="utf-8")
    assert "cyclode-mobile" in resolver.resolve_image_for_workspace(temp_workspace) or "flutter" in resolver.resolve_image_for_workspace(temp_workspace)

    # Elixir
    (temp_workspace / "pubspec.yaml").unlink()
    (temp_workspace / "mix.exs").write_text("defmodule Test do\nend", encoding="utf-8")
    assert "elixir" in resolver.resolve_image_for_workspace(temp_workspace)


def test_container_lifecycle_resolve_bind_source():
    mgr = ContainerLifecycleManager()
    with patch("app.core.sandboxes.container.lifecycle.settings.HOST_WORKSPACE_ROOT", "/Users/test/Codev/Cyclode/workspaces"), \
         patch("app.core.sandboxes.container.lifecycle.settings.WORKSPACE_ROOT", "/workspaces"):
        p = Path("/workspaces/sandbox-abc-123")
        bind = mgr.resolve_bind_source(p)
        assert bind == "/Users/test/Codev/Cyclode/workspaces/sandbox-abc-123"

    with patch("app.core.sandboxes.container.lifecycle.settings.HOST_WORKSPACE_ROOT", None):
        p = Path("/tmp/local-workspace")
        bind = mgr.resolve_bind_source(p)
        assert bind == str(p.resolve())


@pytest.mark.asyncio
async def test_container_executor_mocked():
    mock_client = AsyncMock()
    mock_client.run_cli.return_value = (0, "compilation successful\n", "")

    executor = ContainerExecutor(client=mock_client)
    res = await executor.execute_command("test-container", "cargo build --release")
    assert res.exit_code == 0
    assert "compilation successful" in res.stdout
    assert res.command == "cargo build --release"


@pytest.mark.asyncio
async def test_container_lifecycle_manager_mocked(temp_workspace: Path):
    mock_client = AsyncMock()
    mock_client.run_cli.return_value = (0, "container-id-12345\n", "")

    mgr = ContainerLifecycleManager(client=mock_client)
    c_name = await mgr.ensure_container_running("task-test-1", temp_workspace)
    assert c_name == "cyclode-sb-task-test-1"

    destroyed = await mgr.destroy_container("task-test-1")
    assert destroyed is True


@pytest.mark.asyncio
async def test_container_sandbox_provider_fallback(temp_workspace: Path):
    provider = ContainerSandboxProvider()
    with patch.object(provider.client, "is_available", return_value=False):
        ctx = await provider.create_sandbox(task_id="test-fallback-1")
        assert ctx.workspace_path.exists()
        assert ctx.metadata.get("sandbox_mode") == "host_overlay"

        # run_command falls back to overlay execution
        res = await provider.run_command(ctx, "echo 'fallback test'")
        assert res.exit_code == 0
        assert "fallback test" in res.stdout
