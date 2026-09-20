from typing import Optional, Dict, Any
from pathlib import Path
import os
from app.core.sandboxes.base import SandboxProvider, SandboxContext
from app.core.sandboxes.ephemeral_provider import ephemeral_sandbox_provider
from app.core.sandboxes.overlay_provider import overlay_sandbox_provider


class SandboxManager:
    """
    Unified manager for ephemeral and Copy-on-Write compute sandboxes.
    Routes operations to OverlayFSSandboxProvider or EphemeralSandboxProvider based on configuration.
    """

    def __init__(self, provider: Optional[SandboxProvider] = None):
        preferred_backend = os.environ.get("SANDBOX_BACKEND", "overlay").lower()
        if provider:
            self.provider = provider
        elif preferred_backend in ["overlay", "cow", "default"]:
            self.provider = overlay_sandbox_provider
        else:
            self.provider = ephemeral_sandbox_provider

    async def get_or_create(
        self,
        task_id: str,
        repo_name: Optional[str] = None,
        repo_url: Optional[str] = None,
        branch: Optional[str] = None,
        commit_sha: Optional[str] = None
    ) -> SandboxContext:
        return await self.provider.create_sandbox(
            task_id=task_id,
            repo_name=repo_name,
            repo_url=repo_url,
            branch=branch,
            commit_sha=commit_sha
        )

    async def fork_sandbox(
        self,
        parent_context: SandboxContext,
        new_task_id: str
    ) -> SandboxContext:
        return await self.provider.fork_sandbox(parent_context, new_task_id)

    async def create_snapshot(self, context: SandboxContext, snapshot_tag: str) -> Optional[str]:
        return await self.provider.create_snapshot(context, snapshot_tag)

    async def rollback_snapshot(self, context: SandboxContext, snapshot_tag: str) -> bool:
        return await self.provider.rollback_snapshot(context, snapshot_tag)

    async def promote_warm_cache(self, context: SandboxContext, cache_key: Optional[str] = None) -> bool:
        return await self.provider.promote_warm_cache(context, cache_key)

    async def get_cow_metrics(self, context: SandboxContext) -> Dict[str, Any]:
        return await self.provider.get_cow_metrics(context)

    async def destroy(self, context: SandboxContext) -> bool:
        if not context or context.is_destroyed:
            return True
        return await self.provider.destroy_sandbox(context)

    async def destroy_by_task_id(self, task_id: str, workspace_path: Optional[str] = None) -> bool:
        return await self.provider.destroy_by_task_id(task_id, workspace_path)


sandbox_manager = SandboxManager()

