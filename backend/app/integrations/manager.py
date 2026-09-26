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
from app.integrations.linear_client import linear_client

logger = logging.getLogger("cyclode.integrations")


class IntegrationManager:
    """
    Manages in-memory and persistent credential state, performs validation handshakes,
    and supports conversational ChatOps credential provisioning.
    """

    def __init__(self):
        self._custom_credentials: Dict[str, Dict[str, Any]] = {}
        self._load_persisted_credentials()

    def _load_persisted_credentials(self) -> None:
        """
        Loads credentials persisted in ~/.cyclode/config.json into runtime state.
        """
        try:
            from cyclode.config import load_user_config
            cfg = load_user_config()
            if not cfg:
                return

            # Gemini
            if cfg.get("gemini_api_key"):
                self._custom_credentials.setdefault("gemini", {})["api_key"] = cfg["gemini_api_key"]
                if not settings.GEMINI_API_KEY:
                    settings.GEMINI_API_KEY = cfg["gemini_api_key"]
            if cfg.get("gemini_model"):
                self._custom_credentials.setdefault("gemini", {})["model"] = cfg["gemini_model"]

            # DeepSeek
            if cfg.get("deepseek_api_key"):
                self._custom_credentials.setdefault("deepseek", {})["api_key"] = cfg["deepseek_api_key"]
                if not settings.DEEPSEEK_API_KEY:
                    settings.DEEPSEEK_API_KEY = cfg["deepseek_api_key"]
            if cfg.get("deepseek_base_url"):
                self._custom_credentials.setdefault("deepseek", {})["base_url"] = cfg["deepseek_base_url"]
                if not settings.DEEPSEEK_BASE_URL:
                    settings.DEEPSEEK_BASE_URL = cfg["deepseek_base_url"]
            if cfg.get("deepseek_model"):
                self._custom_credentials.setdefault("deepseek", {})["model"] = cfg["deepseek_model"]

            # Anthropic
            if cfg.get("anthropic_api_key"):
                self._custom_credentials.setdefault("anthropic", {})["api_key"] = cfg["anthropic_api_key"]
                if not settings.ANTHROPIC_API_KEY:
                    settings.ANTHROPIC_API_KEY = cfg["anthropic_api_key"]
            if cfg.get("anthropic_model"):
                self._custom_credentials.setdefault("anthropic", {})["model"] = cfg["anthropic_model"]

            # OpenAI
            if cfg.get("openai_api_key"):
                self._custom_credentials.setdefault("openai", {})["api_key"] = cfg["openai_api_key"]
                if not settings.OPENAI_API_KEY:
                    settings.OPENAI_API_KEY = cfg["openai_api_key"]
            if cfg.get("openai_base_url"):
                self._custom_credentials.setdefault("openai", {})["base_url"] = cfg["openai_base_url"]
                if not settings.OPENAI_BASE_URL:
                    settings.OPENAI_BASE_URL = cfg["openai_base_url"]
            if cfg.get("openai_model"):
                self._custom_credentials.setdefault("openai", {})["model"] = cfg["openai_model"]

            # GitHub
            if cfg.get("github_token"):
                self._custom_credentials.setdefault("github", {})["token"] = cfg["github_token"]
                if not github_client.token:
                    github_client.token = cfg["github_token"]

            # Slack
            if cfg.get("slack_token"):
                self._custom_credentials.setdefault("slack", {})["token"] = cfg["slack_token"]
                if not slack_client.token:
                    slack_client.token = cfg["slack_token"]

            # Linear
            if cfg.get("linear_api_key") or cfg.get("linear_token"):
                tok = cfg.get("linear_api_key") or cfg.get("linear_token")
                self._custom_credentials.setdefault("linear", {})["token"] = tok
                if not linear_client.token:
                    linear_client.token = tok
        except Exception as e:
            logger.debug(f"Persisted credentials bootstrap note: {e}")

    def get_custom_credential(self, provider: str, key: str = "api_key") -> Optional[str]:
        """
        Retrieves active credential for a provider from memory, config.json, settings, or os.environ.
        """
        provider = (provider or "").lower().strip()
        # 1. Check in-memory custom credentials
        val = self._custom_credentials.get(provider, {}).get(key)
        if val:
            return str(val).strip()

        # 2. Check dynamic ~/.cyclode/config.json
        try:
            from cyclode.config import load_user_config
            cfg = load_user_config()
            cfg_key = f"{provider}_{key}" if key != "token" else f"{provider}_token"
            if cfg.get(cfg_key):
                self._custom_credentials.setdefault(provider, {})[key] = cfg[cfg_key]
                return str(cfg[cfg_key]).strip()
            if key == "api_key" and cfg.get(f"{provider}_api_key"):
                self._custom_credentials.setdefault(provider, {})["api_key"] = cfg[f"{provider}_api_key"]
                return str(cfg[f"{provider}_api_key"]).strip()
        except Exception:
            pass

        # 3. Check Settings & os.environ
        if provider in ["google", "gemini"]:
            return settings.get_api_key()
        elif provider == "deepseek":
            if key == "api_key":
                return settings.get_deepseek_api_key()
            elif key == "base_url":
                return settings.DEEPSEEK_BASE_URL or os.environ.get("DEEPSEEK_BASE_URL")
        elif provider == "openai":
            if key == "api_key":
                return settings.get_openai_api_key()
            elif key == "base_url":
                return settings.OPENAI_BASE_URL or os.environ.get("OPENAI_BASE_URL")
        elif provider in ["anthropic", "claude"]:
            return settings.get_anthropic_api_key()
        elif provider == "github" and key in ["token", "api_key"]:
            return github_client.token or settings.GITHUB_TOKEN or os.environ.get("GITHUB_TOKEN")
        elif provider == "slack" and key in ["token", "api_key"]:
            return slack_client.token or settings.SLACK_BOT_TOKEN or os.environ.get("SLACK_BOT_TOKEN")
        elif provider == "linear" and key in ["token", "api_key"]:
            return linear_client.token or settings.LINEAR_API_KEY or os.environ.get("LINEAR_API_KEY")

        return None

    def is_configured(self, provider: str) -> bool:
        """
        Determines whether a given provider has valid configured credentials in vault, config, settings, or env.
        """
        provider = (provider or "").lower().strip()
        if provider in ["google", "gemini"]:
            return bool(self.get_custom_credential("gemini", "api_key") or settings.get_api_key())
        elif provider == "deepseek":
            return bool(self.get_custom_credential("deepseek", "api_key") or settings.get_deepseek_api_key())
        elif provider == "openai":
            return bool(self.get_custom_credential("openai", "api_key") or settings.get_openai_api_key())
        elif provider in ["anthropic", "claude"]:
            return bool(self.get_custom_credential("anthropic", "api_key") or settings.get_anthropic_api_key())
        elif provider == "github":
            return github_client.is_configured() or bool(self.get_custom_credential("github", "token"))
        elif provider == "slack":
            return slack_client.is_configured() or bool(self.get_custom_credential("slack", "token"))
        elif provider == "linear":
            return linear_client.is_configured() or bool(self.get_custom_credential("linear", "token"))
        elif provider == "appsignal":
            return appsignal_client.is_configured() or bool(self.get_custom_credential("appsignal", "api_key"))
        elif provider == "sentry":
            return bool(settings.SENTRY_AUTH_TOKEN or os.environ.get("SENTRY_AUTH_TOKEN"))
        return False

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
        # Fallback to existing configured secrets if user is updating only model or base_url
        if provider == "deepseek" and not credentials.get("api_key"):
            existing = self.get_custom_credential("deepseek", "api_key") or settings.get_deepseek_api_key()
            if existing:
                credentials["api_key"] = existing
        elif provider == "openai" and not credentials.get("api_key"):
            existing = self.get_custom_credential("openai", "api_key") or settings.get_openai_api_key()
            if existing:
                credentials["api_key"] = existing
        elif provider in ["anthropic", "claude"] and not credentials.get("api_key"):
            existing = self.get_custom_credential("anthropic", "api_key") or settings.get_anthropic_api_key()
            if existing:
                credentials["api_key"] = existing
        elif provider in ["gemini", "google"] and not credentials.get("api_key"):
            existing = self.get_custom_credential("gemini", "api_key") or settings.get_api_key()
            if existing:
                credentials["api_key"] = existing
        elif provider == "github" and not credentials.get("token"):
            existing = self.get_custom_credential("github", "token") or github_client.token
            if existing:
                credentials["token"] = existing
        elif provider == "slack" and not credentials.get("token"):
            existing = self.get_custom_credential("slack", "token") or slack_client.token
            if existing:
                credentials["token"] = existing
        elif provider == "linear" and not credentials.get("token") and not credentials.get("api_key"):
            existing = self.get_custom_credential("linear", "token") or linear_client.token
            if existing:
                credentials["token"] = existing

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
            elif provider == "linear":
                if "token" in credentials:
                    linear_client.token = credentials["token"]
                elif "api_key" in credentials:
                    linear_client.token = credentials["api_key"]
            elif provider == "gemini":
                if "api_key" in credentials:
                    os.environ["GEMINI_API_KEY"] = credentials["api_key"]
                    settings.GEMINI_API_KEY = credentials["api_key"]
                if "model" in credentials or "default_model" in credentials:
                    mod = credentials.get("model") or credentials.get("default_model")
                    settings.GEMINI_DEFAULT_MODEL = mod
                    settings.ANTIGRAVITY_MODEL = mod
            elif provider == "deepseek":
                if "api_key" in credentials:
                    os.environ["DEEPSEEK_API_KEY"] = credentials["api_key"]
                    settings.DEEPSEEK_API_KEY = credentials["api_key"]
                if "base_url" in credentials:
                    os.environ["DEEPSEEK_BASE_URL"] = credentials["base_url"]
                    settings.DEEPSEEK_BASE_URL = credentials["base_url"]
                if "model" in credentials or "default_model" in credentials:
                    mod = credentials.get("model") or credentials.get("default_model")
                    settings.DEEPSEEK_DEFAULT_MODEL = mod
            elif provider == "anthropic":
                if "api_key" in credentials:
                    os.environ["ANTHROPIC_API_KEY"] = credentials["api_key"]
                    settings.ANTHROPIC_API_KEY = credentials["api_key"]
                if "model" in credentials or "default_model" in credentials:
                    mod = credentials.get("model") or credentials.get("default_model")
                    settings.ANTHROPIC_DEFAULT_MODEL = mod
            elif provider == "openai":
                if "api_key" in credentials:
                    os.environ["OPENAI_API_KEY"] = credentials["api_key"]
                    settings.OPENAI_API_KEY = credentials["api_key"]
                if "base_url" in credentials:
                    os.environ["OPENAI_BASE_URL"] = credentials["base_url"]
                    settings.OPENAI_BASE_URL = credentials["base_url"]
                if "model" in credentials or "default_model" in credentials:
                    mod = credentials.get("model") or credentials.get("default_model")
                    settings.OPENAI_DEFAULT_MODEL = mod

            # Persist credentials to ~/.cyclode/config.json
            try:
                from cyclode.config import save_user_config
                cfg_updates = {}
                if provider == "deepseek":
                    if "api_key" in credentials:
                        cfg_updates["deepseek_api_key"] = credentials["api_key"]
                    if "base_url" in credentials:
                        cfg_updates["deepseek_base_url"] = credentials["base_url"]
                    if "model" in credentials or "default_model" in credentials:
                        cfg_updates["deepseek_model"] = credentials.get("model") or credentials.get("default_model")
                elif provider == "openai":
                    if "api_key" in credentials:
                        cfg_updates["openai_api_key"] = credentials["api_key"]
                    if "base_url" in credentials:
                        cfg_updates["openai_base_url"] = credentials["base_url"]
                    if "model" in credentials or "default_model" in credentials:
                        cfg_updates["openai_model"] = credentials.get("model") or credentials.get("default_model")
                elif provider == "anthropic":
                    if "api_key" in credentials:
                        cfg_updates["anthropic_api_key"] = credentials["api_key"]
                    if "model" in credentials or "default_model" in credentials:
                        cfg_updates["anthropic_model"] = credentials.get("model") or credentials.get("default_model")
                elif provider == "gemini":
                    if "api_key" in credentials:
                        cfg_updates["gemini_api_key"] = credentials["api_key"]
                    if "model" in credentials or "default_model" in credentials:
                        cfg_updates["gemini_model"] = credentials.get("model") or credentials.get("default_model")
                if cfg_updates:
                    save_user_config(cfg_updates)
            except Exception as e:
                logger.debug(f"User config persistence note: {e}")

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
                        headers={"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json", "User-Agent": "Cyclode"}
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

            elif provider == "linear":
                token = credentials.get("token") or credentials.get("api_key") or linear_client.token
                if not token:
                    return {"valid": False, "message": "Linear API token is empty"}
                clean_auth = token if token.startswith("Bearer ") else f"Bearer {token}"
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(
                        "https://api.linear.app/graphql",
                        json={"query": "query { viewer { id name email } }"},
                        headers={"Authorization": clean_auth}
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        viewer = data.get("data", {}).get("viewer", {})
                        if viewer and viewer.get("name"):
                            return {"valid": True, "message": f"Authenticated to Linear as '{viewer.get('name')}' ({viewer.get('email')})", "user": viewer.get("name")}
                        return {"valid": True, "message": "Linear API key registered successfully"}
                    elif resp.status_code == 401:
                        return {"valid": False, "message": "Invalid or expired Linear API key (401 Unauthorized)"}
                    return {"valid": True, "message": f"Linear API returned status {resp.status_code}"}

            elif provider == "gemini":
                key = credentials.get("api_key") or settings.get_api_key()
                if not key:
                    return {"valid": False, "message": "Gemini API key is empty"}
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(f"https://generativelanguage.googleapis.com/v1beta/models?key={key}")
                    if resp.status_code == 200:
                        return {"valid": True, "message": "Gemini API key verified successfully"}
                    return {"valid": False, "message": f"Gemini API returned status {resp.status_code}"}

            elif provider == "anthropic":
                key = credentials.get("api_key") or settings.get_anthropic_api_key()
                if not key:
                    return {"valid": False, "message": "Anthropic API key is empty"}
                async with httpx.AsyncClient(timeout=10.0) as client:
                    # Probe with dummy request or minimal messages call
                    resp = await client.post(
                        "https://api.anthropic.com/v1/messages",
                        headers={
                            "x-api-key": key,
                            "anthropic-version": "2023-06-01",
                            "content-type": "application/json"
                        },
                        json={
                            "model": "claude-3-5-haiku-20241022",
                            "max_tokens": 1,
                            "messages": [{"role": "user", "content": "ping"}]
                        }
                    )
                    if resp.status_code == 200:
                        return {"valid": True, "message": "Anthropic API key verified successfully"}
                    elif resp.status_code == 401:
                        return {"valid": False, "message": "Invalid Anthropic API key (401 Unauthorized)"}
                    elif resp.status_code == 400 and "credit balance" in resp.text.lower():
                        return {"valid": False, "message": "Anthropic credit balance is too low"}
                    elif resp.status_code in [400, 429]:
                        return {"valid": True, "message": "Anthropic API key authenticated"}
                    return {"valid": False, "message": f"Anthropic API returned status {resp.status_code}"}

            elif provider == "deepseek":
                key = (credentials.get("api_key") or settings.get_deepseek_api_key() or "").strip()
                base_url = (credentials.get("base_url") or settings.DEEPSEEK_BASE_URL or "https://api.deepseek.com").strip().rstrip("/")
                if not key:
                    return {"valid": False, "message": "DeepSeek API key is empty"}
                
                check_url = f"{base_url}/models"
                if "api.deepseek.com" in base_url and base_url.endswith("/anthropic"):
                    check_url = "https://api.deepseek.com/models"

                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(
                        check_url,
                        headers={"Authorization": f"Bearer {key}"}
                    )
                    if resp.status_code == 200:
                        return {"valid": True, "message": "DeepSeek API key verified successfully"}
                    elif resp.status_code == 401:
                        return {"valid": False, "message": "Invalid DeepSeek API key (401 Unauthorized)"}
                    elif resp.status_code == 402:
                        return {"valid": True, "message": "DeepSeek API key authenticated (Insufficient Balance)"}
                    elif resp.status_code in [400, 429]:
                        return {"valid": True, "message": "DeepSeek API key authenticated"}
                    return {"valid": False, "message": f"DeepSeek API returned status {resp.status_code}"}

            elif provider == "openai":
                key = credentials.get("api_key") or settings.get_openai_api_key()
                base_url = (credentials.get("base_url") or settings.OPENAI_BASE_URL or "https://api.openai.com/v1").rstrip("/")
                if not key:
                    return {"valid": False, "message": "OpenAI API key is empty"}
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(
                        f"{base_url}/models",
                        headers={"Authorization": f"Bearer {key}"}
                    )
                    if resp.status_code == 200:
                        return {"valid": True, "message": "OpenAI API key verified successfully"}
                    elif resp.status_code == 401:
                        return {"valid": False, "message": "Invalid OpenAI API key (401 Unauthorized)"}
                    return {"valid": False, "message": f"OpenAI API returned status {resp.status_code}"}

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

    async def install_repo_webhook(
        self,
        full_name: str,
        webhook_url: str,
        secret: Optional[str] = None,
        custom_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Installs a GitHub webhook listener on the specified repository.
        """
        clean_name = full_name.replace("https://github.com/", "").replace(".git", "").strip("/")
        if "/" not in clean_name:
            return {"success": False, "message": f"Invalid repository full name: {full_name}"}

        owner, repo = clean_name.split("/", 1)
        token = custom_token or await self.get_github_token_for_repo(full_name) or github_client.token
        sec = secret or settings.GITHUB_WEBHOOK_SECRET

        return await github_client.create_or_update_webhook(
            owner=owner,
            repo=repo,
            webhook_url=webhook_url,
            secret=sec,
            custom_token=token
        )

    async def get_repo_webhook_status(
        self,
        full_name: str,
        webhook_url: Optional[str] = None,
        custom_token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Checks active webhook registration status on GitHub.
        """
        clean_name = full_name.replace("https://github.com/", "").replace(".git", "").strip("/")
        if "/" not in clean_name:
            return {"configured": False, "webhooks": []}

        owner, repo = clean_name.split("/", 1)
        token = custom_token or await self.get_github_token_for_repo(full_name) or github_client.token

        res = await github_client.list_webhooks(owner, repo, custom_token=token)
        hooks = res.get("webhooks", [])

        is_registered = False
        matched_hook = None
        if webhook_url and isinstance(hooks, list):
            for h in hooks:
                if isinstance(h, dict) and h.get("config", {}).get("url") == webhook_url:
                    is_registered = True
                    matched_hook = h
                    break

        return {
            "configured": res.get("configured", bool(token)),
            "is_registered": is_registered,
            "matched_hook": matched_hook,
            "total_webhooks": len(hooks) if isinstance(hooks, list) else 0,
            "webhooks": hooks if isinstance(hooks, list) else []
        }

    def get_model_settings(self) -> Dict[str, Any]:
        """
        Returns active model orchestration settings including routing mode,
        tier assignments (major/minor), and per-provider model configurations.
        """
        return {
            "routing_mode": settings.ANTIGRAVITY_ROUTING_MODE,
            "major_model": settings.ANTIGRAVITY_MAJOR_MODEL,
            "minor_model": settings.ANTIGRAVITY_MINOR_MODEL,
            "default_model": settings.ANTIGRAVITY_MODEL,
            "providers": {
                "gemini": {
                    "model": settings.GEMINI_DEFAULT_MODEL,
                    "configured": self.is_configured("gemini"),
                },
                "deepseek": {
                    "model": settings.DEEPSEEK_DEFAULT_MODEL,
                    "base_url": settings.DEEPSEEK_BASE_URL,
                    "configured": self.is_configured("deepseek"),
                },
                "anthropic": {
                    "model": settings.ANTHROPIC_DEFAULT_MODEL,
                    "configured": self.is_configured("anthropic"),
                },
                "openai": {
                    "model": settings.OPENAI_DEFAULT_MODEL,
                    "base_url": settings.OPENAI_BASE_URL,
                    "configured": self.is_configured("openai"),
                }
            }
        }

    def update_model_settings(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        """
        Dynamically updates model orchestration settings and tier assignments.
        """
        if "routing_mode" in updates and updates["routing_mode"]:
            settings.ANTIGRAVITY_ROUTING_MODE = updates["routing_mode"]
        if "major_model" in updates and updates["major_model"]:
            settings.ANTIGRAVITY_MAJOR_MODEL = updates["major_model"]
        if "minor_model" in updates and updates["minor_model"]:
            settings.ANTIGRAVITY_MINOR_MODEL = updates["minor_model"]
        if "default_model" in updates and updates["default_model"]:
            settings.ANTIGRAVITY_MODEL = updates["default_model"]

        # Provider overrides
        if "gemini_model" in updates and updates["gemini_model"]:
            settings.GEMINI_DEFAULT_MODEL = updates["gemini_model"]
        if "deepseek_model" in updates and updates["deepseek_model"]:
            settings.DEEPSEEK_DEFAULT_MODEL = updates["deepseek_model"]
        if "deepseek_base_url" in updates:
            settings.DEEPSEEK_BASE_URL = updates["deepseek_base_url"]
        if "anthropic_model" in updates and updates["anthropic_model"]:
            settings.ANTHROPIC_DEFAULT_MODEL = updates["anthropic_model"]
        if "openai_model" in updates and updates["openai_model"]:
            settings.OPENAI_DEFAULT_MODEL = updates["openai_model"]
        if "openai_base_url" in updates:
            settings.OPENAI_BASE_URL = updates["openai_base_url"]

        # Persist model settings to ~/.cyclode/config.json
        try:
            from cyclode.config import save_user_config
            cfg_updates: Dict[str, Any] = {}
            if "routing_mode" in updates and updates["routing_mode"]:
                cfg_updates["routing_mode"] = updates["routing_mode"]
            if "major_model" in updates and updates["major_model"]:
                cfg_updates["major_model"] = updates["major_model"]
            if "minor_model" in updates and updates["minor_model"]:
                cfg_updates["minor_model"] = updates["minor_model"]
            if "default_model" in updates and updates["default_model"]:
                cfg_updates["model"] = updates["default_model"]
            if "gemini_model" in updates and updates["gemini_model"]:
                cfg_updates["gemini_model"] = updates["gemini_model"]
            if "deepseek_model" in updates and updates["deepseek_model"]:
                cfg_updates["deepseek_model"] = updates["deepseek_model"]
            if "deepseek_base_url" in updates:
                cfg_updates["deepseek_base_url"] = updates["deepseek_base_url"]
            if "anthropic_model" in updates and updates["anthropic_model"]:
                cfg_updates["anthropic_model"] = updates["anthropic_model"]
            if "openai_model" in updates and updates["openai_model"]:
                cfg_updates["openai_model"] = updates["openai_model"]
            if "openai_base_url" in updates:
                cfg_updates["openai_base_url"] = updates["openai_base_url"]
            if cfg_updates:
                save_user_config(cfg_updates)
        except Exception as e:
            logger.debug(f"User config model settings persistence note: {e}")

        return self.get_model_settings()


integration_manager = IntegrationManager()

