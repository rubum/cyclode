import uuid
import logging
from typing import Optional, Dict, Any, List

from app.core.sandboxes.artifacts.models import (
    ArtifactManifest,
    ArtifactType,
    PublishTarget,
    DeploymentStatus,
    DeploymentRecord,
)
from app.core.sandboxes.container.client import container_client

logger = logging.getLogger("cyclode.sandbox.artifacts.deployer")


class StagingDeployer:
    """
    Manages deployment of packaged artifacts to ephemeral staging containers
    and external preview targets.
    """

    def __init__(self, client=None):
        self.client = client or container_client
        self._deployments: Dict[str, DeploymentRecord] = {}

    async def deploy_staging(
        self,
        manifest: ArtifactManifest,
        container_port: int = 80,
        env: Optional[Dict[str, str]] = None
    ) -> DeploymentRecord:
        """
        Deploys an OCI image artifact to an isolated staging container with dynamic port allocation.
        """
        deployment_id = f"dep-{uuid.uuid4().hex[:12]}"
        container_name = f"cyclode-stage-{manifest.artifact_id[:8]}-{uuid.uuid4().hex[:4]}"

        if manifest.artifact_type != ArtifactType.OCI_IMAGE:
            rec = DeploymentRecord(
                deployment_id=deployment_id,
                artifact_id=manifest.artifact_id,
                task_id=manifest.task_id,
                target=PublishTarget.STAGING_PREVIEW,
                status=DeploymentStatus.FAILED,
                error_message=f"Direct container deployment requires OCI_IMAGE, received {manifest.artifact_type.value}"
            )
            self._deployments[deployment_id] = rec
            return rec

        if not await self.client.is_available():
            rec = DeploymentRecord(
                deployment_id=deployment_id,
                artifact_id=manifest.artifact_id,
                task_id=manifest.task_id,
                target=PublishTarget.STAGING_PREVIEW,
                status=DeploymentStatus.FAILED,
                error_message="OCI container engine is offline"
            )
            self._deployments[deployment_id] = rec
            return rec

        # Run container with dynamic ephemeral host port
        run_args = [
            "run", "-d",
            "--name", container_name,
            "-p", f"0:{container_port}"
        ]
        if env:
            for k, v in env.items():
                run_args.extend(["-e", f"{k}={v}"])

        image_target = manifest.entry_point or (manifest.tags[0] if manifest.tags else manifest.name)
        run_args.append(image_target)

        code, out, err = await self.client.run_cli(run_args, timeout=30.0)
        if code != 0:
            rec = DeploymentRecord(
                deployment_id=deployment_id,
                artifact_id=manifest.artifact_id,
                task_id=manifest.task_id,
                target=PublishTarget.STAGING_PREVIEW,
                status=DeploymentStatus.FAILED,
                container_id=container_name,
                error_message=f"Failed to start staging container: {err or out}"
            )
            self._deployments[deployment_id] = rec
            return rec

        # Discover assigned host port
        port_code, port_out, _ = await self.client.run_cli(["port", container_name, str(container_port)], timeout=5.0)
        host_port = 0
        if port_code == 0 and port_out:
            # Output format: 0.0.0.0:32768 or [::]:32768
            parts = port_out.strip().split(":")
            if len(parts) > 1 and parts[-1].isdigit():
                host_port = int(parts[-1])

        endpoint_url = f"http://localhost:{host_port}" if host_port > 0 else None
        rec = DeploymentRecord(
            deployment_id=deployment_id,
            artifact_id=manifest.artifact_id,
            task_id=manifest.task_id,
            target=PublishTarget.STAGING_PREVIEW,
            status=DeploymentStatus.RUNNING,
            endpoint_url=endpoint_url,
            container_id=container_name,
            ports={"container": container_port, "host": host_port}
        )
        self._deployments[deployment_id] = rec
        logger.info(f"Staging deployment {deployment_id} live at {endpoint_url}")
        return rec

    async def stop_deployment(self, deployment_id: str) -> bool:
        """Stops and removes an active staging deployment."""
        rec = self._deployments.get(deployment_id)
        if not rec or not rec.container_id:
            return True

        code, _, _ = await self.client.run_cli(["rm", "-f", rec.container_id], timeout=8.0)
        rec.status = DeploymentStatus.STOPPED
        return code == 0

    def list_deployments(self, task_id: Optional[str] = None) -> List[DeploymentRecord]:
        if task_id:
            return [d for d in self._deployments.values() if d.task_id == task_id]
        return list(self._deployments.values())


staging_deployer = StagingDeployer()
