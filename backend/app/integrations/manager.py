import logging
import os
import re
import subprocess
from typing import Dict, Any, Optional, Tuple, List
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
        Auto-resolves token from Vault / environment if not passed explicitly.
        """
        if not token:
            token = await self.get_github_token_for_repo(repo_url)

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
                stderr_text = proc.stderr.strip()
                err_lower = stderr_text.lower()
                is_auth_error = any(kw in err_lower for kw in [
                    "could not read username",
                    "authentication failed",
                    "repository not found",
                    "permission denied",
                    "terminal prompts disabled",
                    "invalid credentials",
                    "please make sure you have the correct access rights"
                ]) or proc.returncode == 128
                return {
                    "accessible": False,
                    "auth_required": is_auth_error,
                    "repo_url": repo_url,
                    "message": f"Failed to access repository: {stderr_text or 'Invalid credentials or repository not found'}"
                }
        except Exception as e:
            return {"accessible": False, "auth_required": True, "repo_url": repo_url, "message": f"Connection error: {str(e)}"}


    async def get_github_token_for_repo(self, repo_name_or_url: Optional[str] = None) -> Optional[str]:
        """
        Retrieves active GitHub token for a specific repository or global token.
        Searches memory client, then looks up decrypted token from RepositoryConfigModel.
        """
        if github_client.token:
            return github_client.token

        if not repo_name_or_url:
            return None

        clean_target = repo_name_or_url.lower().strip().replace(".git", "")
        if "github.com/" in clean_target:
            clean_target = clean_target.split("github.com/")[-1]

        try:
            from app.db.session import async_session_factory
            from app.db.models import RepositoryConfigModel
            from app.core.security import decrypt_secret
            from sqlalchemy import select

            async with async_session_factory() as session:
                stmt = select(RepositoryConfigModel)
                res = await session.execute(stmt)
                repos = res.scalars().all()
                for r in repos:
                    r_full = (r.full_name or "").lower()
                    r_name = (r.name or "").lower()
                    r_clone = (r.clone_url or "").lower()
                    if clean_target in (r_full, r_name) or clean_target in r_clone or r_name in clean_target:
                        if r.encrypted_token:
                            dec = decrypt_secret(r.encrypted_token)
                            if dec:
                                return dec
        except Exception as e:
            logger.debug(f"Repo token resolution note: {e}")

        return None

    async def save_repo_config(
        self,
        repo_url: str,
        token: Optional[str] = None,
        branches: Optional[List[str]] = None,
        tech_stack: Optional[List[str]] = None,
        test_command: Optional[str] = None,
        manifest_cache: Optional[Dict[str, Any]] = None,
        default_branch: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Persists a repository configuration, encrypted token, and architecture profile
        into the database so it remains fully accessible across future sessions.
        """
        try:
            from app.db.session import async_session_factory
            from app.db.models import RepositoryConfigModel, get_utc_now
            from app.core.security import encrypt_secret
            from sqlalchemy import select

            clean_url = repo_url.strip().rstrip(".")
            if "github.com/" in clean_url:
                full_name = clean_url.split("github.com/")[-1].replace(".git", "").strip("/")
            elif "/" in clean_url and not clean_url.startswith("http"):
                full_name = clean_url.replace(".git", "").strip("/")
                clean_url = f"https://github.com/{full_name}"
            else:
                full_name = clean_url
                clean_url = f"https://github.com/{full_name}" if "/" in full_name else clean_url

            name = full_name.split("/")[-1] if "/" in full_name else full_name
            enc_token = encrypt_secret(token) if token else None

            async with async_session_factory() as session:
                stmt = select(RepositoryConfigModel).where(
                    (RepositoryConfigModel.full_name == full_name) |
                    (RepositoryConfigModel.clone_url == clean_url)
                )
                res = await session.execute(stmt)
                existing = res.scalars().first()

                if existing:
                    existing.clone_url = clean_url
                    if enc_token:
                        existing.encrypted_token = enc_token
                    existing.status = "CONNECTED"
                    if default_branch:
                        existing.default_branch = default_branch
                    elif branches and ("main" in branches or "master" in branches):
                        existing.default_branch = "main" if "main" in branches else "master"
                    if test_command:
                        existing.test_command = test_command
                    if tech_stack is not None:
                        existing.tech_stack = tech_stack
                    
                    m_cache = dict(existing.manifest_cache or {})
                    if branches:
                        m_cache["branches"] = branches[:10]
                    if manifest_cache:
                        m_cache.update(manifest_cache)
                    existing.manifest_cache = m_cache
                    existing.last_synced_at = get_utc_now()
                else:
                    m_cache = {"branches": branches[:10]} if branches else {}
                    if manifest_cache:
                        m_cache.update(manifest_cache)

                    new_repo = RepositoryConfigModel(
                        name=name,
                        full_name=full_name,
                        clone_url=clean_url,
                        default_branch=default_branch or ("main" if not branches or "main" in branches else branches[0]),
                        encrypted_token=enc_token,
                        auth_provider="github",
                        status="CONNECTED",
                        tech_stack=tech_stack or [],
                        test_command=test_command,
                        manifest_cache=m_cache,
                        created_at=get_utc_now(),
                        updated_at=get_utc_now(),
                    )
                    session.add(new_repo)

                await session.commit()
            return {"ok": True, "full_name": full_name}
        except Exception as e:
            logger.warning(f"Error persisting repo config: {e}")
            return {"ok": False, "error": str(e)}


integration_manager = IntegrationManager()

