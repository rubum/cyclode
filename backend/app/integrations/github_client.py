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
            "User-Agent": "Adappty-Agentic-Harness"
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

    async def post_issue_comment(self, owner: str, repo: str, issue_number: int, comment: str) -> Dict[str, Any]:
        """
        Posts a progress or resolution comment on an issue or PR.
        """
        if not self.is_configured():
            return {
                "id": 202,
                "body": comment,
                "html_url": f"https://github.com/{owner}/{repo}/issues/{issue_number}#issuecomment-202",
                "simulated": True
            }

        async with httpx.AsyncClient() as client:
            url = f"{self.api_base}/repos/{owner}/{repo}/issues/{issue_number}/comments"
            resp = await client.post(
                url,
                headers=self._get_headers(),
                json={"body": comment},
                timeout=15.0
            )
            if resp.status_code in (200, 201):
                return resp.json()
            return {"error": resp.text, "status_code": resp.status_code}


github_client = GitHubClient()
