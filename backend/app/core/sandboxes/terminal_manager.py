import asyncio
import os
import pty
import fcntl
import termios
import struct
import signal
import shutil
import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List, Set

from app.core.sandboxes.jailer import jailer
from app.core.sandboxes.container.client import container_client
from app.core.sandboxes.container.lifecycle import container_lifecycle
from app.api.websocket import ws_manager

logger = logging.getLogger("cyclode.terminal")


class TerminalSession:
    """
    Represents an active POSIX pseudo-terminal (PTY) session attached to a task's sandbox workspace.
    """

    def __init__(
        self,
        session_id: str,
        task_id: str,
        workspace_path: Path,
        master_fd: int,
        process: subprocess.Popen,
        shell_path: str,
        runtime_mode: str = "local",
        container_name: Optional[str] = None,
        rc_file_path: Optional[Path] = None,
        initial_cols: int = 80,
        initial_rows: int = 24,
    ):
        self.session_id = session_id
        self.task_id = task_id
        self.workspace_path = workspace_path
        self.master_fd = master_fd
        self.process = process
        self.shell_path = shell_path
        self.runtime_mode = runtime_mode
        self.container_name = container_name
        self.rc_file_path = rc_file_path
        self.cols = initial_cols
        self.rows = initial_rows
        self.created_at = datetime.now(timezone.utc)
        self.is_alive = True
        self.scrollback_buffer: List[str] = []
        self._max_scrollback_chars = 250_000
        self._current_buffer_len = 0
        self.exit_code: Optional[int] = None
        self.read_task: Optional[asyncio.Task] = None

    def append_output(self, data: str):
        """Appends output to memory ring buffer for session reconnect/tab switch recovery."""
        if not data:
            return
        self.scrollback_buffer.append(data)
        self._current_buffer_len += len(data)
        while self._current_buffer_len > self._max_scrollback_chars and len(self.scrollback_buffer) > 1:
            popped = self.scrollback_buffer.pop(0)
            self._current_buffer_len -= len(popped)

    def get_scrollback(self) -> str:
        return "".join(self.scrollback_buffer)

    def to_dict(self) -> Dict[str, Any]:
        shell_name = Path(self.shell_path).name
        return {
            "session_id": self.session_id,
            "task_id": self.task_id,
            "shell": shell_name,
            "shell_path": self.shell_path,
            "runtime_mode": self.runtime_mode,
            "container_name": self.container_name,
            "workspace_path": str(self.workspace_path),
            "cols": self.cols,
            "rows": self.rows,
            "is_alive": self.is_alive,
            "pid": self.process.pid if self.process else None,
            "exit_code": self.exit_code,
            "created_at": self.created_at.isoformat(),
        }


class TerminalManager:
    """
    Central manager for bi-directional POSIX pseudo-terminals running inside sandboxes.
    Supports local CoW workspaces and direct OCI companion container bridging.
    """

    def __init__(self):
        # Maps session_id -> TerminalSession
        self.sessions: Dict[str, TerminalSession] = {}
        # Maps task_id -> Set[session_id]
        self.task_sessions: Dict[str, Set[str]] = {}

    def _resolve_shell(self) -> str:
        """Determines best interactive shell executable available on the host system."""
        candidates = ["/bin/zsh", "/usr/bin/zsh", "/bin/bash", "/usr/bin/bash", "/bin/sh"]
        for cand in candidates:
            if os.path.exists(cand) and os.access(cand, os.X_OK):
                return cand
        sh_path = shutil.which("zsh") or shutil.which("bash") or shutil.which("sh")
        return sh_path or "/bin/sh"

    async def _check_container_companion(self, task_id: str) -> Optional[str]:
        """Checks if an isolated OCI companion container is active for this task."""
        container_name = container_lifecycle.get_container_name(task_id)
        if await container_client.is_available():
            try:
                code, out, _ = await container_client.run_cli(
                    ["inspect", "--format", "{{.State.Running}}", container_name],
                    timeout=2.0
                )
                if code == 0 and out.strip().lower() == "true":
                    return container_name
            except Exception:
                pass
        return None

    async def spawn_session(
        self,
        task_id: str,
        workspace_path: Path,
        session_id: Optional[str] = None,
        cols: int = 80,
        rows: int = 24,
        custom_shell: Optional[str] = None,
    ) -> TerminalSession:
        """
        Spawns a new POSIX master/slave PTY attached to the task sandbox workspace or companion container.
        """
        if not session_id:
            import uuid
            session_id = f"term-{uuid.uuid4().hex[:8]}"

        # Close existing session with same ID if any
        if session_id in self.sessions:
            await self.kill_session(session_id)

        ws_dir = workspace_path.resolve()
        if not ws_dir.exists():
            ws_dir.mkdir(parents=True, exist_ok=True)

        # Check for running OCI container companion
        companion_container = await self._check_container_companion(task_id)

        # Build clean environment with secret redaction and extended language toolchains
        expanded_path = (
            "/root/.cargo/bin:/root/.local/bin:/usr/local/go/bin:/usr/local/sbin:"
            "/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:"
            f"{ws_dir}/node_modules/.bin"
        )
        env = jailer.get_clean_environment({
            "TERM": "xterm-256color",
            "COLORTERM": "truecolor",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_CONFIG_NOSYSTEM": "1",
            "PATH": expanded_path,
            "HOME": str(ws_dir),
            "PWD": str(ws_dir),
            "CYCLODE_SANDBOX": "1",
            "CYCLODE_TASK_ID": task_id,
            "CYCLODE_SESSION_ID": session_id,
        })

        rc_file_path: Optional[Path] = None
        runtime_mode = "local"
        spawn_cmd: List[str] = []
        shell = custom_shell or self._resolve_shell()

        # Generate tailored developer bootstrap rcfile with aliases & clean Starship prompt
        rc_file_path = ws_dir / f".cyclode_rc_{session_id}.sh"
        rc_content = f"""
if [ -f /etc/bash.bashrc ]; then . /etc/bash.bashrc 2>/dev/null; fi
if [ -f ~/.bashrc ]; then . ~/.bashrc 2>/dev/null; fi

export PATH="{expanded_path}:$PATH"
alias la='ls -la --color=auto 2>/dev/null || ls -la'
alias ll='ls -lF --color=auto 2>/dev/null || ls -l'
alias l='ls -CF --color=auto 2>/dev/null || ls'
alias gs='git status -sb 2>/dev/null || git status'
alias gd='git diff 2>/dev/null || true'
alias gl='git log --oneline -n 15 2>/dev/null || true'
alias gp='git push'
alias cls='clear'

__cyclode_prompt() {{
    local branch=""
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        branch=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null)
    fi
    if [ -n "$branch" ]; then
        printf "\\033[1;33m(%s)\\033[0m " "$branch"
    fi
}}

export PS1='\\[\\033[1;34m\\]\\w\\[\\033[0m\\] $(__cyclode_prompt)\\[\\033[1;32m\\]❯\\[\\033[0m\\] '
"""
        try:
            rc_file_path.write_text(rc_content.strip())
        except Exception as e:
            logger.warning(f"Failed to write developer rcfile: {e}")

        if companion_container:
            runtime_mode = "container"
            engine_bin = container_client.binary_path or shutil.which("docker") or shutil.which("podman") or "docker"
            container_rc_path = f"/workspace/.cyclode_rc_{session_id}.sh"
            # Launch interactive shell inside companion container with bootstrap rcfile
            spawn_cmd = [
                engine_bin,
                "exec",
                "-it",
                "-e", "TERM=xterm-256color",
                "-e", "COLORTERM=truecolor",
                "-e", "GIT_CONFIG_GLOBAL=/dev/null",
                "-e", "GIT_CONFIG_NOSYSTEM=1",
                "-e", "CYCLODE_SANDBOX=1",
                "-w", "/workspace",
                companion_container,
                "/bin/bash",
                "--rcfile", container_rc_path,
                "-i"
            ]
        else:
            runtime_mode = "local"
            if "bash" in Path(shell).name and rc_file_path and rc_file_path.exists():
                spawn_cmd = [shell, "--rcfile", str(rc_file_path), "-i"]
            else:
                spawn_cmd = [shell, "-i"]

        # Create master/slave pseudo-terminal pair
        master_fd, slave_fd = pty.openpty()

        # Set initial terminal window dimensions
        try:
            fcntl.ioctl(
                master_fd,
                termios.TIOCSWINSZ,
                struct.pack("HHHH", rows, cols, 0, 0)
            )
        except Exception as e:
            logger.warning(f"Failed to set initial terminal size: {e}")

        # Spawn child shell process attached to slave_fd
        try:
            proc = subprocess.Popen(
                spawn_cmd,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=str(ws_dir) if runtime_mode == "local" else None,
                env=env,
                preexec_fn=os.setsid,
                close_fds=True,
            )
        except Exception as e:
            os.close(slave_fd)
            os.close(master_fd)
            if rc_file_path and rc_file_path.exists():
                rc_file_path.unlink(missing_ok=True)
            logger.error(f"Failed to spawn shell subprocess for task {task_id}: {e}")
            raise

        # Close slave_fd in parent process so EOF propagates when child terminates
        os.close(slave_fd)

        session = TerminalSession(
            session_id=session_id,
            task_id=task_id,
            workspace_path=ws_dir,
            master_fd=master_fd,
            process=proc,
            shell_path=shell,
            runtime_mode=runtime_mode,
            container_name=companion_container,
            rc_file_path=rc_file_path,
            initial_cols=cols,
            initial_rows=rows,
        )

        self.sessions[session_id] = session
        if task_id not in self.task_sessions:
            self.task_sessions[task_id] = set()
        self.task_sessions[task_id].add(session_id)

        # Start asynchronous executor-backed reader worker
        self._start_reader_task(session)

        logger.info(
            f"Spawned terminal session {session_id} (mode={runtime_mode}, PID {proc.pid}) "
            f"for task {task_id} at {ws_dir}"
        )
        return session

    def _start_reader_task(self, session: TerminalSession):
        """Starts an asynchronous worker task that streams output from the master PTY descriptor via thread pool executor."""
        loop = asyncio.get_running_loop()

        async def _read_worker():
            master_fd = session.master_fd
            try:
                while session.is_alive:
                    # Blocking read executed in background thread pool to avoid uvloop epoll PTY assertion crashes
                    data = await loop.run_in_executor(None, os.read, master_fd, 4096)
                    if not data:
                        break
                    text = data.decode("utf-8", errors="replace")
                    session.append_output(text)

                    # Broadcast to connected WebSocket clients
                    await ws_manager.broadcast_task_event(
                        session.task_id,
                        "TERMINAL_OUTPUT",
                        {
                            "session_id": session.session_id,
                            "data": text,
                        }
                    )
            except (asyncio.CancelledError, GeneratorExit):
                pass
            except OSError as e:
                # EIO or EBADF on PTY closure
                logger.debug(f"Terminal session {session.session_id} PTY read closed: {e}")
            except Exception as e:
                logger.warning(f"Unexpected error reading terminal session {session.session_id}: {e}")
            finally:
                if session.is_alive:
                    self._handle_session_eof(session)

        session.read_task = asyncio.create_task(_read_worker())

    def _handle_session_eof(self, session: TerminalSession):
        """Cleans up file descriptor and process when shell terminates."""
        if not session.is_alive:
            return
        session.is_alive = False

        exit_code = 0
        if session.process:
            try:
                exit_code = session.process.poll()
                if exit_code is None:
                    session.process.terminate()
                    exit_code = session.process.wait(timeout=0.2)
            except Exception:
                pass

        session.exit_code = exit_code

        if session.read_task and not session.read_task.done():
            session.read_task.cancel()

        try:
            os.close(session.master_fd)
        except Exception:
            pass

        if session.rc_file_path and session.rc_file_path.exists():
            try:
                session.rc_file_path.unlink(missing_ok=True)
            except Exception:
                pass

        # Broadcast exit event
        asyncio.create_task(
            ws_manager.broadcast_task_event(
                session.task_id,
                "TERMINAL_EXIT",
                {
                    "session_id": session.session_id,
                    "return_code": exit_code if exit_code is not None else 0,
                }
            )
        )
        logger.info(f"Terminal session {session.session_id} exited with code {exit_code}")

    async def write_input(self, session_id: str, data: str) -> bool:
        """Writes raw input keystrokes to the terminal master PTY via executor."""
        session = self.sessions.get(session_id)
        if not session or not session.is_alive:
            return False

        try:
            payload = data.encode("utf-8")
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, os.write, session.master_fd, payload)
            return True
        except Exception as e:
            logger.error(f"Error writing to terminal session {session_id}: {e}")
            return False

    def resize_session(self, session_id: str, cols: int, rows: int) -> bool:
        """Resizes the terminal window columns and rows via TIOCSWINSZ ioctl."""
        session = self.sessions.get(session_id)
        if not session or not session.is_alive:
            return False

        try:
            session.cols = max(10, min(cols, 500))
            session.rows = max(4, min(rows, 200))
            fcntl.ioctl(
                session.master_fd,
                termios.TIOCSWINSZ,
                struct.pack("HHHH", session.rows, session.cols, 0, 0)
            )
            return True
        except Exception as e:
            logger.debug(f"Error resizing terminal session {session_id}: {e}")
            return False

    async def kill_session(self, session_id: str, sig: int = signal.SIGTERM) -> bool:
        """Terminates an active session process and frees file descriptors."""
        session = self.sessions.get(session_id)
        if not session:
            return False

        session.is_alive = False

        # 1. Terminate child process group first so slave PTY closes and reader gets EOF
        if session.process:
            try:
                pgid = os.getpgid(session.process.pid)
                os.killpg(pgid, signal.SIGHUP)
                try:
                    session.process.wait(timeout=0.2)
                except subprocess.TimeoutExpired:
                    os.killpg(pgid, signal.SIGKILL)
                    session.process.wait(timeout=0.5)
            except Exception:
                try:
                    session.process.kill()
                    session.process.wait(timeout=0.5)
                except Exception:
                    pass

        # 2. Cancel async read task
        if session.read_task and not session.read_task.done():
            session.read_task.cancel()

        # 3. Now that slave is closed and reader unblocked, close master_fd safely
        try:
            os.close(session.master_fd)
        except Exception:
            pass

        if session.rc_file_path and session.rc_file_path.exists():
            try:
                session.rc_file_path.unlink(missing_ok=True)
            except Exception:
                pass

        self.sessions.pop(session_id, None)
        if session.task_id in self.task_sessions:
            self.task_sessions[session.task_id].discard(session_id)
            if not self.task_sessions[session.task_id]:
                self.task_sessions.pop(session.task_id, None)

        asyncio.create_task(
            ws_manager.broadcast_task_event(
                session.task_id,
                "TERMINAL_EXIT",
                {
                    "session_id": session_id,
                    "return_code": -1,
                }
            )
        )
        return True

    def get_session(self, session_id: str) -> Optional[TerminalSession]:
        return self.sessions.get(session_id)

    def list_task_sessions(self, task_id: str) -> List[Dict[str, Any]]:
        session_ids = self.task_sessions.get(task_id, set())
        result = []
        for s_id in list(session_ids):
            s = self.sessions.get(s_id)
            if s:
                result.append(s.to_dict())
        return result

    async def cleanup_task_sessions(self, task_id: str):
        """Kills and cleans up all active terminal sessions for a task."""
        session_ids = list(self.task_sessions.get(task_id, set()))
        for s_id in session_ids:
            await self.kill_session(s_id)
        self.task_sessions.pop(task_id, None)


terminal_manager = TerminalManager()
