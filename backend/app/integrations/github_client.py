import time
import httpx
from typing import Optional, Dict, Any
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
