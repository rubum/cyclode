import os
import json
from enum import Enum
from pathlib import Path
from typing import Optional, List, Dict, Any
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


def _load_cyclode_user_config() -> Dict[str, Any]:
    env_home = os.environ.get("CYCLODE_HOME")
    config_file = (Path(env_home).resolve() if env_home else Path.home() / ".cyclode") / "config.json"
    if config_file.exists():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


_USER_CFG = _load_cyclode_user_config()


class PolicyLevel(str, Enum):
    AUTO_ALLOW = "auto"
    REQUIRE_APPROVAL = "require_approval"
    DISABLED = "disabled"


def _default_database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env_home = os.environ.get("CYCLODE_HOME")
    if env_home:
        home = Path(env_home).resolve()
        return f"sqlite+aiosqlite:///{home / 'data' / 'cyclode.db'}"
    if Path("/data").exists() and Path("/data").is_dir():
        return "sqlite+aiosqlite:////data/cyclode.db"
    home = Path.home() / ".cyclode"
    return f"sqlite+aiosqlite:///{home / 'data' / 'cyclode.db'}"


def _default_workspace_root() -> str:
    if os.environ.get("WORKSPACE_ROOT"):
        return os.environ["WORKSPACE_ROOT"]
    env_home = os.environ.get("CYCLODE_HOME")
    if env_home:
        home = Path(env_home).resolve()
        return str(home / "workspaces")
    if Path("/workspaces").exists() and Path("/workspaces").is_dir():
        return "/workspaces"
    home = Path.home() / ".cyclode"
    return str(home / "workspaces")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Server settings
    PORT: int = Field(default_factory=lambda: int(_USER_CFG.get("port", 8000)))
    FRONTEND_PORT: int = 5174
    HOST: str = Field(default_factory=lambda: str(_USER_CFG.get("host", "0.0.0.0")))
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    SECRET_KEY: str = "cyclode-secret-key-12345"

    # Workspace and DB
    WORKSPACE_ROOT: str = Field(default_factory=_default_workspace_root)
    HOST_WORKSPACE_ROOT: Optional[str] = None
    DATABASE_URL: str = Field(default_factory=_default_database_url)
    STATIC_DIR: Optional[str] = None

    # LLM Provider configuration
    GEMINI_API_KEY: Optional[str] = Field(default_factory=lambda: _USER_CFG.get("gemini_api_key") or os.environ.get("GEMINI_API_KEY"))
    GOOGLE_API_KEY: Optional[str] = Field(default_factory=lambda: os.environ.get("GOOGLE_API_KEY"))
    ANTHROPIC_API_KEY: Optional[str] = Field(default_factory=lambda: _USER_CFG.get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY"))
    OPENAI_API_KEY: Optional[str] = Field(default_factory=lambda: _USER_CFG.get("openai_api_key") or os.environ.get("OPENAI_API_KEY"))
    OPENAI_BASE_URL: Optional[str] = Field(default_factory=lambda: _USER_CFG.get("openai_base_url") or os.environ.get("OPENAI_BASE_URL"))

    ANTIGRAVITY_MODEL: str = Field(default_factory=lambda: str(_USER_CFG.get("model", "gemini-3.7-flash")))
    ANTIGRAVITY_ROUTING_MODE: str = Field(default_factory=lambda: str(_USER_CFG.get("routing_mode", "adaptive")))  # "adaptive" vs "manual"
    ANTIGRAVITY_MAJOR_MODEL: str = Field(default_factory=lambda: str(_USER_CFG.get("major_model", "claude-fable-5-1")))
    ANTIGRAVITY_MINOR_MODEL: str = Field(default_factory=lambda: str(_USER_CFG.get("minor_model", "gemini-3.7-flash")))
    GEMINI_DEFAULT_MODEL: str = Field(default_factory=lambda: str(_USER_CFG.get("gemini_model", "gemini-3.7-flash")))
    ANTHROPIC_DEFAULT_MODEL: str = Field(default_factory=lambda: str(_USER_CFG.get("anthropic_model", "claude-fable-5-1")))
    OPENAI_DEFAULT_MODEL: str = Field(default_factory=lambda: str(_USER_CFG.get("openai_model", "gpt-6-astra")))
    ANTIGRAVITY_ENABLE_THINKING: bool = True
    ANTIGRAVITY_MAX_PARALLEL_WORKERS: int = 5
    ANTIGRAVITY_EXECUTION_TIMEOUT_SECONDS: int = 600

    # Action Approval Policies
    POLICY_GIT_PUSH: PolicyLevel = PolicyLevel.REQUIRE_APPROVAL
    POLICY_CREATE_PR: PolicyLevel = PolicyLevel.REQUIRE_APPROVAL
    POLICY_POST_COMMENTS: PolicyLevel = PolicyLevel.AUTO_ALLOW
    POLICY_SLACK_NOTIFY: PolicyLevel = PolicyLevel.AUTO_ALLOW
    POLICY_MERGE_PR: PolicyLevel = PolicyLevel.REQUIRE_APPROVAL
    POLICY_EXECUTE_SHELL: PolicyLevel = PolicyLevel.AUTO_ALLOW

    # Plug-and-play integrations
    GITHUB_TOKEN: Optional[str] = None
    GITHUB_APP_ID: Optional[str] = None
    GITHUB_PRIVATE_KEY_PATH: Optional[str] = None
    GITHUB_INSTALLATION_ID: Optional[str] = None
    GITHUB_WEBHOOK_SECRET: Optional[str] = "cyclode_gh_webhook_secret_123"

    SLACK_BOT_TOKEN: Optional[str] = None
    SLACK_SIGNING_SECRET: Optional[str] = None
    SLACK_DEFAULT_CHANNEL: str = "#cyclode-agents"

    APPSIGNAL_API_KEY: Optional[str] = None
    APPSIGNAL_APP_ID: Optional[str] = None
    APPSIGNAL_WEBHOOK_TOKEN: Optional[str] = "cyclode_appsignal_token_123"

    SENTRY_AUTH_TOKEN: Optional[str] = None
    SENTRY_ORGANIZATION: Optional[str] = None
    SENTRY_PROJECT: Optional[str] = None

    LINEAR_API_KEY: Optional[str] = Field(default_factory=lambda: _USER_CFG.get("linear_api_key"))

    def get_api_key(self) -> Optional[str]:
        return self.GEMINI_API_KEY or self.GOOGLE_API_KEY

    def get_anthropic_api_key(self) -> Optional[str]:
        return self.ANTHROPIC_API_KEY or os.environ.get("ANTHROPIC_API_KEY")

    def get_openai_api_key(self) -> Optional[str]:
        return self.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY")


settings = Settings()


