import logging
from pathlib import Path
from typing import Optional, Dict, Any
from app.core.sandboxes.container.client import container_client
from app.core.sandboxes.container.policies import default_security_policy, ContainerSecurityPolicy
from app.core.sandboxes.container.images import image_resolver

logger = logging.getLogger("cyclode.sandbox.container.lifecycle")


class ContainerLifecycleManager:
    """
    Manages OCI container lifecycle (creation, bind mounts, warm pools, and removal).
    """

    def __init__(self, client=None):
        self.client = client or container_client
        self._active_containers: Dict[str, str] = {}  # task_id -> container_name

    def get_container_name(self, task_id: str) -> str:
        clean_id = task_id.replace(" ", "-").replace("/", "-")[:32]
        return f"cyclode-sb-{clean_id}"

    async def ensure_container_running(
        self,
        task_id: str,
        workspace_path: Path,
        image: Optional[str] = None,
        policy: Optional[ContainerSecurityPolicy] = None
    ) -> Optional[str]:
        """
        Ensures an isolated sandbox container is running with the workspace bind-mounted.
        Returns the container identifier/name.
        """
        container_name = self.get_container_name(task_id)
        if task_id in self._active_containers:
            # Check if still running
            code, _, _ = await self.client.run_cli(["inspect", container_name], timeout=5.0)
            if code == 0:
                return container_name

        effective_image = image or image_resolver.resolve_image_for_workspace(workspace_path)
        effective_policy = policy or default_security_policy

        # Clean up stale container with same name if any
        await self.client.run_cli(["rm", "-f", container_name], timeout=5.0)

        # Prepare run arguments
        run_args = [
            "run", "-d",
            "--name", container_name,
            "-v", f"{workspace_path.resolve()}:/workspace:rw",
            "-w", "/workspace"
        ]
        run_args.extend(effective_policy.to_cli_args())
        run_args.extend([effective_image, "sleep", "infinity"])

        code, out, err = await self.client.run_cli(run_args, timeout=20.0)
        if code == 0:
            self._active_containers[task_id] = container_name
            logger.info(f"Spawned container sandbox {container_name} for task {task_id} using {effective_image}")
            return container_name
        else:
            logger.warning(f"Failed to spawn container sandbox {container_name}: {err}")
            return None

    async def destroy_container(self, task_id: str) -> bool:
        """Stops and removes the container for the specified task."""
        container_name = self._active_containers.pop(task_id, None) or self.get_container_name(task_id)
        code, _, _ = await self.client.run_cli(["rm", "-f", container_name], timeout=8.0)
        return code == 0

    async def get_container_telemetry(self, task_id: str, workspace_path: Optional[Path] = None) -> Dict[str, Any]:
        """
        Retrieves real-time telemetry and isolation metrics for the task's companion container.
        """
        is_available = await self.client.is_available()
        container_name = self.get_container_name(task_id)
        effective_image = image_resolver.resolve_image_for_workspace(workspace_path) if workspace_path else "debian:bookworm-slim"
        policy = default_security_policy

        is_running = False
        if is_available:
            if task_id in self._active_containers:
                code, _, _ = await self.client.run_cli(["inspect", container_name], timeout=3.0)
                is_running = (code == 0)

        status_str = "RUNNING" if is_running else ("READY" if is_available else "OFFLINE")

        return {
            "active": is_running,
            "engine": self.client.engine_type if is_available else "none",
            "server_version": self.client._version_info.get("version", ""),
            "container_name": container_name if is_running or task_id in self._active_containers else None,
            "image": effective_image,
            "status": status_str,
            "cpu_limit": str(policy.cpus),
            "memory_limit": policy.memory,
            "pids_limit": policy.pids_limit,
            "security_opts": policy.security_opts,
            "cap_drop": policy.cap_drop,
            "workspace_mount": "/workspace:rw"
        }


container_lifecycle = ContainerLifecycleManager()
