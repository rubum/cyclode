import os
import time
import shutil
import asyncio
import logging
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

logger = logging.getLogger("cyclode.sandbox.container.client")


class ContainerClient:
    """
    Auto-detects and connects to available OCI container runtimes (Podman, Docker Desktop, Colima).
    Supports Unix domain sockets, environment overrides, and CLI execution paths.
    """

    KNOWN_SOCKET_PATHS = [
        # Podman User Sockets (Linux rootless & macOS)
        Path(os.environ.get("XDG_RUNTIME_DIR", "/tmp")) / "podman" / "podman.sock",
        Path.home() / ".local" / "share" / "containers" / "podman" / "machine" / "podman.sock",
        Path("/run/user") / str(os.getuid() if hasattr(os, "getuid") else 1000) / "podman" / "podman.sock",
        # Colima Socket (macOS)
        Path.home() / ".colima" / "default" / "docker.sock",
        Path.home() / ".colima" / "docker.sock",
        # Standard Docker Sockets
        Path("/var/run/docker.sock"),
        Path.home() / ".docker" / "run" / "docker.sock",
    ]

    def __init__(self, preferred_engine: Optional[str] = None):
        self.preferred_engine = preferred_engine or os.environ.get("SANDBOX_CONTAINER_ENGINE", "auto").lower()
        self._binary_path: Optional[str] = None
        self._engine_type: Optional[str] = None
        self._socket_path: Optional[Path] = None
        self._is_ready: Optional[bool] = None
        self._version_info: Dict[str, Any] = {}
        self._last_ping_time: float = 0.0
        self._ping_cache_ttl: float = 10.0
        self._cached_available: bool = False
        self._probe_runtime()

    def _probe_runtime(self) -> None:
        """Discovers local container runtime binaries and active sockets."""
        # 1. Custom DOCKER_HOST / CONTAINER_HOST
        custom_host = os.environ.get("DOCKER_HOST") or os.environ.get("CONTAINER_HOST")
        if custom_host and custom_host.startswith("unix://"):
            cand = Path(custom_host.replace("unix://", ""))
            if cand.exists():
                self._socket_path = cand
                self._engine_type = "podman" if "podman" in custom_host.lower() else "docker"

        # 2. Check binary paths
        docker_bin = shutil.which("docker")
        podman_bin = shutil.which("podman")

        if self.preferred_engine == "podman" and podman_bin:
            self._binary_path = podman_bin
            self._engine_type = "podman"
        elif self.preferred_engine == "docker" and docker_bin:
            self._binary_path = docker_bin
            self._engine_type = "docker"
        else:
            if podman_bin:
                self._binary_path = podman_bin
                self._engine_type = "podman"
            elif docker_bin:
                self._binary_path = docker_bin
                self._engine_type = "docker"

        # 3. Discover active socket if not already discovered
        if not self._socket_path:
            for sock in self.KNOWN_SOCKET_PATHS:
                try:
                    if sock.exists():
                        self._socket_path = sock
                        if not self._engine_type:
                            self._engine_type = "podman" if "podman" in str(sock).lower() else "docker"
                        break
                except Exception:
                    continue

    @property
    def engine_type(self) -> str:
        return self._engine_type or "none"

    @property
    def binary_path(self) -> Optional[str]:
        return self._binary_path

    @property
    def socket_path(self) -> Optional[Path]:
        return self._socket_path

    async def is_available(self, force_refresh: bool = False) -> bool:
        """Pings the container runtime to verify healthy daemon execution with TTL caching."""
        if not self._binary_path and not self._socket_path:
            return False

        now = time.monotonic()
        if not force_refresh and (now - self._last_ping_time < self._ping_cache_ttl):
            return self._cached_available

        if self._binary_path:
            try:
                proc = await asyncio.create_subprocess_exec(
                    self._binary_path, "info", "--format", "{{.ServerVersion}}",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=3.0)
                if proc.returncode == 0:
                    self._is_ready = True
                    self._version_info["version"] = stdout.decode().strip()
                    self._cached_available = True
                    self._last_ping_time = now
                    return True
            except Exception as e:
                logger.debug(f"Container runtime ping error on {self._binary_path}: {e}")

        self._cached_available = False
        self._last_ping_time = now
        return False

    async def run_cli(
        self,
        args: list[str],
        cwd: Optional[Path] = None,
        timeout: float = 60.0,
        env: Optional[Dict[str, str]] = None
    ) -> Tuple[int, str, str]:
        """
        Executes a container command using the discovered runtime binary.
        """
        if not self._binary_path:
            return 127, "", "No OCI container runtime (docker/podman) discovered on host"

        full_cmd = [self._binary_path] + args
        clean_env = dict(os.environ)
        if env:
            clean_env.update(env)

        proc = None
        try:
            proc = await asyncio.create_subprocess_exec(
                *full_cmd,
                cwd=str(cwd) if cwd else None,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=clean_env
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            out_str = stdout.decode(errors="replace")
            err_str = stderr.decode(errors="replace")
            return proc.returncode if proc.returncode is not None else 0, out_str, err_str
        except asyncio.TimeoutError:
            if proc:
                try:
                    proc.kill()
                except Exception:
                    pass
            return 124, "", f"Container operation timed out after {timeout}s"
        except asyncio.CancelledError:
            if proc:
                try:
                    proc.kill()
                except Exception:
                    pass
            raise
        except Exception as e:
            return 1, "", f"Container execution error: {e}"


container_client = ContainerClient()
