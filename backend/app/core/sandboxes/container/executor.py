import logging
from typing import Optional, Dict, Any
from app.core.sandboxes.container.client import container_client
from app.core.sandboxes.base import CommandResult

logger = logging.getLogger("cyclode.sandbox.container.executor")


class ContainerExecutor:
    """
    Executes shell commands inside running container sandboxes with output compaction and timeouts.
    """

    def __init__(self, client=None):
        self.client = client or container_client

    async def execute_command(
        self,
        container_id: str,
        command: str,
        workdir: str = "/workspace",
        timeout: int = 120,
        env: Optional[Dict[str, str]] = None
    ) -> CommandResult:
        """
        Executes a shell command inside the specified container.
        """
        args = ["exec", "-w", workdir]
        if env:
            for k, v in env.items():
                args.extend(["-e", f"{k}={v}"])
        args.extend([container_id, "/bin/sh", "-c", command])

        code, stdout, stderr = await self.client.run_cli(args=args, timeout=float(timeout))
        return CommandResult(
            command=command,
            exit_code=code,
            stdout=stdout,
            stderr=stderr
        )


container_executor = ContainerExecutor()
