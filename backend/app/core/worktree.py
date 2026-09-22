import os
import re
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

    def _get_git_env(self) -> Dict[str, str]:
        env = dict(os.environ)
        env["GIT_CONFIG_GLOBAL"] = "/dev/null"
        env["GIT_CONFIG_NOSYSTEM"] = "1"
        env["GIT_AUTHOR_NAME"] = "Cyclode Agent"
        env["GIT_AUTHOR_EMAIL"] = "agent@cyclode.ai"
        env["GIT_COMMITTER_NAME"] = "Cyclode Agent"
        env["GIT_COMMITTER_EMAIL"] = "agent@cyclode.ai"
        return env

    def get_task_workspace_path(self, task_id: str) -> Path:
        path = self.root_dir / f"task-{task_id}"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def init_sample_repo_if_needed(self, path: Path, sample_type: str = "python_service"):
        """
        Creates a sample repository in the workspace if empty, so agents have files to inspect and test.
        """
        path.mkdir(parents=True, exist_ok=True)
        git_env = self._get_git_env()
        if not (path / ".git").exists():
            subprocess.run(["git", "init"], cwd=path, capture_output=True, env=git_env)
            subprocess.run(["git", "config", "user.name", "Cyclode Agent"], cwd=path, capture_output=True, env=git_env)
            subprocess.run(["git", "config", "user.email", "agent@cyclode.ai"], cwd=path, capture_output=True, env=git_env)
            
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

            subprocess.run(["git", "add", "."], cwd=path, capture_output=True, env=git_env)
            subprocess.run(["git", "commit", "-m", "initial commit"], cwd=path, capture_output=True, env=git_env)
            subprocess.run(["git", "branch", "-M", "main"], cwd=path, capture_output=True, env=git_env)

    def get_git_branch(self, workspace_path: Path, expected_branch: Optional[str] = None) -> Optional[str]:
        """
        Determines current git branch or HEAD reference for a workspace path.
        If expected_branch is provided (e.g. cyclode/task-...), ensures the workspace
        is checked out to that branch.
        """
        if not (workspace_path / ".git").exists():
            return expected_branch or None
        git_env = self._get_git_env()
        try:
            res = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=workspace_path,
                capture_output=True,
                text=True,
                env=git_env,
                timeout=5
            )
            branch = res.stdout.strip()
            if branch == "master":
                subprocess.run(
                    ["git", "branch", "-M", "main"],
                    cwd=workspace_path,
                    capture_output=True,
                    env=git_env,
                    timeout=5
                )
                branch = "main"

            # If expected_branch is specified and not main, ensure workspace is checked out
            if expected_branch and expected_branch not in ("main", "master") and branch != expected_branch:
                subprocess.run(
                    ["git", "checkout", "-B", expected_branch],
                    cwd=workspace_path,
                    capture_output=True,
                    env=git_env,
                    timeout=5
                )
                branch = expected_branch

            if branch and branch != "HEAD":
                return branch
            res_sha = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=workspace_path,
                capture_output=True,
                text=True,
                env=git_env,
                timeout=5
            )
            return res_sha.stdout.strip() or expected_branch or None
        except Exception:
            return expected_branch or None

    def _format_relative_time(self, iso_str: str) -> str:
        """Formats ISO 8601 timestamp string into human-friendly relative time."""
        try:
            from datetime import datetime, timezone
            dt = datetime.fromisoformat(iso_str)
            now = datetime.now(timezone.utc)
            diff_sec = max(0, int((now - dt).total_seconds()))
            if diff_sec < 60:
                return "Just now"
            elif diff_sec < 3600:
                m = diff_sec // 60
                return f"{m}m ago"
            elif diff_sec < 86400:
                h = diff_sec // 3600
                return f"{h}h ago"
            elif diff_sec < 604800:
                d = diff_sec // 86400
                return f"{d}d ago"
            else:
                return dt.strftime("%b %d, %Y")
        except Exception:
            return ""

    def get_git_commits(self, workspace_path: Path, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Retrieves recent git commit log for the current workspace with creation timestamps,
        inferred turn labels, and diff addition/deletion statistics.
        """
        if not (workspace_path / ".git").exists():
            return []

        git_env = self._get_git_env()
        try:
            log_proc = subprocess.run(
                ["git", "log", f"-n{limit}", "--pretty=format:%H|%h|%an|%ae|%aI|%s"],
                cwd=workspace_path,
                capture_output=True,
                text=True,
                env=git_env,
                timeout=5
            )
            if log_proc.returncode != 0 or not log_proc.stdout.strip():
                return []

            commits: List[Dict[str, Any]] = []
            for line in log_proc.stdout.strip().splitlines():
                if not line:
                    continue
                parts = line.split("|", 5)
                if len(parts) < 6:
                    continue
                sha, short_sha, author, email, committed_at, message = parts

                # Inferred turn label
                turn_label = None
                m = re.search(r"(?:cyclode:turn_|conv_turn_|turn[_\s-])(\d+)", message, re.IGNORECASE)
                if m:
                    turn_label = f"Turn {m.group(1)}"

                rel_time = self._format_relative_time(committed_at)

                # Fetch additions / deletions for this commit
                numstat = subprocess.run(
                    ["git", "show", "--numstat", "--format=", sha],
                    cwd=workspace_path,
                    capture_output=True,
                    text=True,
                    env=git_env,
                    timeout=5
                )
                adds, dels = 0, 0
                if numstat.returncode == 0 and numstat.stdout.strip():
                    for s_line in numstat.stdout.strip().splitlines():
                        s_parts = s_line.split()
                        if len(s_parts) >= 2:
                            if s_parts[0].isdigit():
                                adds += int(s_parts[0])
                            if s_parts[1].isdigit():
                                dels += int(s_parts[1])

                commits.append({
                    "sha": sha,
                    "short_sha": short_sha,
                    "turn_label": turn_label,
                    "message": message,
                    "author": author,
                    "email": email,
                    "committed_at": committed_at,
                    "relative_time": rel_time,
                    "additions": adds,
                    "deletions": dels
                })
            return commits
        except Exception:
            return []

    def get_git_diff(
        self,
        workspace_path: Path,
        mode: str = "all",
        base_branch: str = "main",
        commit_sha: Optional[str] = None,
        expected_branch: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Extracts git diff from the workspace path according to the chosen comparison scope:
        - mode='working_tree': uncommitted changes against HEAD (including untracked added files)
        - mode='all': cumulative diff from base_branch to HEAD (including working tree changes)
        - mode='commit': isolated patch for a specific commit_sha
        """
        if not (workspace_path / ".git").exists():
            return []

        git_env = self._get_git_env()
        try:
            # Exclude internal artifacts in .git/info/exclude
            exclude_file = workspace_path / ".git" / "info" / "exclude"
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

            # Stage intent-to-add for untracked files so new files appear in git diff
            subprocess.run(
                ["git", "add", "-N", "."],
                cwd=workspace_path,
                capture_output=True,
                env=git_env,
                timeout=5
            )

            diffs: List[Dict[str, Any]] = []

            if mode == "commit" and commit_sha:
                # Mode: Specific Commit
                files_proc = subprocess.run(
                    ["git", "diff-tree", "--no-commit-id", "--name-status", "--root", "-r", commit_sha],
                    cwd=workspace_path,
                    capture_output=True,
                    text=True,
                    env=git_env,
                    timeout=5
                )
                if files_proc.returncode != 0:
                    return []

                for line in files_proc.stdout.strip().splitlines():
                    if not line:
                        continue
                    parts = line.split(maxsplit=1)
                    status = parts[0]
                    file_name = parts[1] if len(parts) > 1 else ""
                    if not file_name:
                        continue
                    if file_name.startswith(".cyclode") or file_name == ".DS_Store" or "/.cyclode" in file_name:
                        continue

                    # Patch content
                    patch_proc = subprocess.run(
                        ["git", "diff-tree", "-p", "--no-commit-id", "--root", commit_sha, "--", file_name],
                        cwd=workspace_path,
                        capture_output=True,
                        text=True,
                        env=git_env,
                        timeout=5
                    )
                    file_diff = patch_proc.stdout if patch_proc.returncode == 0 else ""

                    # Additions and deletions
                    numstat = subprocess.run(
                        ["git", "diff-tree", "--numstat", "--no-commit-id", "--root", commit_sha, "--", file_name],
                        cwd=workspace_path,
                        capture_output=True,
                        text=True,
                        env=git_env,
                        timeout=5
                    )
                    adds, dels = 0, 0
                    if numstat.returncode == 0 and numstat.stdout.strip():
                        stat_parts = numstat.stdout.strip().split()
                        if len(stat_parts) >= 2:
                            adds = int(stat_parts[0]) if stat_parts[0].isdigit() else 0
                            dels = int(stat_parts[1]) if stat_parts[1].isdigit() else 0

                    diffs.append({
                        "file_path": file_name,
                        "status": status,
                        "diff_content": file_diff,
                        "additions": adds,
                        "deletions": dels
                    })
                return diffs

            # Determine diff reference for 'all' vs 'working_tree'
            diff_ref = "HEAD"
            if mode == "all":
                # Check if base_branch exists
                has_base = subprocess.run(
                    ["git", "rev-parse", "--verify", base_branch],
                    cwd=workspace_path,
                    capture_output=True,
                    env=git_env,
                    timeout=5
                )
                current_branch = self.get_git_branch(workspace_path, expected_branch=expected_branch)
                if has_base.returncode == 0 and current_branch != base_branch:
                    diff_ref = base_branch
                else:
                    diff_ref = "HEAD"

            # Check unstaged and staged diff
            raw_diff_proc = subprocess.run(
                ["git", "diff", diff_ref],
                cwd=workspace_path,
                capture_output=True,
                text=True,
                env=git_env,
                timeout=10
            )
            raw_diff = raw_diff_proc.stdout

            # If raw_diff is empty and diff_ref == "HEAD" and mode == "all",
            # check if there are commits on the branch to show cumulative changes
            if not raw_diff.strip() and mode == "all":
                log_proc = subprocess.run(
                    ["git", "rev-list", "--count", "HEAD"],
                    cwd=workspace_path,
                    capture_output=True,
                    text=True,
                    env=git_env,
                    timeout=5
                )
                commit_count = int(log_proc.stdout.strip()) if log_proc.stdout.strip().isdigit() else 0
                if commit_count > 1:
                    first_commit_proc = subprocess.run(
                        ["git", "rev-list", "--max-parents=0", "HEAD"],
                        cwd=workspace_path,
                        capture_output=True,
                        text=True,
                        env=git_env,
                        timeout=5
                    )
                    first_sha = first_commit_proc.stdout.strip().splitlines()[0] if first_commit_proc.stdout.strip() else ""
                    if first_sha:
                        diff_ref = f"{first_sha}..HEAD"
                        raw_diff_proc = subprocess.run(
                            ["git", "diff", diff_ref],
                            cwd=workspace_path,
                            capture_output=True,
                            text=True,
                            env=git_env,
                            timeout=10
                        )
                        raw_diff = raw_diff_proc.stdout

            if not raw_diff:
                return []

            files_proc = subprocess.run(
                ["git", "diff", "--name-status", diff_ref],
                cwd=workspace_path,
                capture_output=True,
                text=True,
                env=git_env,
                timeout=5
            )
            for line in files_proc.stdout.strip().splitlines():
                if not line:
                    continue
                parts = line.split(maxsplit=1)
                status = parts[0]
                file_name = parts[1] if len(parts) > 1 else ""
                if not file_name:
                    continue
                if file_name.startswith(".cyclode") or file_name == ".DS_Store" or "/.cyclode" in file_name:
                    continue

                # Extract file-specific patch snippet
                file_diff_proc = subprocess.run(
                    ["git", "diff", diff_ref, "--", file_name],
                    cwd=workspace_path,
                    capture_output=True,
                    text=True,
                    env=git_env,
                    timeout=5
                )
                file_diff = file_diff_proc.stdout if file_diff_proc.stdout else raw_diff

                # Estimate additions/deletions
                numstat = subprocess.run(
                    ["git", "diff", "--numstat", diff_ref, "--", file_name],
                    cwd=workspace_path,
                    capture_output=True,
                    text=True,
                    env=git_env,
                    timeout=5
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
                    "diff_content": file_diff,
                    "additions": adds,
                    "deletions": dels
                })
            return diffs
        except Exception:
            return []

    def setup_pr_worktrees(
        self,
        workspace_path: Path,
        repo_url: Optional[str],
        token: Optional[str],
        prs: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Creates isolated git worktrees for each pull request in {workspace_path}/prs/pr-{pr_number}.
        Supports both live remote repositories and local simulated worktree fixtures.
        """
        workspace_path.mkdir(parents=True, exist_ok=True)
        prs_dir = workspace_path / "prs"
        prs_dir.mkdir(parents=True, exist_ok=True)

        # 1. Initialize sample or base repo if not present
        self.init_sample_repo_if_needed(workspace_path)
        git_env = self._get_git_env()

        enriched_prs = []
        for pr in prs:
            pr_num = pr.get("number")
            if not pr_num:
                continue

            pr_worktree_dir = prs_dir / f"pr-{pr_num}"
            rel_worktree_path = f"prs/pr-{pr_num}"
            branch_name = f"pr-{pr_num}"

            # If live git repo with remote
            is_git = (workspace_path / ".git").exists()
            if is_git and repo_url and repo_url.startswith("http"):
                try:
                    # Configure git auth if token present
                    fetch_url = repo_url
                    if token and "github.com" in repo_url and "@" not in repo_url:
                        fetch_url = repo_url.replace("https://", f"https://x-access-token:{token}@")

                    # Fetch PR ref
                    subprocess.run(
                        ["git", "fetch", fetch_url, f"pull/{pr_num}/head:{branch_name}", "--force"],
                        cwd=workspace_path,
                        capture_output=True,
                        text=True,
                        env=git_env,
                        timeout=60
                    )
                except Exception:
                    pass

            # Create branch & worktree if not present
            if not pr_worktree_dir.exists():
                if is_git:
                    # Check if branch exists
                    branch_check = subprocess.run(
                        ["git", "rev-parse", "--verify", branch_name],
                        cwd=workspace_path,
                        capture_output=True,
                        text=True,
                        env=git_env
                    )
                    if branch_check.returncode != 0:
                        # Create branch from HEAD
                        subprocess.run(["git", "branch", branch_name], cwd=workspace_path, capture_output=True, env=git_env)

                    # Add worktree
                    subprocess.run(
                        ["git", "worktree", "add", str(pr_worktree_dir), branch_name],
                        cwd=workspace_path,
                        capture_output=True,
                        text=True,
                        env=git_env
                    )

                    # Inject sample PR changes if simulated
                    if pr.get("simulated"):
                        self._inject_sample_pr_changes(pr_worktree_dir, pr_num)
                else:
                    # Copy workspace to worktree dir as fallback
                    shutil.copytree(workspace_path, pr_worktree_dir, dirs_exist_ok=True, ignore=shutil.ignore_patterns("prs", ".git"))

            # Calculate diffs
            diffs = self.get_pr_diffs(workspace_path, pr_num)
            total_adds = sum(d.get("additions", 0) for d in diffs)
            total_dels = sum(d.get("deletions", 0) for d in diffs)

            diff_stats = {
                "changed_files": len(diffs),
                "additions": total_adds or pr.get("additions", 0),
                "deletions": total_dels or pr.get("deletions", 0),
                "files": [d.get("file_path") for d in diffs]
            }

            enriched = dict(pr)
            enriched["worktree_path"] = rel_worktree_path
            enriched["diff_stats"] = diff_stats
            enriched["diffs"] = diffs
            enriched_prs.append(enriched)

        return enriched_prs

    def _inject_sample_pr_changes(self, worktree_dir: Path, pr_num: int):
        """
        Injects realistic sample changes and commits into local simulated PR worktrees.
        """
        try:
            git_env = self._get_git_env()

            if pr_num == 101:
                auth_service = worktree_dir / "app" / "auth_service.py"
                if auth_service.exists():
                    auth_service.write_text(
                        'class AuthService:\n'
                        '    def get_user_display_name(self, user_dict):\n'
                        '        # Fixed: defensive null check on profile dictionary\n'
                        '        if not user_dict or "profile" not in user_dict:\n'
                        '            return "Anonymous User"\n'
                        '        profile = user_dict.get("profile") or {}\n'
                        '        return profile.get("name", "Anonymous User")\n'
                    )
                    subprocess.run(["git", "add", "."], cwd=worktree_dir, capture_output=True, env=git_env)
                    subprocess.run(["git", "commit", "-m", "fix: defensive null check on user profile"], cwd=worktree_dir, capture_output=True, env=git_env)
            elif pr_num == 104:
                cache_file = worktree_dir / "app" / "cache.py"
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                cache_file.write_text(
                    'class CacheManager:\n'
                    '    def __init__(self, max_connections=20):\n'
                    '        self.max_connections = max_connections\n'
                    '        self.storage = {}\n\n'
                    '    def get(self, key):\n'
                    '        return self.storage.get(key)\n\n'
                    '    def set(self, key, value):\n'
                    '        self.storage[key] = value\n'
                )
                subprocess.run(["git", "add", "."], cwd=worktree_dir, capture_output=True, env=git_env)
                subprocess.run(["git", "commit", "-m", "feat: implement cache manager storage"], cwd=worktree_dir, capture_output=True, env=git_env)
        except Exception:
            pass

    def get_pr_diffs(self, workspace_path: Path, pr_num: int) -> List[Dict[str, Any]]:
        """
        Extracts diff for a specific PR worktree against the base branch.
        """
        pr_worktree_dir = workspace_path / "prs" / f"pr-{pr_num}"
        if not pr_worktree_dir.exists():
            return []

        git_env = self._get_git_env()
        try:
            # Determine base branch
            base_ref = "main"
            check_main = subprocess.run(["git", "rev-parse", "--verify", "main"], cwd=pr_worktree_dir, capture_output=True, env=git_env)
            if check_main.returncode != 0:
                check_master = subprocess.run(["git", "rev-parse", "--verify", "master"], cwd=pr_worktree_dir, capture_output=True, env=git_env)
                base_ref = "master" if check_master.returncode == 0 else "HEAD~1"

            diff_target = f"{base_ref}...HEAD"
            diff_proc = subprocess.run(
                ["git", "diff", diff_target],
                cwd=pr_worktree_dir,
                capture_output=True,
                text=True,
                env=git_env,
                timeout=10
            )
            raw_diff = diff_proc.stdout
            if not raw_diff:
                diff_target = "HEAD~1"
                diff_proc = subprocess.run(
                    ["git", "diff", diff_target],
                    cwd=pr_worktree_dir,
                    capture_output=True,
                    text=True,
                    env=git_env,
                    timeout=10
                )
                raw_diff = diff_proc.stdout

            diffs = []
            if raw_diff:
                files_proc = subprocess.run(
                    ["git", "diff", "--name-status", diff_target],
                    cwd=pr_worktree_dir,
                    capture_output=True,
                    text=True,
                    env=git_env
                )
                output_lines = files_proc.stdout.strip().splitlines()
                if not output_lines and diff_target != "HEAD~1":
                    files_proc = subprocess.run(
                        ["git", "diff", "--name-status", "HEAD~1"],
                        cwd=pr_worktree_dir,
                        capture_output=True,
                        text=True,
                        env=git_env
                    )
                    output_lines = files_proc.stdout.strip().splitlines()
                    diff_target = "HEAD~1"

                for line in output_lines:
                    if not line:
                        continue
                    parts = line.split(maxsplit=1)
                    status = parts[0]
                    file_name = parts[1] if len(parts) > 1 else ""

                    numstat = subprocess.run(
                        ["git", "diff", "--numstat", f"{base_ref}...HEAD", "--", file_name],
                        cwd=pr_worktree_dir,
                        capture_output=True,
                        text=True,
                        env=git_env
                    )
                    adds, dels = 0, 0
                    if numstat.stdout.strip():
                        stat_parts = numstat.stdout.strip().split()
                        if len(stat_parts) >= 2:
                            adds = int(stat_parts[0]) if stat_parts[0].isdigit() else 0
                            dels = int(stat_parts[1]) if stat_parts[1].isdigit() else 0

                    # Get single file diff
                    file_diff_proc = subprocess.run(
                        ["git", "diff", f"{base_ref}...HEAD", "--", file_name],
                        cwd=pr_worktree_dir,
                        capture_output=True,
                        text=True,
                        env=git_env
                    )
                    file_diff = file_diff_proc.stdout or raw_diff

                    diffs.append({
                        "file_path": file_name,
                        "status": status,
                        "diff_content": file_diff,
                        "additions": adds,
                        "deletions": dels
                    })
            return diffs
        except Exception:
            return []

    def parse_raw_diff(self, raw_diff: str) -> List[Dict[str, Any]]:
        """
        Parses a standard unified git diff text into structured file diff records.
        """
        if not raw_diff or not raw_diff.strip():
            return []

        diffs = []
        file_chunks = re.split(r"(?=^diff --git )", raw_diff, flags=re.MULTILINE)
        for chunk in file_chunks:
            chunk = chunk.strip()
            if not chunk:
                continue

            # Extract file path
            path_match = re.search(r"^diff --git a/(.+?) b/(.+?)$", chunk, re.MULTILINE)
            if path_match:
                file_path = path_match.group(2)
            else:
                header_match = re.search(r"^\+\+\+ b/(.+?)$", chunk, re.MULTILINE)
                file_path = header_match.group(1) if header_match else "unknown"

            # Determine status
            status = "M"
            if "new file mode" in chunk:
                status = "A"
            elif "deleted file mode" in chunk:
                status = "D"
            elif "similarity index" in chunk or "rename from" in chunk:
                status = "R"

            # Count additions and deletions
            adds = 0
            dels = 0
            for line in chunk.splitlines():
                if line.startswith("+") and not line.startswith("+++"):
                    adds += 1
                elif line.startswith("-") and not line.startswith("---"):
                    dels += 1

            diffs.append({
                "file_path": file_path,
                "status": status,
                "diff_content": chunk,
                "additions": adds,
                "deletions": dels
            })

        return diffs

    def run_test_in_pr_worktree(
        self,
        workspace_path: Path,
        pr_num: int,
        test_command: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Runs unit tests inside the isolated PR worktree directory.
        """
        import time
        pr_worktree_dir = workspace_path / "prs" / f"pr-{pr_num}"
        if not pr_worktree_dir.exists():
            return {
                "ok": False,
                "exit_code": 1,
                "stdout": "",
                "stderr": f"Worktree directory '{pr_worktree_dir}' does not exist.",
                "duration_ms": 0
            }

        cmd = test_command or "python3 -m unittest discover tests"
        start_time = time.time()
        try:
            proc = subprocess.run(
                cmd,
                shell=True,
                cwd=pr_worktree_dir,
                capture_output=True,
                text=True,
                timeout=90
            )
            duration_ms = int((time.time() - start_time) * 1000)
            return {
                "ok": proc.returncode == 0,
                "command": cmd,
                "exit_code": proc.returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
                "duration_ms": duration_ms
            }
        except subprocess.TimeoutExpired:
            return {
                "ok": False,
                "command": cmd,
                "exit_code": 124,
                "stdout": "",
                "stderr": "Test execution timed out after 90 seconds.",
                "duration_ms": int((time.time() - start_time) * 1000)
            }
        except Exception as e:
            return {
                "ok": False,
                "command": cmd,
                "exit_code": 1,
                "stdout": "",
                "stderr": str(e),
                "duration_ms": int((time.time() - start_time) * 1000)
            }

    def cleanup_workspace(self, task_id: str):
        path = self.root_dir / f"task-{task_id}"
        if path.exists():
            # Remove any active worktrees first to prevent git locking issues
            try:
                subprocess.run(["git", "worktree", "prune"], cwd=path, capture_output=True, env=self._get_git_env())
            except Exception:
                pass
            shutil.rmtree(path, ignore_errors=True)


worktree_manager = WorktreeManager()
