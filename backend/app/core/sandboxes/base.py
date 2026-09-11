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
