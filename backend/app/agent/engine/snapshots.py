import os
import logging
import subprocess
from pathlib import Path
from typing import Dict, Optional, Any

logger = logging.getLogger(__name__)


def _get_isolated_git_env() -> Dict[str, str]:
    env = dict(os.environ)
    env["GIT_CONFIG_GLOBAL"] = "/dev/null"
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    return env


def ensure_workspace_git_repo(ws_path: Optional[Path], branch: Optional[str] = None) -> bool:
    """
    Ensures the workspace is initialized as a git repository for turn snapshots.
    Defaults root branch to \x27main\x27 (never legacy \x27master\x27), and switches to \x27branch\x27 if specified.
    """
    try:
        if not ws_path or not ws_path.exists():
            return False
        git_dir = ws_path / ".git"
        git_env = _get_isolated_git_env()
        if not git_dir.exists():
            subprocess.run(["git", "init", "-b", "main"], cwd=str(ws_path), capture_output=True, text=True, timeout=5, env=git_env)
            subprocess.run(["git", "config", "user.name", "Cyclode Agent"], cwd=str(ws_path), capture_output=True, text=True, timeout=5, env=git_env)
            subprocess.run(["git", "config", "user.email", "agent@cyclode.local"], cwd=str(ws_path), capture_output=True, text=True, timeout=5, env=git_env)
            subprocess.run(["git", "add", "-A"], cwd=str(ws_path), capture_output=True, text=True, timeout=5, env=git_env)
            subprocess.run(["git", "commit", "-m", "initial workspace commit", "--allow-empty"], cwd=str(ws_path), capture_output=True, text=True, timeout=5, env=git_env)
            subprocess.run(["git", "branch", "-M", "main"], cwd=str(ws_path), capture_output=True, text=True, timeout=5, env=git_env)
        else:
            # Auto-rename legacy \x27master\x27 branch to \x27main\x27
            curr_res = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=str(ws_path), capture_output=True, text=True, timeout=5, env=git_env)
            if curr_res.stdout.strip() == "master":
                subprocess.run(["git", "branch", "-M", "main"], cwd=str(ws_path), capture_output=True, text=True, timeout=5, env=git_env)

        # Exclude internal artifacts in .git/info/exclude
        exclude_file = git_dir / "info" / "exclude"
        if exclude_file.parent.exists():
            try:
                existing = exclude_file.read_text(encoding="utf-8") if exclude_file.exists() else ""
                patterns = [".cyclode*", ".cyclode_symbols_cache.json", ".DS_Store"]
                missing = [p for p in patterns if p not in existing]
                if missing:
                    with open(exclude_file, "a", encoding="utf-8") as ef:
                        if existing and not existing.endswith("\n"):
                            ef.write("\n")
                        for m in missing:
                            ef.write(f"{m}\n")
            except Exception:
                pass

        # Switch to target task branch if specified
        if branch and branch != "master":
            subprocess.run(["git", "checkout", "-B", branch], cwd=str(ws_path), capture_output=True, text=True, timeout=5, env=git_env)

        return True
    except Exception as e:
        logger.debug(f"ensure_workspace_git_repo error: {e}")
        return False


def create_turn_snapshot(ws_path: Optional[Path], turn_idx: Any) -> Optional[str]:
    """Creates a git commit snapshot for turn_idx and returns the commit SHA."""
    try:
        if not ws_path or not ws_path.exists() or not ensure_workspace_git_repo(ws_path):
            return None
        git_env = _get_isolated_git_env()
        subprocess.run(["git", "add", "-A"], cwd=str(ws_path), capture_output=True, text=True, timeout=5, env=git_env)
        tag = f"cyclode:turn_{turn_idx}" if not str(turn_idx).startswith("cyclode:") else str(turn_idx)
        subprocess.run(["git", "commit", "-m", tag, "--allow-empty"], cwd=str(ws_path), capture_output=True, text=True, timeout=5, env=git_env)
        rev = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(ws_path), capture_output=True, text=True, timeout=5, env=git_env)
        if rev.returncode == 0:
            return rev.stdout.strip()
    except Exception as e:
        logger.debug(f"create_turn_snapshot error: {e}")
    return None


def rollback_workspace_to_commit(ws_path: Optional[Path], git_sha: str) -> bool:
    """Rolls back the workspace filesystem to git_sha, removing all added/modified/deleted files."""
    try:
        if not ws_path or not ws_path.exists():
            return False
        git_env = _get_isolated_git_env()
        subprocess.run(["git", "reset", "--hard", git_sha], cwd=str(ws_path), capture_output=True, text=True, timeout=10, env=git_env)
        subprocess.run(["git", "clean", "-fd"], cwd=str(ws_path), capture_output=True, text=True, timeout=10, env=git_env)
        return True
    except Exception as e:
        logger.error(f"rollback_workspace_to_commit error: {e}")
        return False
