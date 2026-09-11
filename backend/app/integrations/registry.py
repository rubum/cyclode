from typing import Dict, Any, List
from app.config import settings
from app.integrations.github_client import github_client
from app.integrations.slack_client import slack_client
from app.integrations.appsignal_client import appsignal_client


class IntegrationRegistry:
    @staticmethod
    def get_status() -> List[Dict[str, Any]]:
        """
        Returns real-time status and capabilities for all supported integrations.
        """
        return [
            {
                "id": "github",
                "name": "GitHub App & Webhooks",
                "description": "Automated branch creation, pull requests, issue comment updates, and webhook ingestion.",
                "configured": github_client.is_configured(),
                "auth_type": "App ID / Personal Access Token",
                "skills": ["github.create_pr", "github.post_comment", "github.view_issue"],
                "icon": "github"
            },
            {
                "id": "slack",
                "name": "Slack Notifications & Approvals",
                "description": "Real-time task notifications and interactive Block Kit human approval buttons.",
                "configured": slack_client.is_configured(),
                "auth_type": "Bot User OAuth Token",
                "skills": ["slack.post_message", "slack.request_approval"],
                "icon": "slack"
            },
            {
                "id": "appsignal",
                "name": "AppSignal APM Triage",
                "description": "Inbound exception spike alerts, stack trace correlation, and automated fix reproduction.",
                "configured": appsignal_client.is_configured(),
                "auth_type": "API Key & Webhook Token",
                "skills": ["appsignal.inspect_exception", "appsignal.correlate_trace"],
                "icon": "activity"
            },
            {
                "id": "sentry",
                "name": "Sentry Error Monitoring",
                "description": "Error event ingestion and issue linking.",
                "configured": bool(settings.SENTRY_AUTH_TOKEN),
                "auth_type": "Auth Token",
                "skills": ["sentry.fetch_issue"],
                "icon": "alert-triangle"
            }
        ]

    @staticmethod
    def get_active_skills() -> List[str]:
        """
        Returns list of active Antigravity skill IDs based on configured tokens.
        """
        skills = []
        if github_client.is_configured():
            skills.append("github")
        if slack_client.is_configured():
            skills.append("slack")
        if appsignal_client.is_configured():
            skills.append("appsignal")
        return skills


integration_registry = IntegrationRegistry()
