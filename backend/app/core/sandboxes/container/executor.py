import logging
from typing import Optional, Dict, Any
from app.core.sandboxes.container.client import container_client
from app.core.sandboxes.base import CommandResult

from app.core.sandboxes.container.daemon import dispatch_daemon_command

logger = logging.getLogger("cyclode.sandbox.container.executor")


class ContainerExecutor:
    """
    Executes shell commands inside running container sandboxes with output compaction and timeouts.
    Prioritizes ultra-fast in-container daemon IPC (<2ms) with seamless fallback to docker exec.
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
        # 1. Attempt ultra-fast execution via in-container daemon (<2ms)
        clean_task_id = container_id.replace("cyclode-sb-", "")
        daemon_res = await dispatch_daemon_command(
            task_id=clean_task_id,
            command=command,
            workdir=workdir,
            timeout=float(timeout),
            env=env
        )
        if daemon_res is not None:
            return daemon_res

        # 2. Fall back to standard CLI exec if daemon is unavailable
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
