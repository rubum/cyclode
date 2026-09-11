import logging
import os
import re
import subprocess
from typing import Dict, Any, Optional, Tuple
import httpx

from app.config import settings
from app.integrations.github_client import github_client
from app.integrations.slack_client import slack_client
from app.integrations.appsignal_client import appsignal_client

logger = logging.getLogger("adappty.integrations")


class IntegrationManager:
    """
    Manages in-memory and persistent credential state, performs validation handshakes,
    and supports conversational ChatOps credential provisioning.
    """

    def __init__(self):
        self._custom_credentials: Dict[str, Dict[str, Any]] = {}

    def mask_token(self, token: Optional[str]) -> str:
        if not token:
            return ""
        if len(token) <= 8:
            return "••••••••"
        prefix = token[:4]
        suffix = token[-3:]
        return f"{prefix}••••••••{suffix}"

    async def update_credentials(
        self,
        provider: str,
        credentials: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Updates credentials for a given provider (github, slack, appsignal, sentry, gemini)
        and performs a live validation test.
        """
        provider = provider.lower().strip()
        self._custom_credentials[provider] = credentials
        validation = await self.validate_credentials(provider, credentials)

        if validation.get("valid"):
            # Hot-apply to active clients
            if provider == "github":
                if "token" in credentials:
                    github_client.token = credentials["token"]
                if "app_id" in credentials:
                    github_client.app_id = credentials["app_id"]
                if "webhook_secret" in credentials:
                    github_client.webhook_secret = credentials["webhook_secret"]
            elif provider == "slack":
                if "token" in credentials:
                    slack_client.token = credentials["token"]
                if "default_channel" in credentials:
                    slack_client.default_channel = credentials["default_channel"]
            elif provider == "appsignal":
                if "api_key" in credentials:
                    appsignal_client.api_key = credentials["api_key"]
                if "webhook_token" in credentials:
                    appsignal_client.webhook_token = credentials["webhook_token"]
            elif provider == "gemini":
                if "api_key" in credentials:
                    os.environ["GEMINI_API_KEY"] = credentials["api_key"]
                    settings.GEMINI_API_KEY = credentials["api_key"]

        return {
            "provider": provider,
            "status": "configured" if validation.get("valid") else "error",
            "validation": validation,
            "masked_credentials": {
                k: self.mask_token(str(v)) if any(sub in k for sub in ("token", "key", "secret")) else v
                for k, v in credentials.items()
            }
        }

    async def validate_credentials(self, provider: str, credentials: Dict[str, Any]) -> Dict[str, Any]:
        """
        Performs a live API check to verify credential validity.
        """
        provider = provider.lower()
        try:
            if provider == "github":
                token = credentials.get("token") or github_client.token
                if not token:
                    return {"valid": False, "message": "GitHub token is empty"}
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(
                        "https://api.github.com/user",
                        headers={"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json", "User-Agent": "Adappty"}
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        return {"valid": True, "message": f"Authenticated as GitHub user '{data.get('login')}'", "user": data.get("login")}
                    elif resp.status_code == 401:
                        return {"valid": False, "message": "Invalid or expired GitHub token (401 Unauthorized)"}
                    return {"valid": True, "message": "Token registered (GitHub API reachable)"}

            elif provider == "slack":
                token = credentials.get("token") or slack_client.token
                if not token:
                    return {"valid": False, "message": "Slack token is empty"}
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(
                        "https://slack.com/api/auth.test",
                        headers={"Authorization": f"Bearer {token}"}
                    )
                    data = resp.json()
                    if data.get("ok"):
                        return {"valid": True, "message": f"Authenticated to Slack workspace '{data.get('team')}' as '{data.get('user')}'"}
                    return {"valid": False, "message": f"Slack validation failed: {data.get('error', 'unknown error')}"}

            elif provider == "appsignal":
                key = credentials.get("api_key") or appsignal_client.api_key
                if not key:
                    return {"valid": False, "message": "AppSignal API key is empty"}
                return {"valid": True, "message": "AppSignal credentials registered"}

            elif provider == "gemini":
                key = credentials.get("api_key") or settings.GEMINI_API_KEY
                if not key:
                    return {"valid": False, "message": "Gemini API key is empty"}
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(f"https://generativelanguage.googleapis.com/v1beta/models?key={key}")
                    if resp.status_code == 200:
                        return {"valid": True, "message": "Gemini API key verified successfully"}
                    return {"valid": False, "message": f"Gemini API returned status {resp.status_code}"}

            return {"valid": True, "message": f"Credentials saved for {provider}"}
        except Exception as e:
            logger.error(f"Error validating {provider} credentials: {e}")
            return {"valid": False, "message": f"Connection error: {str(e)}"}

    async def test_remote_repo(self, repo_url: str, token: Optional[str] = None) -> Dict[str, Any]:
        """
        Tests access to a remote git repository using ls-remote.
        """
        auth_url = repo_url
        if token and repo_url.startswith("https://"):
            auth_url = repo_url.replace("https://", f"https://x-access-token:{token}@")

        try:
            cmd = ["git", "ls-remote", "--heads", auth_url]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            if proc.returncode == 0:
                branches = []
                for line in proc.stdout.strip().splitlines():
                    if "refs/heads/" in line:
                        branches.append(line.split("refs/heads/")[-1])
                return {
                    "accessible": True,
                    "repo_url": repo_url,
                    "branches": branches[:10],
                    "default_branch": "main" if "main" in branches else (branches[0] if branches else "main"),
                    "message": f"Successfully connected to repository ({len(branches)} branches found)"
                }
            else:
                return {
                    "accessible": False,
                    "repo_url": repo_url,
                    "message": f"Failed to access repository: {proc.stderr.strip() or 'Invalid credentials or repository not found'}"
                }
        except Exception as e:
            return {"accessible": False, "repo_url": repo_url, "message": f"Connection error: {str(e)}"}


integration_manager = IntegrationManager()
