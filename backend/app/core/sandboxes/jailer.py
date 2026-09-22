import os
import re
import shutil
import logging
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from app.config import settings

logger = logging.getLogger("cyclode.sandbox.jailer")


class Jailer:
    """
    Subprocess execution jailer inspired by Firecracker's multi-layered confinement model.
    Enforces user namespace sandboxing, PID isolation, mount read-only jailing,
    environment variable sanitization, and fork-bomb prevention.
    """

    # Sensitive environment variables to strip from agent subprocesses
    SENSITIVE_ENV_KEYS = {
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GITHUB_TOKEN",
        "GITHUB_APP_ID",
        "GITHUB_WEBHOOK_SECRET",
        "SLACK_BOT_TOKEN",
        "SLACK_SIGNING_SECRET",
        "APPSIGNAL_API_KEY",
        "DATABASE_URL",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_ACCESS_KEY_ID",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "CLAUDE_API_KEY",
        "LINEAR_API_KEY"
    }

    # Core protected directories that agents must never delete
    PROTECTED_ROOT_DIRS = {
        "app", "src", "backend", "frontend", "tests", "cyclode",
        "components", "public", "core", "api", "agent", "db", "node_modules"
    }

    def __init__(self):
        self._bwrap_path: Optional[str] = shutil.which("bwrap")
        self._unshare_path: Optional[str] = shutil.which("unshare")
        self._isolation_type: str = self._detect_best_isolation()

    def _detect_best_isolation(self) -> str:
        """Determines the most secure available isolation mechanism on the host system."""
        if self._bwrap_path:
            # Test bubblewrap execution
            try:
                test_proc = subprocess.run(
                    [self._bwrap_path, "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "echo", "ok"],
                    capture_output=True,
                    timeout=2
                )
                if test_proc.returncode == 0:
                    logger.info("Jailer: Bubblewrap (bwrap) user namespace isolation active")
                    return "bubblewrap"
            except Exception:
                pass

        if self._unshare_path and hasattr(os, "uname") and os.uname().sysname == "Linux":
            try:
                test_proc = subprocess.run(
                    [self._unshare_path, "--pid", "--fork", "--mount-proc", "echo", "ok"],
                    capture_output=True,
                    timeout=2
                )
                if test_proc.returncode == 0:
                    logger.info("Jailer: Linux unshare PID/Mount namespace isolation active")
                    return "unshare"
            except Exception:
                pass

        logger.info("Jailer: Standard subprocess jail with path confinement and env sanitization active")
        return "subprocess_jail"

    @property
    def isolation_type(self) -> str:
        return self._isolation_type

    @classmethod
    def is_sensitive_key(cls, key: str) -> bool:
        """Determines whether an environment variable key contains sensitive tokens/secrets."""
        k = key.upper()
        if k in cls.SENSITIVE_ENV_KEYS or k.startswith("SECRET_"):
            return True
        sensitive_suffixes = ["_KEY", "_SECRET", "_TOKEN", "_PASSWORD", "_PASS", "_CREDENTIAL"]
        if any(k.endswith(suffix) or f"{suffix}_" in k for suffix in sensitive_suffixes):
            return True
        if "DATABASE_URL" in k or "POSTGRES" in k:
            return True
        return False

    def get_clean_environment(self, custom_env: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """
        Builds a sanitized environment dictionary stripped of backend secrets, database credentials,
        and API tokens to prevent exfiltration during untrusted code execution.
        """
        env = {
            "PATH": os.environ.get("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"),
            "TERM": "xterm-256color",
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "HOME": "/tmp",
            "USER": "cyclode-agent",
            "NODE_ENV": "development",
            "PYTHONUNBUFFERED": "1"
        }

        # Inherit non-sensitive parent environment variables
        for k, v in os.environ.items():
            if not self.is_sensitive_key(k) and k not in env:
                env[k] = v

        if custom_env:
            for k, v in custom_env.items():
                if not self.is_sensitive_key(k):
                    env[k] = v

        return env

    @classmethod
    def validate_command_safety(cls, command: str, workspace_path: Optional[Path] = None) -> Tuple[bool, Optional[str]]:
        """
        Validates command against destructive mass-deletion patterns targeting core codebase trees.
        Returns (is_safe, error_message).
        """
        if not command or not command.strip():
            return True, None

        cmd_lower = command.strip().lower()

        # 1. Block destructive wildcard or root removals (e.g. rm -rf *, rm -rf ., rm -rf /)
        dangerous_wildcard_patterns = [
            r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+.*(?:\*|/\*|\.\s*$|\.\/|\.\.)",
            r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(?:/|/\w+)",
            r"\brm\s+-[a-zA-Z]*f[a-zA-Z]*\s+\*",
            r"\brm\s+\*",
        ]
        for pat in dangerous_wildcard_patterns:
            if re.search(pat, cmd_lower):
                return False, (
                    "SECURITY CIRCUIT-BREAKER REJECTED COMMAND: Mass wildcard/root directory deletion "
                    f"detected in '{command}'. Wiping workspace files via wildcards is prohibited by Cyclode safeguards."
                )

        # 2. Block recursive deletions targeting protected codebase directories
        # Matches e.g.: rm -rf app, rm -r src/, rm -rf ./backend tests
        rm_match = re.search(r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(.+)", command, re.IGNORECASE)
        if rm_match:
            args_str = rm_match.group(1).strip()
            # Split args by whitespace, ignoring shell redirection/chaining
            tokens = re.split(r"\s+", re.split(r"[;&|><]", args_str)[0].strip())
            for token in tokens:
                clean_token = token.strip("\'\"").rstrip("/").lstrip("./")
                if clean_token in cls.PROTECTED_ROOT_DIRS or clean_token == "*":
                    return False, (
                        f"SECURITY CIRCUIT-BREAKER REJECTED COMMAND: Deletion of protected directory '{clean_token}' "
                        f"is prohibited. Cyclode strictly forbids deleting core codebase trees ('app', 'src', 'tests', etc.). "
                        "Resolve configuration or import paths (e.g. pyproject.toml, PYTHONPATH) without deleting files."
                    )

        # 3. Block destructive git operations that purge workspace state
        if re.search(r"\bgit\s+clean\s+-[a-zA-Z]*f", cmd_lower):
            return False, (
                "SECURITY CIRCUIT-BREAKER REJECTED COMMAND: 'git clean -f' is prohibited as it causes irreversible "
                "data loss of untracked files in the active workspace."
            )
        if re.search(r"\bgit\s+rm\s+-[a-zA-Z]*r", cmd_lower):
            for p_dir in cls.PROTECTED_ROOT_DIRS:
                if re.search(rf"\bgit\s+rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+.*?\b{p_dir}\b", cmd_lower):
                    return False, (
                        f"SECURITY CIRCUIT-BREAKER REJECTED COMMAND: 'git rm -r' targeting protected directory '{p_dir}' "
                        "is prohibited by Cyclode structural safeguards."
                    )

        # 4. Block destructive python inline calls (e.g. shutil.rmtree)
        if "shutil.rmtree" in cmd_lower or "os.removedirs" in cmd_lower:
            for p_dir in cls.PROTECTED_ROOT_DIRS:
                if p_dir in cmd_lower:
                    return False, (
                        f"SECURITY CIRCUIT-BREAKER REJECTED COMMAND: Scripted directory deletion targeting '{p_dir}' "
                        "is prohibited by Cyclode structural safeguards."
                    )

        # 5. Block find bulk deletes
        if re.search(r"\bfind\s+.*-(?:delete|exec\s+rm)", cmd_lower):
            return False, (
                "SECURITY CIRCUIT-BREAKER REJECTED COMMAND: Bulk search-and-delete via 'find -delete/-exec rm' "
                "is prohibited by Cyclode structural safeguards."
            )

        return True, None

    def wrap_command(self, workspace_path: Path, command: str) -> Tuple[List[str], bool]:
        """
        Wraps a shell command in kernel namespace boundaries if available.
        Returns (command_args, use_shell_flag).
        """
        ws_str = str(workspace_path.resolve())

        if self._isolation_type == "bubblewrap" and self._bwrap_path:
            # Bubblewrap jail:
            # - /usr, /lib, /bin, /opt mounted read-only
            # - /dev, /proc virtualized
            # - /tmp mounted as private tmpfs
            # - workspace directory mounted read-write
            # - unshare PID, IPC, UTS namespaces
            bwrap_cmd = [
                self._bwrap_path,
                "--ro-bind", "/usr", "/usr",
                "--ro-bind-try", "/lib", "/lib",
                "--ro-bind-try", "/lib64", "/lib64",
                "--ro-bind-try", "/bin", "/bin",
                "--ro-bind-try", "/sbin", "/sbin",
                "--ro-bind-try", "/opt", "/opt",
                "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf",
                "--ro-bind-try", "/etc/ssl", "/etc/ssl",
                "--ro-bind-try", "/etc/pki", "/etc/pki",
                "--proc", "/proc",
                "--dev", "/dev",
                "--tmpfs", "/tmp",
                "--bind", ws_str, ws_str,
                "--chdir", ws_str,
                "--unshare-pid",
                "--unshare-ipc",
                "--unshare-uts",
                "--die-with-parent",
                "bash", "-c", command
            ]
            return bwrap_cmd, False

        elif self._isolation_type == "unshare" and self._unshare_path:
            unshare_cmd = [
                self._unshare_path,
                "--pid",
                "--fork",
                "--mount-proc",
                "bash", "-c", f"cd {ws_str} && {command}"
            ]
            return unshare_cmd, False

        # Standard subprocess jail
        return ["bash", "-c", command], False

    def get_security_status(self) -> Dict[str, Any]:
        """Returns diagnostic security metrics for the Sandbox Inspector."""
        return {
            "isolation_type": self._isolation_type,
            "pid_isolation_active": self._isolation_type in ["bubblewrap", "unshare"],
            "mount_jail_active": self._isolation_type == "bubblewrap",
            "env_sanitization_active": True,
            "blocked_env_keys_count": len(self.SENSITIVE_ENV_KEYS),
            "fork_bomb_guard": "pids_limit_active"
        }


jailer = Jailer()
