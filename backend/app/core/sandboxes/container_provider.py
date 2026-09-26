import os
import shutil
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List

from app.core.sandboxes.base import SandboxProvider, SandboxContext, CommandResult
from app.core.sandboxes.container.client import container_client
from app.core.sandboxes.container.lifecycle import container_lifecycle
from app.core.sandboxes.container.executor import container_executor
from app.core.sandboxes.overlay_provider import overlay_sandbox_provider
from app.config import settings

logger = logging.getLogger("cyclode.sandbox.container_provider")


class ContainerSandboxProvider(SandboxProvider):
    """
    Unified OCI Container-backed compute sandbox provider.
    Executes commands inside isolated Docker/Podman containers while preserving
    sub-millisecond host-level Copy-on-Write workspace file operations.
    """

    def __init__(self):
        self.client = container_client
        self.lifecycle = container_lifecycle
        self.executor = container_executor
        self.fallback_overlay = overlay_sandbox_provider

    def __getattr__(self, name: str) -> Any:
        return getattr(self.fallback_overlay, name)

    @property
    def base_dir(self) -> Path:
        return self.fallback_overlay.base_dir

    @base_dir.setter
    def base_dir(self, value: Path) -> None:
        self.fallback_overlay.base_dir = value

    @property
    def cache_dir(self) -> Path:
        return self.fallback_overlay.cache_dir

    @cache_dir.setter
    def cache_dir(self, value: Path) -> None:
        self.fallback_overlay.cache_dir = value

    @property
    def _active_sandboxes(self) -> Dict[str, Any]:
        return self.fallback_overlay._active_sandboxes

    async def create_sandbox(
        self,
        task_id: str,
        repo_name: Optional[str] = None,
        repo_url: Optional[str] = None,
        branch: Optional[str] = None,
        commit_sha: Optional[str] = None
    ) -> SandboxContext:
        """
        Creates a host CoW workspace and spawns an isolated companion container.
        """
        # Create the underlying host workspace using overlay provider
        base_ctx = await self.fallback_overlay.create_sandbox(
            task_id=task_id,
            repo_name=repo_name,
            repo_url=repo_url,
            branch=branch,
            commit_sha=commit_sha
        )

        container_name = None
        if await self.client.is_available():
            container_name = await self.lifecycle.ensure_container_running(
                task_id=task_id,
                workspace_path=base_ctx.workspace_path
            )

        metadata = dict(base_ctx.metadata)
        metadata["sandbox_mode"] = "container" if container_name else "host_overlay"
        if container_name:
            metadata["container_name"] = container_name
            metadata["container_engine"] = self.client.engine_type

        return SandboxContext(
            task_id=task_id,
            workspace_path=base_ctx.workspace_path,
            repo_name=repo_name,
            repo_url=repo_url,
            branch=branch,
            commit_sha=commit_sha,
            metadata=metadata
        )

    async def run_command(self, context: SandboxContext, command: str, timeout: int = 60) -> CommandResult:
        """
        Executes a shell command inside the companion container if available,
        falling back gracefully to host overlay execution.
        """
        if context.is_destroyed:
            return CommandResult(command=command, exit_code=1, stdout="", stderr="Sandbox is destroyed")

        container_name = context.metadata.get("container_name")
        if not container_name and await self.client.is_available():
            container_name = await self.lifecycle.ensure_container_running(
                task_id=context.task_id,
                workspace_path=context.workspace_path
            )
            if container_name:
                context.metadata["container_name"] = container_name

        if container_name and await self.client.is_available():
            return await self.executor.execute_command(
                container_id=container_name,
                command=command,
                workdir="/workspace",
                timeout=timeout
            )

        # Fallback to host overlay execution
        return await self.fallback_overlay.run_command(context, command, timeout=timeout)

    async def read_file(self, context: SandboxContext, file_path: str) -> str:
        return await self.fallback_overlay.read_file(context, file_path)

    async def write_file(self, context: SandboxContext, file_path: str, content: str) -> int:
        return await self.fallback_overlay.write_file(context, file_path, content)

    async def list_dir(self, context: SandboxContext, subpath: str = ".") -> List[Dict[str, Any]]:
        return await self.fallback_overlay.list_dir(context, subpath)

    async def get_git_diff(self, context: SandboxContext) -> List[Dict[str, Any]]:
        return await self.fallback_overlay.get_git_diff(context)

    async def destroy_sandbox(self, context: SandboxContext) -> bool:
        """Stops the container and cleans up the workspace directory."""
        if not context:
            return True
        await self.lifecycle.destroy_container(context.task_id)
        return await self.fallback_overlay.destroy_sandbox(context)

    async def destroy_by_task_id(self, task_id: str, workspace_path: Optional[str] = None) -> bool:
        await self.lifecycle.destroy_container(task_id)
        return await self.fallback_overlay.destroy_by_task_id(task_id, workspace_path)

    async def fork_sandbox(self, parent_context: SandboxContext, new_task_id: str) -> SandboxContext:
        forked_ctx = await self.fallback_overlay.fork_sandbox(parent_context, new_task_id)
        container_name = None
        if await self.client.is_available():
            container_name = await self.lifecycle.ensure_container_running(
                task_id=new_task_id,
                workspace_path=forked_ctx.workspace_path
            )
        forked_ctx.metadata["sandbox_mode"] = "container" if container_name else "host_overlay"
        if container_name:
            forked_ctx.metadata["container_name"] = container_name
        return forked_ctx

    async def create_snapshot(self, context: SandboxContext, snapshot_tag: str) -> Optional[str]:
        return await self.fallback_overlay.create_snapshot(context, snapshot_tag)

    async def rollback_snapshot(self, context: SandboxContext, snapshot_tag: str) -> bool:
        return await self.fallback_overlay.rollback_snapshot(context, snapshot_tag)

    async def promote_warm_cache(self, context: SandboxContext, cache_key: Optional[str] = None) -> bool:
        return await self.fallback_overlay.promote_warm_cache(context, cache_key)

    async def get_cow_metrics(self, context: SandboxContext) -> Dict[str, Any]:
        return await self.fallback_overlay.get_cow_metrics(context)


container_sandbox_provider = ContainerSandboxProvider()
