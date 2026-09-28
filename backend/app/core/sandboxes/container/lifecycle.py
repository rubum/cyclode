import os
import logging
from pathlib import Path
from typing import Optional, Dict, Any
from app.config import settings
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

    def resolve_bind_source(self, workspace_path: Path) -> str:
        """
        Translates a workspace path (which may be container-internal if running in DooD)
        to the host machine filesystem path expected by the host container daemon.
        """
        resolved = workspace_path.resolve()
        host_root = settings.HOST_WORKSPACE_ROOT or os.environ.get("HOST_WORKSPACE_ROOT")
        if host_root:
            try:
                rel = resolved.relative_to(Path(settings.WORKSPACE_ROOT).resolve())
                return str(Path(host_root) / rel)
            except Exception:
                try:
                    rel = resolved.relative_to(settings.WORKSPACE_ROOT)
                    return str(Path(host_root) / rel)
                except Exception:
                    return f"{host_root.rstrip('/')}/{resolved.name}"
        return str(resolved)

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
            code, out, _ = await self.client.run_cli(
                ["inspect", "--format", "{{.State.Running}}", container_name],
                timeout=5.0
            )
            if code == 0 and out.strip().lower() == "true":
                return container_name

        effective_image = image or image_resolver.resolve_image_for_workspace(workspace_path)
        effective_policy = policy or default_security_policy

        # Clean up stale container with same name if any
        await self.client.run_cli(["rm", "-f", container_name], timeout=5.0)

        # Translate workspace path to host path if running in Docker-out-of-Docker / sibling setup
        bind_source = self.resolve_bind_source(workspace_path)

        # Prepare run arguments
        run_args = [
            "run", "-d",
            "--name", container_name,
            "-v", f"{bind_source}:/workspace:rw",
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

    async def get_container_ip(self, task_id: str) -> Optional[str]:
        """
        Retrieves the private IP address of the task's container if running.
        """
        container_name = self.get_container_name(task_id)
        code, out, _ = await self.client.run_cli(
            ["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", container_name],
            timeout=3.0
        )
        if code == 0 and out.strip():
            return out.strip()
        return None

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
            code, out, _ = await self.client.run_cli(
                ["inspect", "--format", "{{.State.Running}}", container_name],
                timeout=3.0
            )
            is_running = (code == 0 and out.strip().lower() == "true")
            if is_running and task_id not in self._active_containers:
                self._active_containers[task_id] = container_name

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
