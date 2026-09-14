import time
import httpx
from typing import Optional, Dict, Any, List
from app.config import settings


class GitHubClient:
    def __init__(self, token: Optional[str] = None, app_id: Optional[str] = None, webhook_secret: Optional[str] = None):
        self.token = token or settings.GITHUB_TOKEN
        self.app_id = app_id or settings.GITHUB_APP_ID
        self.webhook_secret = webhook_secret or settings.GITHUB_WEBHOOK_SECRET
        self.api_base = "https://api.github.com"

    def is_configured(self) -> bool:
        return bool(self.token or self.app_id)

    def _get_headers(self) -> Dict[str, str]:
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Cyclode-Agentic-Harness"
        }
        if self.token:
            headers["Authorization"] = f"token {self.token}"
        return headers

    async def create_pull_request(
        self,
        owner: str,
        repo: str,
        title: str,
        body: str,
        head_branch: str,
        base_branch: str = "main"
    ) -> Dict[str, Any]:
        """
        Opens a Pull Request on GitHub.
        """
        if not self.is_configured():
            # In local/unconfigured mode, return simulated PR response
            return {
                "id": 101,
                "number": 42,
                "html_url": f"https://github.com/{owner}/{repo}/pull/42",
                "title": title,
                "state": "open",
                "simulated": True
            }

        async with httpx.AsyncClient() as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/pulls"
            resp = await client.post(
                url,
                headers=self._get_headers(),
                json={
                    "title": title,
                    "body": body,
                    "head": head_branch,
                    "base": base_branch
                },
                timeout=15.0
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
        Falls back to realistic simulated PR data if unconfigured or offline.
        """
        token = custom_token or self.token
        if not token:
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
                    "additions": 118,
                    "deletions": 24,
                    "changed_files": 5,
                    "body": "Adds automatic connection pooling, health checks, and exponential backoff retry for Redis caches.",
                    "simulated": True
                }
            ]

        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Adappty-Agentic-Harness",
            "Authorization": f"token {token}"
        }
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
                            "additions": pr.get("additions", 0),
                            "deletions": pr.get("deletions", 0),
                            "changed_files": pr.get("changed_files", 0),
                            "body": pr.get("body", ""),
                            "simulated": False
                        })
                    return results
                return []
            except Exception:
                return []

    async def get_pull_request(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        custom_token: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Fetches detailed metadata for a single pull request.
        """
        token = custom_token or self.token
        if not token:
            prs = await self.list_pull_requests(owner, repo, custom_token=token)
            for pr in prs:
                if pr["number"] == pr_number:
                    return pr
            return None

        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Adappty-Agentic-Harness",
            "Authorization": f"token {token}"
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/pulls/{pr_number}"
            try:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return resp.json()
                return None
            except Exception:
                return None

    async def get_pull_request_diff(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        custom_token: Optional[str] = None
    ) -> str:
        """
        Fetches the unified git diff for a pull request.
        """
        token = custom_token or self.token
        if not token:
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

        headers = {
            "Accept": "application/vnd.github.v3.diff",
            "User-Agent": "Adappty-Agentic-Harness",
            "Authorization": f"token {token}"
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/pulls/{pr_number}"
            try:
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    return resp.text
                return ""
            except Exception:
                return ""

    async def post_pull_request_review(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        body: str,
        event: str = "COMMENT",
        custom_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Submits a formal PR review on GitHub (COMMENT, APPROVE, REQUEST_CHANGES).
        """
        token = custom_token or self.token
        if not token:
            return {
                "ok": True,
                "id": 303,
                "pr_number": pr_number,
                "body": body,
                "event": event,
                "html_url": f"https://github.com/{owner}/{repo}/pull/{pr_number}#pullrequestreview-303",
                "simulated": True
            }

        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Adappty-Agentic-Harness",
            "Authorization": f"token {token}"
        }
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
            resp = await client.post(
                url,
                headers=headers,
                json={"body": comment},
                timeout=15.0
            )
            if resp.status_code in (200, 201):
                return resp.json()
            return {"error": resp.text, "status_code": resp.status_code}

    async def post_pull_request_line_comment(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        body: str,
        commit_id: str,
        path: str,
        line: int,
        side: str = "RIGHT",
        custom_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Posts an inline diff review comment on a specific line of a pull request.
        """
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
                "commit_id": commit_id,
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
                return {"ok": False, "error": resp.text, "status_code": resp.status_code, "simulated": False}
            except Exception as e:
                return {"ok": False, "error": str(e), "simulated": False}

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
