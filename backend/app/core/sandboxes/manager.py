from typing import Optional, Dict
from pathlib import Path
from app.core.sandboxes.base import SandboxProvider, SandboxContext
from app.core.sandboxes.ephemeral_provider import ephemeral_sandbox_provider


class SandboxManager:
    def __init__(self, provider: Optional[SandboxProvider] = None):
        self.provider = provider or ephemeral_sandbox_provider

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

    async def destroy(self, context: SandboxContext) -> bool:
        if not context or context.is_destroyed:
            return True
        return await self.provider.destroy_sandbox(context)


sandbox_manager = SandboxManager()
