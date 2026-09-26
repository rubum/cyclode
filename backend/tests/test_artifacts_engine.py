import pytest
import tempfile
import shutil
from pathlib import Path
from unittest.mock import AsyncMock

from app.core.sandboxes.artifacts import (
    ArtifactType,
    PublishTarget,
    DeploymentStatus,
    ArtifactManifest,
    DeploymentRecord,
    ArtifactPackager,
    RegistryClient,
    StagingDeployer,
)


@pytest.fixture
def temp_workspace():
    tmp = tempfile.mkdtemp(prefix="cyclode_artifact_test_")
    yield Path(tmp)
    shutil.rmtree(tmp, ignore_errors=True)


def test_artifact_manifest_serialization():
    manifest = ArtifactManifest(
        artifact_id="art-12345",
        task_id="task-999",
        artifact_type=ArtifactType.OCI_IMAGE,
        name="my-cool-service",
        version="v1.0.0",
        tags=["my-cool-service:v1.0.0", "my-cool-service:latest"],
        digest="sha256:abcdef123456",
        size_bytes=1048576,
        entry_point="my-cool-service:v1.0.0"
    )

    data = manifest.to_dict()
    assert data["artifact_id"] == "art-12345"
    assert data["artifact_type"] == "OCI_IMAGE"
    assert data["name"] == "my-cool-service"
    assert "my-cool-service:latest" in data["tags"]
    assert data["size_bytes"] == 1048576


def test_artifact_packager_dockerfile_synthesis(temp_workspace: Path):
    packager = ArtifactPackager()

    # 1. Web App
    (temp_workspace / "package.json").write_text('{"name": "web"}', encoding="utf-8")
    df_web = packager.synthesize_dockerfile(temp_workspace)
    assert "node:20-bookworm-slim" in df_web
    assert "nginx:alpine-slim" in df_web

    # 2. Python App
    (temp_workspace / "package.json").unlink()
    (temp_workspace / "requirements.txt").write_text("fastapi\nuvicorn\n", encoding="utf-8")
    df_py = packager.synthesize_dockerfile(temp_workspace)
    assert "python:3.11-slim-bookworm" in df_py
    assert "uvicorn" in df_py

    # 3. Go App
    (temp_workspace / "requirements.txt").unlink()
    (temp_workspace / "go.mod").write_text("module example.com/server\n", encoding="utf-8")
    df_go = packager.synthesize_dockerfile(temp_workspace)
    assert "golang:1.22-bookworm" in df_go
    assert "distroless/static" in df_go


@pytest.mark.asyncio
async def test_artifact_packager_static_bundle(temp_workspace: Path):
    dist_dir = temp_workspace / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    (dist_dir / "index.html").write_text("<h1>App</h1>", encoding="utf-8")
    (dist_dir / "bundle.js").write_text("console.log(1)", encoding="utf-8")

    packager = ArtifactPackager()
    manifest, logs = await packager.package_artifact(
        task_id="task-static-test",
        workspace_path=temp_workspace,
        artifact_type=ArtifactType.STATIC_BUNDLE,
        name="web-dist"
    )

    assert manifest is not None
    assert manifest.artifact_type == ArtifactType.STATIC_BUNDLE
    assert manifest.name == "web-dist"
    assert manifest.size_bytes > 0
    assert "dist" in manifest.entry_point


@pytest.mark.asyncio
async def test_registry_client_mocked():
    mock_client = AsyncMock()
    mock_client.is_available.return_value = True
    mock_client.run_cli.return_value = (0, "Layer pushed\n", "")

    reg = RegistryClient(client=mock_client)
    ok, msg = await reg.login("ghcr.io", "octocat", "secret-pat-123")
    assert ok is True
    assert "ghcr.io" in msg

    push_ok, push_logs = await reg.push_image("my-local-app:latest", "ghcr.io/org/my-local-app:latest")
    assert push_ok is True
    assert "Layer pushed" in push_logs


@pytest.mark.asyncio
async def test_staging_deployer_mocked():
    mock_client = AsyncMock()
    mock_client.is_available.return_value = True
    # run returns 0, port returns "0.0.0.0:49152"
    mock_client.run_cli.side_effect = [
        (0, "container-id-999\n", ""),
        (0, "0.0.0.0:49152\n", "")
    ]

    deployer = StagingDeployer(client=mock_client)
    manifest = ArtifactManifest(
        artifact_id="art-test-deploy",
        task_id="task-deploy-1",
        artifact_type=ArtifactType.OCI_IMAGE,
        name="staging-app",
        entry_point="staging-app:latest"
    )

    rec = await deployer.deploy_staging(manifest, container_port=80)
    assert rec.status == DeploymentStatus.RUNNING
    assert rec.endpoint_url == "http://localhost:49152"
    assert rec.ports["host"] == 49152

    # Stop deployment
    mock_client.run_cli.side_effect = [(0, "ok", "")]
    stopped = await deployer.stop_deployment(rec.deployment_id)
    assert stopped is True
    assert rec.status == DeploymentStatus.STOPPED
