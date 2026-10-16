import os
import time
import logging
import httpx
from typing import Optional, Dict, Any, List
from app.config import settings

logger = logging.getLogger(__name__)


class GitHubClient:
    def __init__(self, token: Optional[str] = None, app_id: Optional[str] = None, webhook_secret: Optional[str] = None):
        self.token = token or settings.GITHUB_TOKEN
        self.app_id = app_id or settings.GITHUB_APP_ID
        self.webhook_secret = webhook_secret or settings.GITHUB_WEBHOOK_SECRET
        self.api_base = "https://api.github.com"

    def is_configured(self) -> bool:
        return bool(self.token or self.app_id)

    def _get_headers(self, custom_token: Optional[str] = None, accept: str = "application/vnd.github.v3+json") -> Dict[str, str]:
        token = custom_token or self.token
        headers = {
            "Accept": accept,
            "User-Agent": "Cyclode-Agentic-Harness"
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    async def get_authenticated_user(self, custom_token: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Fetches the authenticated GitHub user profile corresponding to the current token.
        """
        import os
        if os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            return {"login": "cyclode-tester", "id": 10001, "avatar_url": ""}
        headers = self._get_headers(custom_token)
        if "Authorization" not in headers:
            return None
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(f"{self.api_base}/user", headers=headers)
                if resp.status_code == 200:
                    return resp.json()
            except Exception as e:
                logger.debug(f"Failed to fetch authenticated GitHub user: {e}")
        return None

    async def create_pull_request(
        self,
        owner: str,
        repo: str,
        title: str,
        body: str,
        head_branch: str,
        base_branch: str = "main",
        draft: bool = False,
        custom_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Opens a Pull Request on GitHub (with draft option).
        """
        import os
        if os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            return {
                "id": 101,
                "number": 42,
                "html_url": f"https://github.com/{owner}/{repo}/pull/42",
                "title": title,
                "state": "open",
                "draft": draft,
                "simulated": True
            }

        token = custom_token or self.token
        if not token:
            return {
                "error": "GitHub Personal Access Token is required to create pull requests. Configure a token in Settings or session Vault.",
                "status_code": 401,
                "auth_required": True,
                "simulated": False
            }

        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/pulls"
            resp = await client.post(
                url,
                headers=self._get_headers(token),
                json={
                    "title": title,
                    "body": body,
                    "head": head_branch,
                    "base": base_branch,
                    "draft": draft
                }
            )
            if resp.status_code in (200, 201):
                return resp.json()
            return {
                "error": resp.text,
                "status_code": resp.status_code,
                "simulated": False
            }

    async def list_pull_requests(
        self,
        owner: str,
        repo: str,
        state: str = "open",
        custom_token: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Lists pull requests from GitHub for a repository.
        Queries live GitHub REST API for public and vaulted private repositories.
        """
        import os
        if os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            return [
                {
                    "number": 101,
                    "title": "fix(auth): resolve JWT expiration token race condition",
                    "state": "open",
                    "user": {"login": "alex-dev", "avatar_url": "https://github.com/identicons/alex-dev.png"},
                    "head": {"ref": "fix/jwt-expiration-race", "sha": "a1b2c3d4e5f6"},
                    "base": {"ref": "main", "sha": "001122334455"},
                    "html_url": f"https://github.com/{owner}/{repo}/pull/101",
                    "created_at": "2026-09-12T10:15:30Z",
                    "updated_at": "2026-09-14T08:22:10Z",
                    "draft": False,
                    "mergeable": True,
                    "mergeable_state": "clean",
                    "additions": 42,
                    "deletions": 11,
                    "changed_files": 3,
                    "body": "Fixes intermittent 401 Unauthorized errors when refreshing tokens under high concurrent load.",
                    "simulated": True
                },
                {
                    "number": 104,
                    "title": "feat(cache): implement Redis connection pool and key eviction policy",
                    "state": "open",
                    "user": {"login": "sarah-eng", "avatar_url": "https://github.com/identicons/sarah-eng.png"},
                    "head": {"ref": "feat/redis-connection-pooling", "sha": "e9f8a7b6c5d4"},
                    "base": {"ref": "main", "sha": "001122334455"},
                    "html_url": f"https://github.com/{owner}/{repo}/pull/104",
                    "created_at": "2026-09-13T14:40:00Z",
                    "updated_at": "2026-09-14T09:05:00Z",
                    "draft": False,
                    "mergeable": True,
                    "mergeable_state": "clean",
                    "additions": 118,
                    "deletions": 24,
                    "changed_files": 5,
                    "body": "Adds automatic connection pooling, health checks, and exponential backoff retry for Redis caches.",
                    "simulated": True
                }
            ]

        token = custom_token or self.token
        headers = self._get_headers(token)

        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/pulls?state={state}&per_page=100"
            try:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    prs = resp.json()
                    results = []
                    for pr in prs:
                        results.append({
                            "number": pr.get("number"),
                            "title": pr.get("title"),
                            "state": pr.get("state"),
                            "user": pr.get("user", {}),
                            "head": pr.get("head", {}),
                            "base": pr.get("base", {}),
                            "html_url": pr.get("html_url"),
                            "created_at": pr.get("created_at"),
                            "updated_at": pr.get("updated_at"),
                            "merged_at": pr.get("merged_at"),
                            "draft": pr.get("draft", False),
                            "mergeable": pr.get("mergeable"),
                            "mergeable_state": pr.get("mergeable_state"),
                            "additions": pr.get("additions", 0),
                            "deletions": pr.get("deletions", 0),
                            "changed_files": pr.get("changed_files", 0),
                            "body": pr.get("body", ""),
                            "simulated": False
                        })
                    return results
            except Exception:
                pass
        return []

    async def get_pull_request(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        custom_token: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Fetches detailed metadata for a single pull request via live GitHub API.
        """
        import os
        if os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            prs = await self.list_pull_requests(owner, repo, custom_token=custom_token)
            for pr in prs:
                if pr.get("number") == pr_number:
                    return pr
            return None

        token = custom_token or self.token
        headers = self._get_headers(token)

        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/pulls/{pr_number}"
            try:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return resp.json()
            except Exception:
                pass
        return None

    async def get_pull_request_diff(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        custom_token: Optional[str] = None
    ) -> str:
        """
        Fetches the unified git diff for a pull request via live GitHub API.
        """
        import os
        if os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            if pr_number == 101:
                return (
                    "diff --git a/app/auth_service.py b/app/auth_service.py\n"
                    "--- a/app/auth_service.py\n"
                    "+++ b/app/auth_service.py\n"
                    "@@ -24,7 +24,10 @@ def verify_token(self, token: str):\n"
                    "-        payload = jwt.decode(token, self.secret_key, algorithms=['HS256'])\n"
                    "-        return payload\n"
                    "+        try:\n"
                    "+            payload = jwt.decode(token, self.secret_key, algorithms=['HS256'], leeway=10)\n"
                    "+            return payload\n"
                    "+        except jwt.ExpiredSignatureError:\n"
                    "+            return self.refresh_session(token)\n"
                )
            return (
                "diff --git a/app/cache.py b/app/cache.py\n"
                "--- a/app/cache.py\n"
                "+++ b/app/cache.py\n"
                "@@ -10,6 +10,18 @@ class RedisCache:\n"
                "-    def __init__(self):\n"
                "-        self.client = redis.Redis(host='localhost', port=6379)\n"
                "+    def __init__(self, max_connections: int = 20):\n"
                "+        self.pool = redis.ConnectionPool(host='localhost', port=6379, max_connections=max_connections)\n"
                "+        self.client = redis.Redis(connection_pool=self.pool)\n"
                "+\n"
                "+    def get_with_retry(self, key: str, retries: int = 3):\n"
                "+        for i in range(retries):\n"
                "+            try:\n"
                "+                return self.client.get(key)\n"
                "+            except redis.ConnectionError:\n"
                "+                time.sleep(0.1 * (2 ** i))\n"
                "+        return None\n"
            )

        token = custom_token or self.token
        headers = self._get_headers(token, accept="application/vnd.github.v3.diff")

        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/pulls/{pr_number}"
            try:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return resp.text
            except Exception:
                pass
        return ""

    async def get_pull_request_files(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        custom_token: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Fetches modified files for a specific pull request via live GitHub API.
        """
        import os
        if os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            return [
                {
                    "filename": "app/auth_service.py" if pr_number == 101 else "app/cache.py",
                    "status": "modified",
                    "additions": 4,
                    "deletions": 2,
                    "patch": "@@ -24,7 +24,10 @@ def verify_token..."
                }
            ]

        token = custom_token or self.token
        headers = self._get_headers(token)

        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/pulls/{pr_number}/files?per_page=100"
            try:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return resp.json()
            except Exception:
                pass
        return []

    async def get_check_runs(
        self,
        owner: str,
        repo: str,
        ref: str,
        custom_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fetches GitHub Actions check-runs and overall conclusion rollup for a commit SHA or ref.
        """
        import os
        if os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            return {
                "total_count": 3,
                "conclusion": "success",
                "check_runs": [
                    {
                        "id": 1001,
                        "name": "pytest / test-backend (3.11)",
                        "status": "completed",
                        "conclusion": "success",
                        "html_url": f"https://github.com/{owner}/{repo}/runs/1001",
                        "started_at": "2026-09-14T08:23:00Z",
                        "completed_at": "2026-09-14T08:24:12Z"
                    },
                    {
                        "id": 1002,
                        "name": "eslint / lint-frontend",
                        "status": "completed",
                        "conclusion": "success",
                        "html_url": f"https://github.com/{owner}/{repo}/runs/1002",
                        "started_at": "2026-09-14T08:23:05Z",
                        "completed_at": "2026-09-14T08:23:45Z"
                    },
                    {
                        "id": 1003,
                        "name": "build / vite-bundle",
                        "status": "completed",
                        "conclusion": "success",
                        "html_url": f"https://github.com/{owner}/{repo}/runs/1003",
                        "started_at": "2026-09-14T08:23:10Z",
                        "completed_at": "2026-09-14T08:24:30Z"
                    }
                ],
                "simulated": True
            }

        token = custom_token or self.token
        headers = self._get_headers(token)

        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/commits/{ref}/check-runs?per_page=100"
            try:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    runs = data.get("check_runs", [])
                    has_failures = any(r.get("conclusion") in ("failure", "timed_out", "cancelled", "action_required") for r in runs)
                    all_completed = all(r.get("status") == "completed" for r in runs) if runs else False

                    if not runs:
                        conclusion = "neutral"
                    elif has_failures:
                        conclusion = "failure"
                    elif all_completed:
                        conclusion = "success"
                    else:
                        conclusion = "pending"

                    formatted_runs = []
                    for r in runs:
                        formatted_runs.append({
                            "id": r.get("id"),
                            "name": r.get("name"),
                            "status": r.get("status"),
                            "conclusion": r.get("conclusion"),
                            "html_url": r.get("html_url"),
                            "started_at": r.get("started_at"),
                            "completed_at": r.get("completed_at"),
                        })
                    return {
                        "total_count": data.get("total_count", len(formatted_runs)),
                        "conclusion": conclusion,
                        "check_runs": formatted_runs,
                        "simulated": False
                    }
            except Exception as e:
                logger.debug(f"Failed to fetch check-runs for {owner}/{repo}@{ref}: {e}")
        return {"total_count": 0, "conclusion": "unknown", "check_runs": [], "simulated": False}

    async def get_pull_request_reviews(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        custom_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fetches GitHub PR formal reviews and computes overall review verdict.
        """
        import os
        if os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            return {
                "verdict": "APPROVED",
                "total_reviews": 1,
                "approvals": ["senior-eng"],
                "change_requests": [],
                "reviews": [
                    {
                        "id": 303,
                        "user": "senior-eng",
                        "state": "APPROVED",
                        "body": "LGTM overall, left one minor suggestion on the error handling.",
                        "submitted_at": "2026-09-14T12:00:00Z",
                        "html_url": f"https://github.com/{owner}/{repo}/pull/{pr_number}#pullrequestreview-303"
                    }
                ],
                "simulated": True
            }

        token = custom_token or self.token
        headers = self._get_headers(token)

        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/pulls/{pr_number}/reviews?per_page=100"
            try:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    raw_reviews = resp.json()
                    latest_by_user = {}
                    reviews_list = []
                    for r in raw_reviews:
                        u = r.get("user") or {}
                        uname = u.get("login", "unknown") if isinstance(u, dict) else "unknown"
                        state = (r.get("state") or "COMMENTED").upper()
                        submitted = r.get("submitted_at") or r.get("created_at") or ""
                        if state in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED", "COMMENTED"):
                            latest_by_user[uname] = state
                        reviews_list.append({
                            "id": r.get("id"),
                            "user": uname,
                            "state": state,
                            "body": (r.get("body") or "").strip(),
                            "submitted_at": submitted,
                            "html_url": r.get("html_url", "")
                        })

                    approvals = [user for user, state in latest_by_user.items() if state == "APPROVED"]
                    change_requests = [user for user, state in latest_by_user.items() if state == "CHANGES_REQUESTED"]

                    if change_requests:
                        verdict = "CHANGES_REQUESTED"
                    elif approvals:
                        verdict = "APPROVED"
                    elif latest_by_user:
                        verdict = "COMMENTED"
                    else:
                        verdict = "PENDING"

                    return {
                        "verdict": verdict,
                        "total_reviews": len(reviews_list),
                        "approvals": approvals,
                        "change_requests": change_requests,
                        "reviews": reviews_list,
                        "simulated": False
                    }
            except Exception as e:
                logger.debug(f"Failed to fetch PR reviews for {owner}/{repo}#{pr_number}: {e}")
        return {
            "verdict": "PENDING",
            "total_reviews": 0,
            "approvals": [],
            "change_requests": [],
            "reviews": [],
            "simulated": False
        }

    async def post_pull_request_review(
        self,
        owner: str = "",
        repo: str = "",
        pr_number: int = 1,
        body: str = "",
        event: str = "COMMENT",
        custom_token: Optional[str] = None,
        repo_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Submits a formal PR review on GitHub (COMMENT, APPROVE, REQUEST_CHANGES).
        """
        import os
        if repo_name and not owner:
            parts = repo_name.split("/", 1)
            owner = parts[0]
            repo = parts[1] if len(parts) > 1 else ""
        elif "/" in owner and not repo:
            parts = owner.split("/", 1)
            owner = parts[0]
            repo = parts[1]

        if os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            return {
                "ok": True,
                "id": 303,
                "pr_number": pr_number,
                "body": body,
                "event": event,
                "html_url": f"https://github.com/{owner}/{repo}/pull/{pr_number}#pullrequestreview-303",
                "simulated": True
            }

        token = custom_token or self.token
        if not token:
            return {
                "ok": False,
                "error": "GitHub Personal Access Token is required to submit pull request reviews.",
                "auth_required": True,
                "simulated": False
            }

        headers = self._get_headers(token)
        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/pulls/{pr_number}/reviews"
            try:
                resp = await client.post(
                    url,
                    headers=headers,
                    json={"body": body, "event": event},
                    timeout=15.0
                )
                if resp.status_code in (200, 201):
                    data = resp.json()
                    data["ok"] = True
                    data["pr_number"] = pr_number
                    return data
                if resp.status_code == 422 and event in ("REQUEST_CHANGES", "APPROVE"):
                    err_lower = resp.text.lower()
                    if "your own pull request" in err_lower or "own pull request" in err_lower:
                        # GitHub does not permit author to request changes or approve their own PR.
                        # Gracefully fall back to posting as a review with event='COMMENT'
                        event_label = "Changes Requested" if event == "REQUEST_CHANGES" else "Approved"
                        fallback_body = f"> **Review Verdict: {event_label}** *(Submitted as a review comment because GitHub does not permit authors to formally approve or request changes on their own pull requests)*\n\n{body}"
                        fallback_resp = await client.post(
                            url,
                            headers=headers,
                            json={"body": fallback_body, "event": "COMMENT"},
                            timeout=15.0
                        )
                        if fallback_resp.status_code in (200, 201):
                            fallback_data = fallback_resp.json()
                            fallback_data["ok"] = True
                            fallback_data["pr_number"] = pr_number
                            fallback_data["converted_to_comment"] = True
                            return fallback_data
                return {"ok": False, "error": resp.text, "status_code": resp.status_code, "simulated": False}
            except Exception as e:
                return {"ok": False, "error": str(e), "simulated": False}

    async def merge_pull_request(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        commit_title: Optional[str] = None,
        commit_message: Optional[str] = None,
        merge_method: str = "squash",
        custom_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Merges a pull request on GitHub (merge_method: squash, merge, rebase).
        """
        import os
        if os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            return {
                "ok": True,
                "sha": "6dcb09b5b57875f334f61aebed695e2e4193db5e",
                "merged": True,
                "message": "Pull Request successfully merged",
                "simulated": True
            }

        token = custom_token or self.token
        if not token:
            return {
                "ok": False,
                "error": "GitHub Personal Access Token is required to merge pull requests.",
                "auth_required": True,
                "simulated": False
            }

        headers = self._get_headers(token)
        payload: Dict[str, Any] = {"merge_method": merge_method}
        if commit_title:
            payload["commit_title"] = commit_title
        if commit_message:
            payload["commit_message"] = commit_message

        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/pulls/{pr_number}/merge"
            try:
                resp = await client.put(
                    url,
                    headers=headers,
                    json=payload,
                    timeout=15.0
                )
                if resp.status_code == 200:
                    data = resp.json()
                    data["ok"] = True
                    return data
                return {"ok": False, "error": resp.text, "status_code": resp.status_code, "simulated": False}
            except Exception as e:
                return {"ok": False, "error": str(e), "simulated": False}

    async def post_issue_comment(self, owner: str, repo: str, issue_number: int, comment: str, custom_token: Optional[str] = None) -> Dict[str, Any]:
        """
        Posts a progress or resolution comment on an issue or PR.
        """
        token = custom_token or self.token
        if not token:
            return {
                "ok": True,
                "id": 202,
                "body": comment,
                "html_url": f"https://github.com/{owner}/{repo}/issues/{issue_number}#issuecomment-202",
                "simulated": True
            }

        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Cyclode-Agentic-Harness",
            "Authorization": f"token {token}"
        }
        async with httpx.AsyncClient() as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/issues/{issue_number}/comments"
            try:
                resp = await client.post(
                    url,
                    headers=headers,
                    json={"body": comment},
                    timeout=15.0
                )
                if resp.status_code in (200, 201):
                    data = resp.json()
                    if isinstance(data, dict):
                        data["ok"] = True
                    return data
                return {"ok": False, "error": resp.text, "status_code": resp.status_code}
            except Exception as e:
                return {"ok": False, "error": str(e)}

    async def post_pull_request_line_comment(
        self,
        owner: str = "",
        repo: str = "",
        pr_number: int = 1,
        body: str = "",
        commit_id: Optional[str] = None,
        path: str = "",
        line: int = 1,
        side: str = "RIGHT",
        custom_token: Optional[str] = None,
        commit_sha: Optional[str] = None,
        repo_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Posts an inline diff review comment on a specific line of a pull request.
        Supports both commit_id and commit_sha, with automatic head SHA fallback.
        If line is outside diff range (422), gracefully falls back to a PR issue comment.
        """
        import os
        if repo_name and not owner:
            parts = repo_name.split("/", 1)
            owner = parts[0]
            repo = parts[1] if len(parts) > 1 else ""
        elif "/" in owner and not repo:
            parts = owner.split("/", 1)
            owner = parts[0]
            repo = parts[1]

        if os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            return {
                "ok": True,
                "id": 404,
                "body": body,
                "path": path,
                "line": line,
                "html_url": f"https://github.com/{owner}/{repo}/pull/{pr_number}#discussion_r404",
                "simulated": True
            }

        target_commit = (commit_id or commit_sha or "").strip()
        if not target_commit:
            try:
                pr_info = await self.get_pull_request(owner, repo, pr_number, custom_token=custom_token)
                if isinstance(pr_info, dict):
                    target_commit = pr_info.get("head", {}).get("sha", "")
            except Exception as e:
                logger.debug(f"Failed to auto-resolve head SHA for {owner}/{repo}#{pr_number}: {e}")

        token = custom_token or self.token
        if not token:
            return {
                "ok": True,
                "id": 404,
                "body": body,
                "path": path,
                "line": line,
                "html_url": f"https://github.com/{owner}/{repo}/pull/{pr_number}#discussion_r404",
                "simulated": True
            }

        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Cyclode-Agentic-Harness",
            "Authorization": f"token {token}"
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/pulls/{pr_number}/comments"
            payload = {
                "body": body,
                "commit_id": target_commit,
                "path": path,
                "line": line,
                "side": side
            }
            try:
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code in (200, 201):
                    data = resp.json()
                    data["ok"] = True
                    return data
                if resp.status_code == 422:
                    # Line may not be in the PR diff hunk or commit SHA mismatch.
                    # Fall back to posting as a PR issue comment so feedback is not lost.
                    fallback_body = f"> **Review Comment on `{path}:{line}`** *(Submitted as PR comment because line is outside the modified diff range)*\n\n{body}"
                    issue_comment_url = f"{self.api_base}/repos/{owner}/{repo}/issues/{pr_number}/comments"
                    fallback_resp = await client.post(
                        issue_comment_url,
                        headers=headers,
                        json={"body": fallback_body},
                        timeout=15.0
                    )
                    if fallback_resp.status_code in (200, 201):
                        fallback_data = fallback_resp.json()
                        fallback_data["ok"] = True
                        fallback_data["converted_to_issue_comment"] = True
                        fallback_data["path"] = path
                        fallback_data["line"] = line
                        return fallback_data
                return {"ok": False, "error": resp.text, "status_code": resp.status_code, "simulated": False}
            except Exception as e:
                return {"ok": False, "error": str(e), "simulated": False}

    async def list_pull_request_comments(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        custom_token: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Fetches all comments on a pull request:
        1. PR-level conversation comments (issues/{pr_number}/comments)
        2. Inline diff code review comments (pulls/{pr_number}/comments)
        3. Formal review submissions (pulls/{pr_number}/reviews)
        Returns a sorted, normalized chronological list.
        """
        token = custom_token or self.token
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Cyclode-Agentic-Harness",
        }
        if token:
            headers["Authorization"] = f"token {token}"

        if os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            return [
                {
                    "id": "issue_101",
                    "raw_id": 101,
                    "type": "conversation",
                    "author": "octocat",
                    "author_avatar": "https://github.com/images/error/octocat_happy.gif",
                    "author_association": "COLLABORATOR",
                    "body": "Thanks for opening this PR! Looking forward to reviewing the implementation.",
                    "created_at": "2026-09-14T10:00:00Z",
                    "updated_at": "2026-09-14T10:00:00Z",
                    "html_url": f"https://github.com/{owner}/{repo}/pull/{pr_number}#issuecomment-101",
                    "reactions": {"+1": 2, "-1": 0, "laugh": 0, "heart": 1, "eyes": 1}
                },
                {
                    "id": "review_comment_202",
                    "raw_id": 202,
                    "type": "code_comment",
                    "author": "reviewer1",
                    "author_avatar": "https://github.com/images/error/octocat_happy.gif",
                    "author_association": "MEMBER",
                    "body": "Consider using structured error logging here rather than a plain string.",
                    "created_at": "2026-09-14T11:30:00Z",
                    "updated_at": "2026-09-14T11:30:00Z",
                    "html_url": f"https://github.com/{owner}/{repo}/pull/{pr_number}#discussion_r202",
                    "path": "src/main.rs",
                    "line": 42,
                    "original_line": 42,
                    "diff_hunk": "@@ -40,3 +40,5 @@\n+    if err.is_some() {\n+        println!(\"error\");",
                    "commit_id": "a1b2c3d",
                    "in_reply_to_id": None,
                    "reactions": {"+1": 1, "heart": 0}
                },
                {
                    "id": "review_303",
                    "raw_id": 303,
                    "type": "review",
                    "author": "senior-eng",
                    "author_avatar": "https://github.com/images/error/octocat_happy.gif",
                    "author_association": "OWNER",
                    "body": "LGTM overall, left one minor suggestion on the error handling.",
                    "review_state": "COMMENTED",
                    "created_at": "2026-09-14T12:00:00Z",
                    "html_url": f"https://github.com/{owner}/{repo}/pull/{pr_number}#pullrequestreview-303"
                }
            ]

        import asyncio
        items: List[Dict[str, Any]] = []
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            r_issue, r_review_comments, r_reviews = await asyncio.gather(
                client.get(
                    f"{self.api_base}/repos/{owner}/{repo}/issues/{pr_number}/comments?per_page=100",
                    headers=headers
                ),
                client.get(
                    f"{self.api_base}/repos/{owner}/{repo}/pulls/{pr_number}/comments?per_page=100",
                    headers=headers
                ),
                client.get(
                    f"{self.api_base}/repos/{owner}/{repo}/pulls/{pr_number}/reviews?per_page=50",
                    headers=headers
                ),
                return_exceptions=True
            )

            # 1. PR Conversation comments
            try:
                if not isinstance(r_issue, Exception) and r_issue.status_code == 200:
                    for c in r_issue.json():
                        u = c.get("user") or {}
                        reactions = c.get("reactions") or {}
                        items.append({
                            "id": f"issue_{c.get('id')}",
                            "raw_id": c.get("id"),
                            "type": "conversation",
                            "author": u.get("login", "unknown") if isinstance(u, dict) else "unknown",
                            "author_avatar": u.get("avatar_url", "") if isinstance(u, dict) else "",
                            "author_association": c.get("author_association", "NONE"),
                            "body": c.get("body", ""),
                            "created_at": c.get("created_at"),
                            "updated_at": c.get("updated_at"),
                            "html_url": c.get("html_url", ""),
                            "reactions": {
                                "+1": reactions.get("+1", 0),
                                "-1": reactions.get("-1", 0),
                                "laugh": reactions.get("laugh", 0),
                                "hooray": reactions.get("hooray", 0),
                                "heart": reactions.get("heart", 0),
                                "rocket": reactions.get("rocket", 0),
                                "eyes": reactions.get("eyes", 0),
                            }
                        })
            except Exception as e:
                logger.debug(f"Failed to fetch PR conversation comments: {e}")

            # 2. Diff code review comments
            try:
                if not isinstance(r_review_comments, Exception) and r_review_comments.status_code == 200:
                    for rc in r_review_comments.json():
                        u = rc.get("user") or {}
                        reactions = rc.get("reactions") or {}
                        items.append({
                            "id": f"review_comment_{rc.get('id')}",
                            "raw_id": rc.get("id"),
                            "type": "code_comment",
                            "author": u.get("login", "unknown") if isinstance(u, dict) else "unknown",
                            "author_avatar": u.get("avatar_url", "") if isinstance(u, dict) else "",
                            "author_association": rc.get("author_association", "NONE"),
                            "body": rc.get("body", ""),
                            "created_at": rc.get("created_at"),
                            "updated_at": rc.get("updated_at"),
                            "html_url": rc.get("html_url", ""),
                            "path": rc.get("path", ""),
                            "line": rc.get("line") or rc.get("original_line"),
                            "original_line": rc.get("original_line"),
                            "diff_hunk": rc.get("diff_hunk", ""),
                            "commit_id": rc.get("commit_id", ""),
                            "in_reply_to_id": rc.get("in_reply_to_id"),
                            "reactions": {
                                "+1": reactions.get("+1", 0),
                                "-1": reactions.get("-1", 0),
                                "laugh": reactions.get("laugh", 0),
                                "heart": reactions.get("heart", 0),
                                "eyes": reactions.get("eyes", 0),
                            }
                        })
            except Exception as e:
                logger.debug(f"Failed to fetch PR review comments: {e}")

            # 3. Formal review submissions
            try:
                if not isinstance(r_reviews, Exception) and r_reviews.status_code == 200:
                    for r in r_reviews.json():
                        u = r.get("user") or {}
                        body = (r.get("body") or "").strip()
                        state = (r.get("state") or "COMMENTED").upper()
                        # Keep reviews that have text or are significant decisions
                        if body or state in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED"):
                            items.append({
                                "id": f"review_{r.get('id')}",
                                "raw_id": r.get("id"),
                                "type": "review",
                                "author": u.get("login", "unknown") if isinstance(u, dict) else "unknown",
                                "author_avatar": u.get("avatar_url", "") if isinstance(u, dict) else "",
                                "author_association": r.get("author_association", "NONE"),
                                "body": body,
                                "review_state": state,
                                "created_at": r.get("submitted_at") or r.get("created_at"),
                                "html_url": r.get("html_url", ""),
                            })
            except Exception as e:
                logger.debug(f"Failed to fetch PR reviews: {e}")

        # Sort chronologically by created_at
        def sort_key(item: Dict[str, Any]) -> str:
            return item.get("created_at") or ""

        items.sort(key=sort_key)
        return items

    async def post_pull_request_comment(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        comment: str,
        in_reply_to_id: Optional[int] = None,
        custom_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Posts a comment or reply on a PR.
        If in_reply_to_id is provided, replies to an inline review comment thread.
        Otherwise, posts a top-level conversation comment.
        """
        token = custom_token or self.token
        if not token or os.environ.get("GITHUB_MOCK_TEST_MODE") == "1":
            return {
                "ok": True,
                "id": 999,
                "body": comment,
                "html_url": f"https://github.com/{owner}/{repo}/pull/{pr_number}#issuecomment-999",
                "simulated": True
            }

        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Cyclode-Agentic-Harness",
            "Authorization": f"token {token}"
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            if in_reply_to_id:
                url = f"{self.api_base}/repos/{owner}/{repo}/pulls/{pr_number}/comments/{in_reply_to_id}/replies"
                resp = await client.post(url, headers=headers, json={"body": comment})
            else:
                url = f"{self.api_base}/repos/{owner}/{repo}/issues/{pr_number}/comments"
                resp = await client.post(url, headers=headers, json={"body": comment})

            if resp.status_code in (200, 201):
                data = resp.json()
                data["ok"] = True
                return data
            return {"ok": False, "error": resp.text, "status_code": resp.status_code, "simulated": False}

    async def list_webhooks(self, owner: str, repo: str, custom_token: Optional[str] = None) -> Dict[str, Any]:
        """
        Lists all active webhooks on a repository.
        """
        token = custom_token or self.token
        if not token:
            return {"webhooks": [], "configured": False}

        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Cyclode-Agentic-Harness",
            "Authorization": f"token {token}"
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.api_base}/repos/{owner}/{repo}/hooks", headers=headers)
            if resp.status_code == 200:
                return {"webhooks": resp.json(), "configured": True}
            return {"webhooks": [], "error": resp.text, "status_code": resp.status_code, "configured": False}

    async def create_or_update_webhook(
        self,
        owner: str,
        repo: str,
        webhook_url: str,
        secret: Optional[str] = None,
        events: Optional[list] = None,
        custom_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Installs or verifies a repository webhook for Cyclode listener.
        """
        token = custom_token or self.token
        if not token:
            return {"success": False, "message": "GitHub Personal Access Token is required to configure repository webhooks."}

        if events is None:
            events = ["pull_request", "issues", "issue_comment", "push"]

        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Cyclode-Agentic-Harness",
            "Authorization": f"token {token}"
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            # 1. Check if hook already exists
            list_resp = await client.get(f"{self.api_base}/repos/{owner}/{repo}/hooks", headers=headers)
            if list_resp.status_code == 200:
                hooks = list_resp.json()
                for hook in hooks:
                    config = hook.get("config", {})
                    if config.get("url") == webhook_url:
                        return {
                            "success": True,
                            "hook_id": hook.get("id"),
                            "status": "active" if hook.get("active") else "inactive",
                            "message": f"Webhook already registered on {owner}/{repo} (Hook ID #{hook.get('id')}).",
                            "events": hook.get("events", events),
                            "webhook_url": webhook_url
                        }

            # 2. Create new webhook
            body = {
                "name": "web",
                "active": True,
                "events": events,
                "config": {
                    "url": webhook_url,
                    "content_type": "json",
                    "insecure_ssl": "0"
                }
            }
            if secret:
                body["config"]["secret"] = secret

            resp = await client.post(f"{self.api_base}/repos/{owner}/{repo}/hooks", headers=headers, json=body)
            if resp.status_code in (200, 201):
                data = resp.json()
                return {
                    "success": True,
                    "hook_id": data.get("id"),
                    "status": "active",
                    "message": f"Successfully registered webhook listener on {owner}/{repo} (Hook ID #{data.get('id')}).",
                    "events": events,
                    "webhook_url": webhook_url
                }
            if "localhost" in webhook_url or "127.0.0.1" in webhook_url:
                if resp.status_code == 422:
                    return {
                        "success": False,
                        "error": resp.text,
                        "status_code": resp.status_code,
                        "message": f"GitHub requires a publicly accessible URL and rejected '{webhook_url}'. For offline local development, use the '⚡ Simulate' button to trigger events instantly, or expose port 8000 via a public tunnel (e.g., ngrok or Cloudflare Tunnel)."
                    }

            return {
                "success": False,
                "error": resp.text,
                "status_code": resp.status_code,
                "message": f"Failed to register webhook on GitHub (Status {resp.status_code}): {resp.text[:200]}"
            }

    async def delete_webhook(self, owner: str, repo: str, hook_id: int, custom_token: Optional[str] = None) -> Dict[str, Any]:
        """
        Deletes a repository webhook.
        """
        token = custom_token or self.token
        if not token:
            return {"success": False, "message": "GitHub token is required."}

        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Cyclode-Agentic-Harness",
            "Authorization": f"token {token}"
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.delete(f"{self.api_base}/repos/{owner}/{repo}/hooks/{hook_id}", headers=headers)
            if resp.status_code in (200, 204):
                return {"success": True, "message": f"Deleted webhook #{hook_id} from {owner}/{repo}."}
            return {"success": False, "error": resp.text, "status_code": resp.status_code}


github_client = GitHubClient()
