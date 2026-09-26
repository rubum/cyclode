import uuid
from pathlib import Path
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel, TaskLogModel
from app.core.sandboxes.container.lifecycle import container_lifecycle
from app.core.sandboxes.artifacts.models import (
    ArtifactManifest,
    ArtifactType,
    DeploymentRecord,
    PublishTarget,
    DeploymentStatus,
)
from app.core.sandboxes.artifacts.packager import artifact_packager
from app.core.sandboxes.artifacts.deployer import staging_deployer


@pytest.mark.asyncio
async def test_container_lifecycle_telemetry(tmp_path):
    telemetry = await container_lifecycle.get_container_telemetry("test-task-telem", tmp_path)
    assert "active" in telemetry
    assert "engine" in telemetry
    assert "status" in telemetry
    assert float(telemetry["cpu_limit"]) >= 1.0
    assert "memory_limit" in telemetry
    assert telemetry["pids_limit"] >= 100
    assert telemetry["workspace_mount"] == "/workspace:rw"


@pytest.mark.asyncio
async def test_sandbox_diagnostics_telemetry_endpoint(tmp_path):
    task_id = f"test-telem-task-{uuid.uuid4().hex[:6]}"
    ws_dir = tmp_path / "telemetry_ws"
    ws_dir.mkdir()
    (ws_dir / "index.html").write_text("<h1>Test Telemetry</h1>")

    async with async_session_factory() as db:
        task = TaskModel(
            id=task_id,
            title="Telemetry Diagnostic Task",
            description="Testing container & artifact telemetry",
            status="RUNNING",
            workspace_path=str(ws_dir)
        )
        db.add(task)
        await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get(f"/api/tasks/{task_id}/sandbox")
        assert res.status_code == 200
        data = res.json()

        assert "resources" in data
        assert "container" in data["resources"]
        c_telem = data["resources"]["container"]
        assert "engine" in c_telem
        assert "status" in c_telem
        assert "cpu_limit" in c_telem

        assert "artifacts" in data["resources"]
        a_telem = data["resources"]["artifacts"]
        assert "manifests" in a_telem
        assert "deployments" in a_telem
        assert "total_packaged" in a_telem
        assert "total_active_deployments" in a_telem

        assert "runtime" in data
        assert "mode" in data["runtime"]


@pytest.mark.asyncio
async def test_tool_execution_plane_classification(tmp_path):
    task_id = f"test-plane-task-{uuid.uuid4().hex[:6]}"
    ws_dir = tmp_path / "plane_ws"
    ws_dir.mkdir()

    async with async_session_factory() as db:
        task = TaskModel(
            id=task_id,
            title="Plane Classification Task",
            description="Testing tool execution plane classification",
            status="ACTIVE",
            workspace_path=str(ws_dir)
        )
        db.add(task)

        logs = [
            TaskLogModel(task_id=task_id, tool_name="run_command", tool_input={"command": "cargo test"}, exit_code=0, duration_ms=120),
            TaskLogModel(task_id=task_id, tool_name="replace_file_content", tool_input={"path": "src/main.rs"}, exit_code=0, duration_ms=4),
            TaskLogModel(task_id=task_id, tool_name="search_code", tool_input={"query": "ContainerClient"}, exit_code=0, duration_ms=18),
            TaskLogModel(task_id=task_id, tool_name="search_web", tool_input={"query": "rust 2026"}, exit_code=0, duration_ms=350),
            TaskLogModel(task_id=task_id, tool_name="github_pr_action", tool_input={"action": "run_tests"}, exit_code=0, duration_ms=210),
            TaskLogModel(task_id=task_id, tool_name="run_verified_code_review", tool_input={"code": "fn test() {}"}, exit_code=0, duration_ms=450),
        ]
        for l in logs:
            db.add(l)
        await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get(f"/api/tasks/{task_id}/sandbox")
        assert res.status_code == 200
        data = res.json()

        recent_logs = data.get("recent_logs", [])
        assert len(recent_logs) == 6

        planes_by_tool = {l["tool_name"]: l.get("execution_plane") for l in recent_logs}
        assert planes_by_tool["run_command"] == "container"
        assert planes_by_tool["replace_file_content"] == "host_cow"
        assert planes_by_tool["search_code"] == "rust_ast"
        assert planes_by_tool["search_web"] == "web_gateway"
        assert planes_by_tool["github_pr_action"] == "saas_vault"
        assert planes_by_tool["run_verified_code_review"] == "review_cascade"


@pytest.mark.asyncio
async def test_artifacts_and_staging_deployment_telemetry(tmp_path):
    task_id = f"test-art-dep-{uuid.uuid4().hex[:6]}"
    ws_dir = tmp_path / "art_ws"
    ws_dir.mkdir()

    # Record manifest in artifact packager
    manifest_id = f"art-{uuid.uuid4().hex[:8]}"
    manifest = ArtifactManifest(
        artifact_id=manifest_id,
        task_id=task_id,
        artifact_type=ArtifactType.OCI_IMAGE,
        name="test-service",
        version="v1.0.0",
        tags=["test-service:v1.0.0", "ghcr.io/org/test-service:v1.0.0"],
        digest="sha256:abcd1234efgh5678",
        size_bytes=1048576,
        entry_point="test-service:v1.0.0"
    )
    artifact_packager._manifests[manifest_id] = manifest

    # Record deployment in staging deployer
    dep_id = f"dep-{uuid.uuid4().hex[:8]}"
    deployment = DeploymentRecord(
        deployment_id=dep_id,
        artifact_id=manifest_id,
        task_id=task_id,
        target=PublishTarget.STAGING_PREVIEW,
        status=DeploymentStatus.RUNNING,
        endpoint_url="http://localhost:49152",
        container_id=f"cyclode-stage-{manifest_id[:8]}",
        ports={"host": 49152, "container": 80}
    )
    staging_deployer._deployments[dep_id] = deployment

    async with async_session_factory() as db:
        task = TaskModel(
            id=task_id,
            title="Artifact Staging Diagnostic Task",
            description="Testing artifact manifests and live staging deployments",
            status="RUNNING",
            workspace_path=str(ws_dir)
        )
        db.add(task)
        await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get(f"/api/tasks/{task_id}/sandbox")
        assert res.status_code == 200
        data = res.json()

        a_telem = data["resources"]["artifacts"]
        assert a_telem["total_packaged"] >= 1
        assert a_telem["total_active_deployments"] >= 1

        found_manifest = any(m["artifact_id"] == manifest_id for m in a_telem["manifests"])
        assert found_manifest is True

        found_dep = any(d["deployment_id"] == dep_id for d in a_telem["deployments"])
        assert found_dep is True
