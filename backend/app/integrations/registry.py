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
        from app.integrations.manager import integration_manager

        providers = [
            {
                "id": "gemini",
                "name": "Google Gemini & AI Studio",
                "description": "Powers autonomous agent reasoning, multi-turn pair programming, and asynchronous title synthesis.",
                "configured": integration_manager.is_configured("gemini"),
                "auth_type": "API Key",
                "skills": ["gemini.generate_content", "gemini.synthesize_titles"],
                "icon": "sparkles"
            },
            {
                "id": "anthropic",
                "name": "Anthropic Claude",
                "description": "Powers deep reasoning, Claude 3.7 Sonnet hybrid thinking, and extended coding agents.",
                "configured": integration_manager.is_configured("anthropic"),
                "auth_type": "API Key",
                "skills": ["claude.messages_stream", "claude.hybrid_thinking"],
                "icon": "bot"
            },
            {
                "id": "deepseek",
                "name": "DeepSeek AI",
                "description": "Powers deepseek-flash ultra-low latency agent loops and DeepSeek-R1 reasoning.",
                "configured": integration_manager.is_configured("deepseek"),
                "auth_type": "API Key",
                "skills": ["deepseek.chat_completions", "deepseek.reasoning_content"],
                "icon": "zap"
            },
            {
                "id": "openai",
                "name": "OpenAI & Codex",
                "description": "Powers GPT-4o, Codex coding workflows, and o1/o3-mini reasoning loops.",
                "configured": integration_manager.is_configured("openai"),
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
                "description": "Native issue inspection, creation, status updates, team sync, and agent ticket execution.",
                "configured": linear_client.is_configured(),
                "auth_type": "API Key / Personal Token",
                "skills": ["linear.get_issue", "linear.update_status", "linear.post_comment", "linear.create_issue"],
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
            },
            {
                "id": "ingrations",
                "name": "Ingrations Catalog & Ecosystem",
                "description": "Universal open-source tool catalog spanning 16+ apps (Jira, Notion, AWS, Stripe, Sentry, Supabase, Cloudflare, etc.). Built-in local package.",
                "configured": True,
                "auth_type": "Built-in Engine (No Key Required)",
                "skills": ["ingrations.search_tools", "ingrations.execute"],
                "icon": "grid"
            }
        ]

        # Dynamically append individual Ingrations catalog providers
        try:
            from ingrations.catalog import default_catalog
            existing_ids = {item["id"] for item in providers}
            for app in default_catalog.list_apps():
                if app.id in existing_ids:
                    continue

                auth_type_label = "API Key / Token"
                if app.auth:
                    if app.auth.auth_type.value == "oauth2":
                        auth_type_label = "OAuth Bearer Token"
                    elif app.auth.auth_type.value == "bearer":
                        auth_type_label = "Bearer Token"
                    elif app.auth.auth_type.value == "api_key":
                        auth_type_label = "API Key"
                if app.id == "aws":
                    auth_type_label = "AWS Access Key / Secret"

                providers.append({
                    "id": app.id,
                    "name": app.name,
                    "description": app.description,
                    "configured": integration_manager.is_configured(app.id),
                    "auth_type": auth_type_label,
                    "skills": [a.id for a in app.actions],
                    "icon": app.id
                })
        except Exception:
            pass

        # Fallback canonical ecosystem catalog ensuring providers like Jira are always present
        fallback_apps = [
            {
                "id": "jira",
                "name": "Jira Software",
                "description": "Atlassian Jira Cloud project tracking, issue creation, transition states, and sprint management.",
                "auth_type": "Atlassian Email:API Token",
                "skills": ["jira.search_issues_jql", "jira.create_issue", "jira.get_issue", "jira.transition_issue", "jira.add_comment"],
                "icon": "jira"
            },
            {
                "id": "gitlab",
                "name": "GitLab",
                "description": "GitLab repositories, issues, merge requests, CI/CD pipelines, and project management.",
                "auth_type": "Personal Access Token",
                "skills": ["gitlab.get_project", "gitlab.list_issues", "gitlab.create_issue", "gitlab.create_merge_request"],
                "icon": "gitlab"
            },
            {
                "id": "notion",
                "name": "Notion",
                "description": "Notion workspaces, databases, pages, and documentation querying and editing.",
                "auth_type": "Integration Secret",
                "skills": ["notion.search", "notion.get_page", "notion.create_page", "notion.query_database"],
                "icon": "notion"
            },
            {
                "id": "stripe",
                "name": "Stripe",
                "description": "Stripe payment processing, customers, subscriptions, invoices, and charge management.",
                "auth_type": "Secret / Restricted API Key",
                "skills": ["stripe.get_customer", "stripe.create_customer", "stripe.list_charges", "stripe.create_invoice"],
                "icon": "stripe"
            },
            {
                "id": "aws",
                "name": "Amazon Web Services (AWS)",
                "description": "AWS cloud infrastructure orchestration (EC2, S3, Lambda, CloudWatch).",
                "auth_type": "AWS Access Key / Secret",
                "skills": ["aws.s3_list_buckets", "aws.s3_get_object", "aws.ec2_describe_instances", "aws.lambda_list_functions"],
                "icon": "aws"
            },
            {
                "id": "supabase",
                "name": "Supabase",
                "description": "Supabase PostgreSQL database queries, auth administration, and storage bucket management.",
                "auth_type": "API Key / Service Role",
                "skills": ["supabase.query_table", "supabase.insert_record", "supabase.get_user", "supabase.storage_list_files"],
                "icon": "supabase"
            },
            {
                "id": "cloudflare",
                "name": "Cloudflare",
                "description": "Cloudflare DNS management, zone analytics, caching, and Workers execution.",
                "auth_type": "API Token",
                "skills": ["cloudflare.list_zones", "cloudflare.list_dns_records", "cloudflare.purge_cache", "cloudflare.workers_list"],
                "icon": "cloudflare"
            },
            {
                "id": "datadog",
                "name": "Datadog",
                "description": "Datadog monitoring, metric series queries, log inspection, and synthetic check triage.",
                "auth_type": "API Key",
                "skills": ["datadog.query_metrics", "datadog.search_logs", "datadog.list_monitors", "datadog.get_event"],
                "icon": "datadog"
            },
            {
                "id": "discord",
                "name": "Discord",
                "description": "Discord channel messaging, bot notifications, and webhook announcements.",
                "auth_type": "Bot Token / Webhook",
                "skills": ["discord.send_message", "discord.get_channel", "discord.list_guilds"],
                "icon": "discord"
            },
            {
                "id": "salesforce",
                "name": "Salesforce",
                "description": "Salesforce CRM objects, leads, accounts, contacts, and opportunities management.",
                "auth_type": "OAuth Access Token",
                "skills": ["salesforce.query_soql", "salesforce.get_lead", "salesforce.create_contact", "salesforce.update_opportunity"],
                "icon": "salesforce"
            },
            {
                "id": "hubspot",
                "name": "HubSpot",
                "description": "HubSpot CRM contacts, companies, deals, tickets, and pipeline automations.",
                "auth_type": "Private App Token",
                "skills": ["hubspot.get_contact", "hubspot.create_contact", "hubspot.list_deals", "hubspot.create_ticket"],
                "icon": "hubspot"
            },
            {
                "id": "google_workspace",
                "name": "Google Workspace",
                "description": "Google Drive, Docs, Sheets, and Gmail enterprise workflows.",
                "auth_type": "OAuth Token / Key",
                "skills": ["google_workspace.drive_search", "google_workspace.sheets_read", "google_workspace.gmail_send"],
                "icon": "google_workspace"
            }
        ]

        existing_ids = {item["id"] for item in providers}
        for item in fallback_apps:
            if item["id"] not in existing_ids:
                providers.append({
                    "id": item["id"],
                    "name": item["name"],
                    "description": item["description"],
                    "configured": integration_manager.is_configured(item["id"]),
                    "auth_type": item["auth_type"],
                    "skills": item["skills"],
                    "icon": item["icon"]
                })

        return providers

    @staticmethod
    def get_skills_catalog() -> List[Dict[str, Any]]:
        """
        Returns all mounted Antigravity Skills in the harness with their tool schemas,
        filepaths, and active runtime readiness status.
        """
        from app.integrations.manager import integration_manager

        catalog = [
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
                "description": "Enables the agent to inspect Linear tickets, post progress comments, create issues, and update issue states.",
                "tools": ["linear.get_issue", "linear.update_status", "linear.post_comment", "linear.create_issue"],
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

        # Dynamically append Ingrations toolkits to skills catalog
        try:
            from ingrations.catalog import default_catalog
            existing_skill_ids = {s["id"] for s in catalog}

            category_map = {
                "jira": "Project Management",
                "gitlab": "Version Control",
                "notion": "Productivity & Docs",
                "discord": "Collaboration",
                "google_workspace": "Productivity & Workspace",
                "aws": "Cloud & DevOps",
                "supabase": "Database & Backend",
                "cloudflare": "Cloud & Edge",
                "datadog": "Observability",
                "stripe": "Billing & Payments",
                "salesforce": "CRM & Sales",
                "hubspot": "CRM & Marketing",
            }

            for app in default_catalog.list_apps():
                if app.id in existing_skill_ids:
                    # Augment existing base skills with Ingrations action IDs if desired
                    for s in catalog:
                        if s["id"] == app.id:
                            ing_tools = [a.id for a in app.actions]
                            for t in ing_tools:
                                if t not in s["tools"]:
                                    s["tools"].append(t)
                    continue

                category = category_map.get(app.id, app.category.replace("_", " ").title())
                is_active = integration_manager.is_configured(app.id)

                catalog.append({
                    "id": app.id,
                    "name": f"{app.name} Automation & Actions",
                    "path": f"ingrations://{app.id}",
                    "description": app.description,
                    "tools": [a.id for a in app.actions],
                    "status": "ACTIVE" if is_active else "AUTH_REQUIRED",
                    "category": category
                })
        except Exception:
            pass

        existing_skill_ids = {s["id"] for s in catalog}
        fallback_skills = [
            {
                "id": "jira",
                "name": "Jira Software Automation & Actions",
                "path": "ingrations://jira",
                "description": "Atlassian Jira Cloud project tracking, issue creation, transition states, and sprint management.",
                "tools": ["jira.search_issues_jql", "jira.create_issue", "jira.get_issue", "jira.transition_issue", "jira.add_comment"],
                "status": "ACTIVE" if integration_manager.is_configured("jira") else "AUTH_REQUIRED",
                "category": "Project Management"
            },
            {
                "id": "gitlab",
                "name": "GitLab Automation & Actions",
                "path": "ingrations://gitlab",
                "description": "GitLab repositories, issues, merge requests, CI/CD pipelines, and project management.",
                "tools": ["gitlab.get_project", "gitlab.list_issues", "gitlab.create_issue", "gitlab.create_merge_request"],
                "status": "ACTIVE" if integration_manager.is_configured("gitlab") else "AUTH_REQUIRED",
                "category": "Version Control"
            },
            {
                "id": "notion",
                "name": "Notion Automation & Actions",
                "path": "ingrations://notion",
                "description": "Notion workspaces, databases, pages, and documentation querying and editing.",
                "tools": ["notion.search", "notion.get_page", "notion.create_page", "notion.query_database"],
                "status": "ACTIVE" if integration_manager.is_configured("notion") else "AUTH_REQUIRED",
                "category": "Productivity & Docs"
            },
            {
                "id": "stripe",
                "name": "Stripe Automation & Actions",
                "path": "ingrations://stripe",
                "description": "Stripe payment processing, customers, subscriptions, invoices, and charge management.",
                "tools": ["stripe.get_customer", "stripe.create_customer", "stripe.list_charges", "stripe.create_invoice"],
                "status": "ACTIVE" if integration_manager.is_configured("stripe") else "AUTH_REQUIRED",
                "category": "Billing & Payments"
            },
            {
                "id": "aws",
                "name": "Amazon Web Services (AWS) Automation & Actions",
                "path": "ingrations://aws",
                "description": "AWS cloud infrastructure orchestration (EC2, S3, Lambda, CloudWatch).",
                "tools": ["aws.s3_list_buckets", "aws.s3_get_object", "aws.ec2_describe_instances", "aws.lambda_list_functions"],
                "status": "ACTIVE" if integration_manager.is_configured("aws") else "AUTH_REQUIRED",
                "category": "Cloud & DevOps"
            },
            {
                "id": "supabase",
                "name": "Supabase Automation & Actions",
                "path": "ingrations://supabase",
                "description": "Supabase PostgreSQL database queries, auth administration, and storage bucket management.",
                "tools": ["supabase.query_table", "supabase.insert_record", "supabase.get_user", "supabase.storage_list_files"],
                "status": "ACTIVE" if integration_manager.is_configured("supabase") else "AUTH_REQUIRED",
                "category": "Database & Backend"
            },
            {
                "id": "cloudflare",
                "name": "Cloudflare Automation & Actions",
                "path": "ingrations://cloudflare",
                "description": "Cloudflare DNS management, zone analytics, caching, and Workers execution.",
                "tools": ["cloudflare.list_zones", "cloudflare.list_dns_records", "cloudflare.purge_cache", "cloudflare.workers_list"],
                "status": "ACTIVE" if integration_manager.is_configured("cloudflare") else "AUTH_REQUIRED",
                "category": "Cloud & Edge"
            },
            {
                "id": "datadog",
                "name": "Datadog Automation & Actions",
                "path": "ingrations://datadog",
                "description": "Datadog monitoring, metric series queries, log inspection, and synthetic check triage.",
                "tools": ["datadog.query_metrics", "datadog.search_logs", "datadog.list_monitors", "datadog.get_event"],
                "status": "ACTIVE" if integration_manager.is_configured("datadog") else "AUTH_REQUIRED",
                "category": "Observability"
            },
            {
                "id": "discord",
                "name": "Discord Automation & Actions",
                "path": "ingrations://discord",
                "description": "Discord channel messaging, bot notifications, and webhook announcements.",
                "tools": ["discord.send_message", "discord.get_channel", "discord.list_guilds"],
                "status": "ACTIVE" if integration_manager.is_configured("discord") else "AUTH_REQUIRED",
                "category": "Collaboration"
            },
            {
                "id": "salesforce",
                "name": "Salesforce Automation & Actions",
                "path": "ingrations://salesforce",
                "description": "Salesforce CRM objects, leads, accounts, contacts, and opportunities management.",
                "tools": ["salesforce.query_soql", "salesforce.get_lead", "salesforce.create_contact", "salesforce.update_opportunity"],
                "status": "ACTIVE" if integration_manager.is_configured("salesforce") else "AUTH_REQUIRED",
                "category": "CRM & Sales"
            },
            {
                "id": "hubspot",
                "name": "HubSpot Automation & Actions",
                "path": "ingrations://hubspot",
                "description": "HubSpot CRM contacts, companies, deals, tickets, and pipeline automations.",
                "tools": ["hubspot.get_contact", "hubspot.create_contact", "hubspot.list_deals", "hubspot.create_ticket"],
                "status": "ACTIVE" if integration_manager.is_configured("hubspot") else "AUTH_REQUIRED",
                "category": "CRM & Marketing"
            },
            {
                "id": "google_workspace",
                "name": "Google Workspace Automation & Actions",
                "path": "ingrations://google_workspace",
                "description": "Google Drive, Docs, Sheets, and Gmail enterprise workflows.",
                "tools": ["google_workspace.drive_search", "google_workspace.sheets_read", "google_workspace.gmail_send"],
                "status": "ACTIVE" if integration_manager.is_configured("google_workspace") else "AUTH_REQUIRED",
                "category": "Productivity & Workspace"
            }
        ]
        for s in fallback_skills:
            if s["id"] not in existing_skill_ids:
                catalog.append(s)

        return catalog

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

