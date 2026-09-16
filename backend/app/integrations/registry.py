import os
from typing import Dict, Any, List
from app.config import settings
from app.integrations.github_client import github_client
from app.integrations.slack_client import slack_client
from app.integrations.appsignal_client import appsignal_client
from app.integrations.linear_client import linear_client


class IntegrationRegistry:
    @staticmethod
    def get_status() -> List[Dict[str, Any]]:
        """
        Returns real-time status and capabilities for all supported integrations.
        """
        return [
            {
                "id": "gemini",
                "name": "Google Gemini & AI Studio",
                "description": "Powers autonomous agent reasoning, multi-turn pair programming, and asynchronous title synthesis.",
                "configured": bool(settings.get_api_key() or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")),
                "auth_type": "API Key",
                "skills": ["gemini.generate_content", "gemini.synthesize_titles"],
                "icon": "sparkles"
            },
            {
                "id": "anthropic",
                "name": "Anthropic Claude",
                "description": "Powers deep reasoning, Claude 3.7 Sonnet hybrid thinking, and extended coding agents.",
                "configured": bool(settings.get_anthropic_api_key()),
                "auth_type": "API Key",
                "skills": ["claude.messages_stream", "claude.hybrid_thinking"],
                "icon": "bot"
            },
            {
                "id": "openai",
                "name": "OpenAI & Codex",
                "description": "Powers GPT-4o, Codex coding workflows, and o1/o3-mini reasoning loops.",
                "configured": bool(settings.get_openai_api_key()),
                "auth_type": "API Key",
                "skills": ["openai.chat_completions", "openai.reasoning_effort"],
                "icon": "cpu"
            },
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
                "id": "linear",
                "name": "Linear Issue Tracking",
                "description": "Native issue inspection, status updates, team sync, and agent ticket execution.",
                "configured": linear_client.is_configured(),
                "auth_type": "API Key / Personal Token",
                "skills": ["linear.get_issue", "linear.update_status", "linear.post_comment"],
                "icon": "zap"
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
    def get_skills_catalog() -> List[Dict[str, Any]]:
        """
        Returns all mounted Antigravity Skills in the harness with their tool schemas,
        filepaths, and active runtime readiness status.
        """
        return [
            {
                "id": "github",
                "name": "GitHub Workflow & PR Automation",
                "path": ".agents/skills/github/SKILL.md",
                "description": "Enables the agent to inspect GitHub issues, create branches following conventions, and draft Pull Requests.",
                "tools": ["github.create_pr", "github.post_comment", "github.view_issue"],
                "status": "ACTIVE" if github_client.is_configured() else "AUTH_REQUIRED",
                "category": "Version Control"
            },
            {
                "id": "slack",
                "name": "Slack Notifications & Human Approvals",
                "path": ".agents/skills/slack/SKILL.md",
                "description": "Enables the agent to post structured progress alerts, ask human questions, and send Block Kit approval request cards.",
                "tools": ["slack.post_message", "slack.request_approval"],
                "status": "ACTIVE" if slack_client.is_configured() else "AUTH_REQUIRED",
                "category": "Collaboration"
            },
            {
                "id": "appsignal",
                "name": "AppSignal APM & Exception Triage",
                "path": ".agents/skills/appsignal/SKILL.md",
                "description": "Enables the agent to inspect exception stack traces, sample parameters, and reproduce production crashes.",
                "tools": ["appsignal.inspect_exception", "appsignal.correlate_trace"],
                "status": "ACTIVE" if appsignal_client.is_configured() else "AUTH_REQUIRED",
                "category": "Observability"
            },
            {
                "id": "linear",
                "name": "Linear Issue Triage & Action Sync",
                "path": ".agents/skills/linear/SKILL.md",
                "description": "Enables the agent to inspect Linear tickets, post progress comments, and update issue states.",
                "tools": ["linear.get_issue", "linear.update_status", "linear.post_comment"],
                "status": "ACTIVE" if linear_client.is_configured() else "AUTH_REQUIRED",
                "category": "Project Management"
            },
            {
                "id": "sentry",
                "name": "Sentry APM & Issue Triage",
                "path": ".agents/skills/sentry/SKILL.md",
                "description": "Fetches Sentry issue stack traces, inspects breadcrumbs, and correlates exceptions with workspace source code.",
                "tools": ["sentry.fetch_issue"],
                "status": "ACTIVE" if bool(settings.SENTRY_AUTH_TOKEN) else "AUTH_REQUIRED",
                "category": "Observability"
            },
            {
                "id": "git-worktree",
                "name": "Git Worktree Isolation",
                "path": ".agents/skills/git-worktree/SKILL.md",
                "description": "Isolates task execution in ephemeral git worktrees without interfering with the primary branch or ongoing tasks.",
                "tools": ["git.create_worktree", "git.cleanup_worktree"],
                "status": "ACTIVE",
                "category": "Core Runtime"
            },
            {
                "id": "codebase-analyzer",
                "name": "Codebase Architecture Analyzer",
                "path": ".agents/skills/codebase-analyzer/SKILL.md",
                "description": "Inspects architecture patterns, dependency graphs, project manifests, and directory topology.",
                "tools": ["codebase.analyze_structure", "codebase.inspect_manifests"],
                "status": "ACTIVE",
                "category": "Core Runtime"
            },
            {
                "id": "test-runner",
                "name": "Automated Test Verification Harness",
                "path": ".agents/skills/test-runner/SKILL.md",
                "description": "Discovers repository test runners (pytest, jest, vitest, cargo test) and verifies code changes before PR generation.",
                "tools": ["test.run_suite", "test.inspect_failures"],
                "status": "ACTIVE",
                "category": "Verification"
            },
            {
                "id": "web-research",
                "name": "Live Web Research & Intelligence",
                "path": ".agents/skills/web-research/SKILL.md",
                "description": "Performs real-time web searches, scrapes technical documentation, and synthesizes analytical intelligence briefings.",
                "tools": ["web.search", "web.fetch_page", "web.synthesize"],
                "status": "ACTIVE",
                "category": "Intelligence"
            }
        ]

    @staticmethod
    def get_webhook_endpoints() -> List[Dict[str, Any]]:
        """
        Returns live inbound webhook endpoints exposed by the Cyclode Gateway.
        """
        return [
            {
                "id": "github_webhook",
                "provider": "github",
                "name": "GitHub Webhook Gateway",
                "path": "/api/webhooks/github",
                "method": "POST",
                "secret_configured": bool(settings.GITHUB_WEBHOOK_SECRET),
                "events": ["issues.opened", "issues.labeled", "pull_request.opened", "issue_comment.created"],
                "description": "Ingests issue triage events and PR reviews from GitHub repositories."
            },
            {
                "id": "slack_webhook",
                "provider": "slack",
                "name": "Slack Interactive Gateway",
                "path": "/api/webhooks/slack",
                "method": "POST",
                "secret_configured": bool(settings.SLACK_SIGNING_SECRET),
                "events": ["block_actions", "interactive_approval", "slash_command"],
                "description": "Receives user approval button clicks and Slack slash commands."
            },
            {
                "id": "appsignal_webhook",
                "provider": "appsignal",
                "name": "AppSignal Exception Gateway",
                "path": "/api/webhooks/appsignal",
                "method": "POST",
                "secret_configured": bool(settings.APPSIGNAL_WEBHOOK_TOKEN),
                "events": ["exception_spike", "incident.opened"],
                "description": "Triggers automated AI bug triage and root-cause analysis on production crashes."
            }
        ]

    @staticmethod
    def get_active_skills() -> List[str]:
        """
        Returns list of active Antigravity skill IDs.
        """
        return [s["id"] for s in IntegrationRegistry.get_skills_catalog() if s["status"] == "ACTIVE"]


integration_registry = IntegrationRegistry()

