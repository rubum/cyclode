import os
import shutil
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional
from app.config import settings


class WorktreeManager:
    def __init__(self, root_dir: Optional[str] = None):
        target = Path(root_dir or settings.WORKSPACE_ROOT)
        try:
            target.mkdir(parents=True, exist_ok=True)
            self.root_dir = target
        except Exception:
            fallback = Path("/tmp/workspaces")
            fallback.mkdir(parents=True, exist_ok=True)
            self.root_dir = fallback

    def get_task_workspace_path(self, task_id: str) -> Path:
        path = self.root_dir / f"task-{task_id}"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def init_sample_repo_if_needed(self, path: Path, sample_type: str = "python_service"):
        """
        Creates a sample repository in the workspace if empty, so agents have files to inspect and test.
        """
        path.mkdir(parents=True, exist_ok=True)
        if not (path / ".git").exists():
            subprocess.run(["git", "init"], cwd=path, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Cyclode Agent"], cwd=path, capture_output=True)
            subprocess.run(["git", "config", "user.email", "agent@cyclode.ai"], cwd=path, capture_output=True)
            
            # Create sample codebase
            src_dir = path / "app"
            tests_dir = path / "tests"
            src_dir.mkdir(exist_ok=True)
            tests_dir.mkdir(exist_ok=True)

            auth_service = src_dir / "auth_service.py"
            if not auth_service.exists():
                auth_service.write_text(
                    'class AuthService:\n'
                    '    def get_user_display_name(self, user_dict):\n'
                    '        # Bug: NullPointerException when profile is missing\n'
                    '        profile = user_dict["profile"]\n'
                    '        return profile["name"]\n'
                )

            test_auth = tests_dir / "test_auth_service.py"
            if not test_auth.exists():
                test_auth.write_text(
                    'import unittest\n'
                    'from app.auth_service import AuthService\n\n'
                    'class TestAuthService(unittest.TestCase):\n'
                    '    def setUp(self):\n'
                    '        self.auth = AuthService()\n\n'
                    '    def test_valid_profile(self):\n'
                    '        user = {"profile": {"name": "Alice"}}\n'
                    '        self.assertEqual(self.auth.get_user_display_name(user), "Alice")\n'
                )

            subprocess.run(["git", "add", "."], cwd=path, capture_output=True)
            subprocess.run(["git", "commit", "-m", "initial commit"], cwd=path, capture_output=True)

    def get_git_diff(self, workspace_path: Path) -> List[Dict[str, Any]]:
        """
        Extracts current git diff from the workspace path.
        """
        if not (workspace_path / ".git").exists():
            return []

        try:
            # Check unstaged and staged diff
            diff_proc = subprocess.run(
                ["git", "diff", "HEAD"],
                cwd=workspace_path,
                capture_output=True,
                text=True,
                timeout=10
            )
            raw_diff = diff_proc.stdout

            # Parse files from diff
            diffs = []
            if raw_diff:
                files_proc = subprocess.run(
                    ["git", "diff", "--name-status", "HEAD"],
                    cwd=workspace_path,
                    capture_output=True,
                    text=True
                )
                for line in files_proc.stdout.strip().splitlines():
                    if not line:
                        continue
                    parts = line.split(maxsplit=1)
                    status = parts[0]
                    file_name = parts[1] if len(parts) > 1 else ""
                    
                    # Estimate additions/deletions
                    numstat = subprocess.run(
                        ["git", "diff", "--numstat", "HEAD", "--", file_name],
                        cwd=workspace_path,
                        capture_output=True,
                        text=True
                    )
                    adds, dels = 0, 0
                    if numstat.stdout.strip():
                        stat_parts = numstat.stdout.strip().split()
                        if len(stat_parts) >= 2:
                            adds = int(stat_parts[0]) if stat_parts[0].isdigit() else 0
                            dels = int(stat_parts[1]) if stat_parts[1].isdigit() else 0

                    diffs.append({
                        "file_path": file_name,
                        "status": status,
                        "diff_content": raw_diff,
                        "additions": adds,
                        "deletions": dels
                    })
            return diffs
        except Exception:
            return []

    def cleanup_workspace(self, task_id: str):
        path = self.root_dir / f"task-{task_id}"
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)


worktree_manager = WorktreeManager()
