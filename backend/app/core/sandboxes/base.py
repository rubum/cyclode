from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Dict, Any, List


class CloneAuthRequiredException(Exception):
    def __init__(self, repo_url: str, stderr: str = ""):
        self.repo_url = repo_url
        self.stderr = stderr
        super().__init__(f"Authentication required to clone repository '{repo_url}': {stderr}")


class CloneFailedException(Exception):
    def __init__(self, repo_url: str, stderr: str = ""):
        self.repo_url = repo_url
        self.stderr = stderr
        super().__init__(f"Failed to clone repository '{repo_url}': {stderr}")


@dataclass
class SandboxContext:
    task_id: str
    workspace_path: Path
    repo_name: Optional[str] = None
    repo_url: Optional[str] = None
    branch: Optional[str] = None
    commit_sha: Optional[str] = None
    is_destroyed: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CommandResult:
    command: str
    exit_code: int
    stdout: str
    stderr: str


class SandboxProvider(ABC):
    """
    Abstract interface for ephemeral compute sandboxes (Docker, MicroVMs, K8s Pods, or Tempfs).
    """

    @abstractmethod
    async def create_sandbox(
        self,
        task_id: str,
        repo_name: Optional[str] = None,
        repo_url: Optional[str] = None,
        branch: Optional[str] = None,
        commit_sha: Optional[str] = None
    ) -> SandboxContext:
        """Provisions an ephemeral sandbox and shallow-clones the target repo/branch."""
        pass

    @abstractmethod
    async def run_command(self, context: SandboxContext, command: str, timeout: int = 60) -> CommandResult:
        """Executes a shell command inside the sandbox."""
        pass

    @abstractmethod
    async def read_file(self, context: SandboxContext, file_path: str) -> str:
        """Reads a file from the sandbox filesystem."""
        pass

    @abstractmethod
    async def write_file(self, context: SandboxContext, file_path: str, content: str) -> int:
        """Writes content to a file inside the sandbox."""
        pass

    @abstractmethod
    async def list_dir(self, context: SandboxContext, subpath: str = ".") -> List[Dict[str, Any]]:
        """Lists directory items inside the sandbox."""
        pass

    @abstractmethod
    async def get_git_diff(self, context: SandboxContext) -> List[Dict[str, Any]]:
        """Retrieves git diff from the sandbox workspace."""
        pass

    @abstractmethod
    async def destroy_sandbox(self, context: SandboxContext) -> bool:
        """Terminates and completely wipes the ephemeral sandbox."""
        pass

    @abstractmethod
    async def destroy_by_task_id(self, task_id: str, workspace_path: Optional[str] = None) -> bool:
        """Terminates and wipes the sandbox directory for a given task ID."""
        pass

    async def fork_sandbox(
        self,
        parent_context: SandboxContext,
        new_task_id: str
    ) -> SandboxContext:
        """
        Forks an existing sandbox into a new isolated sub-sandbox (CoW branch) in sub-10ms.
        Default implementation clones the parent directory if CoW is not natively supported.
        """
        raise NotImplementedError("Forking not implemented for this sandbox provider")

    async def create_snapshot(self, context: SandboxContext, snapshot_tag: str) -> Optional[str]:
        """
        Creates an atomic filesystem snapshot pointer for the current turn.
        Returns the snapshot identifier / tag.
        """
        return None

    async def rollback_snapshot(self, context: SandboxContext, snapshot_tag: str) -> bool:
        """
        Rolls back the sandbox filesystem to the specified snapshot pointer in <5ms.
        """
        return False

    async def promote_warm_cache(self, context: SandboxContext, cache_key: Optional[str] = None) -> bool:
        """
        Promotes the current sandbox state (e.g. post npm install / build caches) to the shared warm repository cache tier.
        """
        return False

    async def get_cow_metrics(self, context: SandboxContext) -> Dict[str, Any]:
        """
        Returns Copy-on-Write layer metrics (lowerdir base bytes, upperdir diff bytes, savings percentage).
        """
        return {
            "mode": "standard_directory",
            "is_cow_active": False,
            "base_size_bytes": 0,
            "diff_size_bytes": 0,
            "shared_savings_bytes": 0,
            "snapshot_count": 0
        }
