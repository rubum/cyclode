from enum import Enum
from pathlib import Path
from typing import Optional, List
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class PolicyLevel(str, Enum):
    AUTO_ALLOW = "auto"
    REQUIRE_APPROVAL = "require_approval"
    DISABLED = "disabled"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Server settings
    PORT: int = 8000
    FRONTEND_PORT: int = 5174
    HOST: str = "0.0.0.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    SECRET_KEY: str = "adappty-secret-key-12345"

    # Workspace and DB
    WORKSPACE_ROOT: str = "/workspaces"
    DATABASE_URL: str = "sqlite+aiosqlite:////data/adappty.db"
    STATIC_DIR: Optional[str] = None

    # Antigravity & Gemini configuration
    GEMINI_API_KEY: Optional[str] = None
    GOOGLE_API_KEY: Optional[str] = None
    ANTIGRAVITY_MODEL: str = "gemini-2.5-flash"
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
    GITHUB_WEBHOOK_SECRET: Optional[str] = "adappty_gh_webhook_secret_123"

    SLACK_BOT_TOKEN: Optional[str] = None
    SLACK_SIGNING_SECRET: Optional[str] = None
    SLACK_DEFAULT_CHANNEL: str = "#adappty-agents"

    APPSIGNAL_API_KEY: Optional[str] = None
    APPSIGNAL_APP_ID: Optional[str] = None
    APPSIGNAL_WEBHOOK_TOKEN: Optional[str] = "adappty_appsignal_token_123"

    SENTRY_AUTH_TOKEN: Optional[str] = None
    SENTRY_ORGANIZATION: Optional[str] = None
    SENTRY_PROJECT: Optional[str] = None

    def get_api_key(self) -> Optional[str]:
        return self.GEMINI_API_KEY or self.GOOGLE_API_KEY


settings = Settings()
