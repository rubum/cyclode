import asyncio
import os
import shutil
import subprocess
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from app.config import settings
from app.core.sandboxes.base import (
    SandboxProvider,
    SandboxContext,
    CommandResult,
    CloneAuthRequiredException,
    CloneFailedException
)

logger = logging.getLogger("adappty.sandbox")


class EphemeralSandboxProvider(SandboxProvider):
    """
    Manages isolated, ephemeral sandbox workspaces that are created on-demand,
    cloned shallowly from target repositories, and wiped completely upon task completion.
    """

    def __init__(self, base_dir: Optional[str] = None):
        target = Path(base_dir or settings.WORKSPACE_ROOT)
        try:
            target.mkdir(parents=True, exist_ok=True)
            self.base_dir = target
        except Exception:
            fallback = Path("/tmp/workspaces")
            fallback.mkdir(parents=True, exist_ok=True)
            self.base_dir = fallback
        self._active_sandboxes: Dict[str, SandboxContext] = {}

    async def create_sandbox(
        self,
        task_id: str,
        repo_name: Optional[str] = None,
        repo_url: Optional[str] = None,
        branch: Optional[str] = None,
        commit_sha: Optional[str] = None
    ) -> SandboxContext:
        workspace_path = self.base_dir / f"sandbox-{task_id}"
        
        # 1. Reuse existing warm sandbox for multi-turn sessions ONLY IF repo matches
        if task_id in self._active_sandboxes and not self._active_sandboxes[task_id].is_destroyed and workspace_path.exists():
            existing_ctx = self._active_sandboxes[task_id]
            if not repo_url or existing_ctx.repo_url == repo_url:
                logger.info(f"Reusing active sandbox session for task {task_id} at {workspace_path}")
                return existing_ctx

        if workspace_path.exists() and (workspace_path / ".git").exists():
            curr_origin = ""
            orig_check = subprocess.run(["git", "config", "--get", "remote.origin.url"], cwd=workspace_path, capture_output=True, text=True)
            if orig_check.returncode == 0:
                curr_origin = orig_check.stdout.strip()
            
            clean_req = (repo_url or "").rstrip("/.git")
            clean_curr = curr_origin.rstrip("/.git")
            if not repo_url or (clean_req and clean_req in clean_curr):
                context = SandboxContext(
                    task_id=task_id,
                    workspace_path=workspace_path,
                    repo_name=repo_name,
                    repo_url=repo_url,
                    branch=branch or "main",
                    commit_sha=commit_sha,
                    is_destroyed=False
                )
                self._active_sandboxes[task_id] = context
                logger.info(f"Reattached existing sandbox directory for task {task_id} at {workspace_path}")
                return context

        # Clean any preexisting directory
        if workspace_path.exists():
            shutil.rmtree(workspace_path, ignore_errors=True)
        workspace_path.parent.mkdir(parents=True, exist_ok=True)

        # Clone repository if provided, otherwise initialize clean sample service
        if repo_url and repo_url.startswith("http"):
            try:
                from app.integrations.github_client import github_client
                from app.integrations.manager import integration_manager
                active_token = await integration_manager.get_github_token_for_repo(repo_url) or github_client.token
                clone_url = repo_url
                if active_token and "github.com" in repo_url and not ("@" in repo_url):
                    clone_url = repo_url.replace("https://", f"https://x-access-token:{active_token}@")

                cmd = ["git", "clone", "--depth", "1", "--single-branch", "--no-tags"]
                if branch:
                    cmd.extend(["--branch", branch])
                cmd.extend([clone_url, str(workspace_path)])

                git_env = dict(os.environ)
                git_env["GIT_TERMINAL_PROMPT"] = "0"
                proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=300, env=git_env)
                if proc.returncode == 0:
                    logger.info(f"Successfully cloned {repo_url} into sandbox {task_id}")
                    if commit_sha:
                        subprocess.run(["git", "checkout", commit_sha], cwd=workspace_path, capture_output=True)
                else:
                    err_msg = proc.stderr or ""
                    err_lower = err_msg.lower()
                    logger.warning(f"Git clone failed for {repo_url} with code {proc.returncode}: {err_msg}")
                    
                    is_auth_error = any(kw in err_lower for kw in [
                        "could not read username",
                        "authentication failed",
                        "permission denied",
                        "terminal prompts disabled",
                        "invalid credentials"
                    ])
                    
                    if is_auth_error:
                        raise CloneAuthRequiredException(repo_url=repo_url, stderr=err_msg)
                    else:
                        raise Exception(f"Git clone returned {proc.returncode}: {err_msg}")
            except (CloneAuthRequiredException,):
                raise
            except Exception as e:
                logger.warning(f"Git clone failed for {repo_url} ({e}); attempting archive download fallback...")
                success = False
                if "github.com/" in repo_url:
                    try:
                        clean_url = repo_url.rstrip("/.git")
                        parts = clean_url.split("github.com/")[-1].split("/")
                        if len(parts) >= 2:
                            gh_owner, gh_repo = parts[0], parts[1]
                            target_b = branch or "main"
                            shutil.rmtree(workspace_path, ignore_errors=True)
                            workspace_path.mkdir(parents=True, exist_ok=True)
                            
                            import urllib.request
                            import io
                            import tarfile
                            archive_url = f"https://codeload.github.com/{gh_owner}/{gh_repo}/tar.gz/{target_b}"
                            req = urllib.request.Request(archive_url, headers={"User-Agent": "Adappty-Agent"})
                            if active_token:
                                req.add_header("Authorization", f"token {active_token}")
                            
                            def download_and_extract():
                                with urllib.request.urlopen(req, timeout=45) as resp:
                                    data = resp.read()
                                with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
                                    for member in tar.getmembers():
                                        if "/" in member.name:
                                            member.name = "/".join(member.name.split("/")[1:])
                                            if member.name:
                                                tar.extract(member, path=str(workspace_path))
                            
                            await asyncio.to_thread(download_and_extract)
                            
                            subprocess.run(["git", "init", "-b", target_b], cwd=workspace_path, capture_output=True)
                            subprocess.run(["git", "config", "user.name", "Adappty Agent"], cwd=workspace_path, capture_output=True)
                            subprocess.run(["git", "config", "user.email", "agent@adappty.ai"], cwd=workspace_path, capture_output=True)
                            subprocess.run(["git", "add", "."], cwd=workspace_path, capture_output=True)
                            subprocess.run(["git", "commit", "-m", "initial commit from archive"], cwd=workspace_path, capture_output=True)
                            
                            logger.info(f"Successfully hydrated {repo_url} via archive fallback into sandbox {task_id}")
                            success = True
                    except Exception as arch_err:
                        logger.warning(f"Archive fallback also failed for {repo_url}: {arch_err}")

                if not success:
                    workspace_path.mkdir(parents=True, exist_ok=True)
        else:
            # Clean empty workspace initialization when no remote repository is specified
            workspace_path.mkdir(parents=True, exist_ok=True)

        context = SandboxContext(
            task_id=task_id,
            workspace_path=workspace_path,
            repo_name=repo_name,
            repo_url=repo_url,
            branch=branch or "main",
            commit_sha=commit_sha,
            is_destroyed=False
        )
        self._active_sandboxes[task_id] = context
        logger.info(f"Created ephemeral sandbox for task {task_id} at {workspace_path}")
        return context

    def _init_sample_repo(self, path: Path, branch_name: str = "main"):
        """Initializes a standalone git repository with sample code for autonomous test execution."""
        subprocess.run(["git", "init", "-b", branch_name], cwd=path, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Adappty Agent"], cwd=path, capture_output=True)
        subprocess.run(["git", "config", "user.email", "agent@adappty.ai"], cwd=path, capture_output=True)

        app_dir = path / "app"
        tests_dir = path / "tests"
        app_dir.mkdir(parents=True, exist_ok=True)
        tests_dir.mkdir(parents=True, exist_ok=True)

        (app_dir / "auth_service.py").write_text(
            'class AuthService:\n'
            '    def get_user_display_name(self, user_dict):\n'
            '        # Bug: NullPointerException when profile is missing\n'
            '        profile = user_dict["profile"]\n'
            '        return profile["name"]\n',
            encoding="utf-8"
        )

        (tests_dir / "test_auth_service.py").write_text(
            'import unittest\n'
            'from app.auth_service import AuthService\n\n'
            'class TestAuthService(unittest.TestCase):\n'
            '    def setUp(self):\n'
            '        self.auth = AuthService()\n\n'
            '    def test_valid_profile(self):\n'
            '        user = {"profile": {"name": "Alice"}}\n'
            '        self.assertEqual(self.auth.get_user_display_name(user), "Alice")\n',
            encoding="utf-8"
        )

        subprocess.run(["git", "add", "."], cwd=path, capture_output=True)
        subprocess.run(["git", "commit", "-m", "initial commit"], cwd=path, capture_output=True)

    async def run_command(self, context: SandboxContext, command: str, timeout: int = 60) -> CommandResult:
        if context.is_destroyed:
            return CommandResult(command=command, exit_code=1, stdout="", stderr="Sandbox is destroyed")

        try:
            proc = subprocess.run(
                command,
                shell=True,
                cwd=context.workspace_path,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            return CommandResult(
                command=command,
                exit_code=proc.returncode,
                stdout=proc.stdout,
                stderr=proc.stderr
            )
        except subprocess.TimeoutExpired:
            return CommandResult(command=command, exit_code=124, stdout="", stderr=f"Command timed out after {timeout}s")
        except Exception as e:
            return CommandResult(command=command, exit_code=1, stdout="", stderr=str(e))

    async def read_file(self, context: SandboxContext, file_path: str) -> str:
        if context.is_destroyed:
            return "Error: Sandbox is destroyed"
        target = (context.workspace_path / file_path).resolve()
        if not target.is_relative_to(context.workspace_path):
            return "Error: Access denied outside sandbox"
        if not target.exists() or not target.is_file():
            return f"Error: File '{file_path}' not found"
        return target.read_text(encoding="utf-8")

    async def write_file(self, context: SandboxContext, file_path: str, content: str) -> int:
        if context.is_destroyed:
            return 0
        target = (context.workspace_path / file_path).resolve()
        if not target.is_relative_to(context.workspace_path):
            raise PermissionError("Access denied outside sandbox")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return len(content)

    async def list_dir(self, context: SandboxContext, subpath: str = ".") -> List[Dict[str, Any]]:
        if context.is_destroyed:
            return []
        target = (context.workspace_path / subpath).resolve()
        if not target.is_relative_to(context.workspace_path) or not target.exists():
            return []

        items = []
        for p in target.iterdir():
            if ".git" not in p.parts:
                items.append({
                    "name": p.name,
                    "is_dir": p.is_dir(),
                    "type": "directory" if p.is_dir() else "file",
                    "size": p.stat().st_size if p.is_file() else None
                })
        return items

    async def get_git_diff(self, context: SandboxContext) -> List[Dict[str, Any]]:
        if context.is_destroyed or not (context.workspace_path / ".git").exists():
            return []

        try:
            diff_proc = subprocess.run(
                ["git", "diff", "HEAD"],
                cwd=context.workspace_path,
                capture_output=True,
                text=True,
                timeout=10
            )
            raw_diff = diff_proc.stdout
            if not raw_diff:
                return []

            diffs = []
            files_proc = subprocess.run(
                ["git", "diff", "--name-status", "HEAD"],
                cwd=context.workspace_path,
                capture_output=True,
                text=True
            )
            for line in files_proc.stdout.strip().splitlines():
                if not line:
                    continue
                parts = line.split(maxsplit=1)
                file_name = parts[1] if len(parts) > 1 else ""

                numstat = subprocess.run(
                    ["git", "diff", "--numstat", "HEAD", "--", file_name],
                    cwd=context.workspace_path,
                    capture_output=True,
                    text=True
                )
                adds, dels = 0, 0
                if numstat.stdout.strip():
                    n_parts = numstat.stdout.strip().split()
                    if len(n_parts) >= 2:
                        adds = int(n_parts[0]) if n_parts[0].isdigit() else 0
                        dels = int(n_parts[1]) if n_parts[1].isdigit() else 0

                file_diff_proc = subprocess.run(
                    ["git", "diff", "HEAD", "--", file_name],
                    cwd=context.workspace_path,
                    capture_output=True,
                    text=True
                )

                diffs.append({
                    "file_path": file_name,
                    "diff_content": file_diff_proc.stdout,
                    "additions": adds,
                    "deletions": dels
                })
            return diffs
        except Exception as e:
            logger.error(f"Error computing diff in sandbox {context.task_id}: {e}")
            return []

    async def destroy_sandbox(self, context: SandboxContext) -> bool:
        """Terminates and completely removes the ephemeral sandbox filesystem."""
        try:
            if context.workspace_path.exists():
                shutil.rmtree(context.workspace_path, ignore_errors=True)
            context.is_destroyed = True
            self._active_sandboxes.pop(context.task_id, None)
            logger.info(f"Destroyed ephemeral sandbox for task {context.task_id}")
            return True
        except Exception as e:
            logger.error(f"Error destroying sandbox {context.task_id}: {e}")
            return False

    async def destroy_by_task_id(self, task_id: str, workspace_path: Optional[str] = None) -> bool:
        """Terminates and removes sandbox directory for a given task_id."""
        try:
            if task_id in self._active_sandboxes:
                ctx = self._active_sandboxes.pop(task_id)
                ctx.is_destroyed = True
            
            target_path = Path(workspace_path) if workspace_path else (self.base_dir / f"sandbox-{task_id}")
            if target_path.exists() and target_path.is_dir():
                shutil.rmtree(target_path, ignore_errors=True)
            logger.info(f"Cleaned up sandbox workspace for task {task_id} at {target_path}")
            return True
        except Exception as e:
            logger.error(f"Error destroying sandbox by task_id {task_id}: {e}")
            return False


ephemeral_sandbox_provider = EphemeralSandboxProvider()
