import logging
from typing import Dict, Any, Tuple, Optional
from sqlalchemy import select
from app.agent.pool import agent_pool
from app.db.models import EventModel, AutomationRuleModel, TaskModel
from app.db.session import async_session_factory

logger = logging.getLogger("cyclode.router")


class EventRouter:
    async def route_and_dispatch(
        self,
        source: str,
        event_type: str,
        payload: Dict[str, Any],
        signature_valid: bool = True
    ) -> Dict[str, Any]:
        """
        Ingests an external event, records it in the database, maps it to configured automation rules,
        resolves/creates sessions (with ephemeral sandboxes), and dispatches worker execution.
        """
        # 1. Save Event in DB
        async with async_session_factory() as session:
            event = EventModel(
                source=source,
                event_type=event_type,
                payload=payload,
                signature_valid=signature_valid,
                status="PROCESSED"
            )
            session.add(event)
            await session.commit()
            await session.refresh(event)
            event_id = event.id

        # 2. Extract Session Key & Repo Metadata
        session_key, repo_name, repo_url, branch, commit_sha = self._extract_metadata(source, event_type, payload)

        # 3. Match against configured Automation Rules in DB
        rule = await self._find_matching_rule(source, event_type, repo_name)

        # 4. Resolve Title, Description, Persona, and Action
        title, description, persona, action = self._resolve_task_params(source, event_type, payload, rule)

        # 5. Check if an existing session/task exists for this session_key
        existing_task_id = None
        if session_key:
            async with async_session_factory() as session:
                stmt = select(TaskModel).where(TaskModel.session_key == session_key).order_by(TaskModel.created_at.desc())
                res = await session.execute(stmt)
                existing_task = res.scalars().first()
                if existing_task:
                    existing_task_id = existing_task.id

        # 6. Dispatch: Awaken existing task OR Spawn new task
        if existing_task_id and (action == "awaken_session" or event_type in ["pull_request.synchronize", "issue_comment.created"]):
            logger.info(f"Awakening existing task {existing_task_id} for session {session_key}")
            task_id = await agent_pool.awaken_task(
                task_id=existing_task_id,
                event_id=event_id,
                event_title=title,
                event_description=description,
                commit_sha=commit_sha
            )
            is_awakened = True
        else:
            logger.info(f"Spawning new task for {source}:{event_type}, session: {session_key}")
            task_id = await agent_pool.spawn_task(
                title=title,
                description=description,
                persona=persona,
                event_id=event_id,
                session_key=session_key,
                repo_name=repo_name,
                repo_url=repo_url,
                target_branch=branch,
                commit_sha=commit_sha
            )
            is_awakened = False

        # 7. Broadcast real-time event to connected frontend dashboards
        try:
            from app.api.websocket import ws_manager
            from app.db.models import get_utc_now
            await ws_manager.broadcast("EVENT_RECEIVED", {
                "id": event_id,
                "source": source,
                "event_type": event_type,
                "signature_valid": signature_valid,
                "status": "PROCESSED",
                "task_id": task_id,
                "session_key": session_key,
                "is_awakened": is_awakened,
                "title": title,
                "persona": persona,
                "payload": payload,
                "created_at": event.created_at.isoformat() if hasattr(event, "created_at") and event.created_at else get_utc_now().isoformat()
            })

            # If event is a comment or review on a PR, broadcast PR_COMMENTS_UPDATED for live auto-sync
            if source == "github" and ("comment" in event_type or "review" in event_type):
                pr_num = payload.get("number") or payload.get("issue", {}).get("number") or payload.get("pull_request", {}).get("number")
                if pr_num:
                    await ws_manager.broadcast("PR_COMMENTS_UPDATED", {
                        "task_id": task_id,
                        "pr_number": pr_num,
                        "repo_name": repo_name,
                        "event_type": event_type,
                        "action": "webhook_event"
                    })
        except Exception as e:
            logger.debug(f"Note: WebSocket broadcast skipped or client absent: {e}")

        return {
            "ok": True,
            "event_id": event_id,
            "task_id": task_id,
            "session_key": session_key,
            "is_awakened": is_awakened,
            "title": title,
            "persona": persona
        }

    def _extract_metadata(
        self,
        source: str,
        event_type: str,
        payload: Dict[str, Any]
    ) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
        """
        Extracts (session_key, repo_name, repo_url, target_branch, commit_sha) from webhook payload.
        """
        repo_name = None
        repo_url = None
        branch = None
        commit_sha = None
        session_key = None

        if source == "github":
            repo_info = payload.get("repository", {}) or payload.get("repo", {})
            repo_name = repo_info.get("full_name") or repo_info.get("name") or "acme/auth-service"
            repo_url = repo_info.get("clone_url") or repo_info.get("html_url")

            if event_type.startswith("pull_request"):
                pr = payload.get("pull_request", {})
                pr_num = pr.get("number") or payload.get("number") or 1
                session_key = f"github:{repo_name}:pr:{pr_num}"
                branch = pr.get("head", {}).get("ref") or "main"
                commit_sha = pr.get("head", {}).get("sha") or payload.get("after") or "c7a8b9f"

            elif event_type == "issue_comment.created":
                issue = payload.get("issue", {})
                num = issue.get("number", 1)
                is_pr = "pull_request" in issue
                prefix = "pr" if is_pr else "issue"
                session_key = f"github:{repo_name}:{prefix}:{num}"
                branch = "main"

            elif event_type.startswith("issues"):
                issue = payload.get("issue", {})
                num = issue.get("number", 1)
                session_key = f"github:{repo_name}:issue:{num}"
                branch = "main"

            elif event_type == "push":
                ref = payload.get("ref", "refs/heads/main").replace("refs/heads/", "")
                session_key = f"github:{repo_name}:branch:{ref}"
                branch = ref
                commit_sha = payload.get("after")

        elif source == "sentry":
            incident = payload.get("incident", {}) or payload.get("issue", {})
            issue_id = incident.get("id") or payload.get("id", "incident-101")
            proj = incident.get("project") or payload.get("project", "backend")
            session_key = f"sentry:{proj}:issue:{issue_id}"
            repo_name = payload.get("repository") or "acme/auth-service"

        elif source == "appsignal":
            incident = payload.get("incident", {})
            exc_id = incident.get("id") or payload.get("id", "exc-202")
            session_key = f"appsignal:exception:{exc_id}"
            repo_name = incident.get("repository") or "acme/auth-service"

        elif source == "slack":
            channel = payload.get("channel", "general")
            thread_ts = payload.get("thread_ts") or payload.get("ts")
            if thread_ts:
                session_key = f"slack:{channel}:{thread_ts}"
            repo_name = "acme/auth-service"

        return session_key, repo_name, repo_url, branch, commit_sha

    async def _find_matching_rule(
        self,
        source: str,
        event_type: str,
        repo_name: Optional[str]
    ) -> Optional[AutomationRuleModel]:
        async with async_session_factory() as session:
            stmt = select(AutomationRuleModel).where(
                AutomationRuleModel.source == source,
                AutomationRuleModel.enabled == True
            )
            res = await session.execute(stmt)
            rules = res.scalars().all()

            for r in rules:
                if r.event_type == event_type or r.event_type == "*":
                    if r.repo_filter == "*" or (repo_name and r.repo_filter in repo_name):
                        return r
        return None

    def _resolve_task_params(
        self,
        source: str,
        event_type: str,
        payload: Dict[str, Any],
        rule: Optional[AutomationRuleModel] = None
    ) -> Tuple[str, str, str, str]:
        persona = rule.persona if rule else "IssueResolver"
        action = rule.action if rule else "spawn_task"

        if source == "github":
            if event_type == "pull_request.opened":
                pr = payload.get("pull_request", {})
                title = f"Review PR #{pr.get('number', '?')}: {pr.get('title', 'Autonomous Review')}"
                body = pr.get("body", "")
                description = f"Autonomous PR review triggered by `pull_request.opened`.\n\n**PR Summary:** {body}"
                persona = rule.persona if rule else "CodeReviewer"
                return title, description, persona, action

            elif event_type == "pull_request.synchronize":
                pr = payload.get("pull_request", {})
                after_sha = payload.get("after") or pr.get("head", {}).get("sha", "latest")
                title = f"Incremental Review on PR #{pr.get('number', '?')} (Commit `{after_sha[:7]}`)"
                description = f"New commit pushed: `{after_sha}`. Re-evaluating test suite and checking regression diffs in fresh ephemeral sandbox."
                persona = rule.persona if rule else "CodeReviewer"
                action = "awaken_session"
                return title, description, persona, action

            elif event_type == "issue_comment.created":
                comment = payload.get("comment", {})
                issue = payload.get("issue", {})
                is_pr = "pull_request" in issue
                target_type = "PR" if is_pr else "Issue"
                title = f"Comment on {target_type} #{issue.get('number', '?')} by @{comment.get('user', {}).get('login', 'developer')}"
                description = comment.get("body", "")
                persona = rule.persona if rule else "SoftwareEngineer"
                action = "awaken_session"
                return title, description, persona, action

            elif event_type.startswith("issues"):
                issue = payload.get("issue", {})
                title = f"GitHub Issue #{issue.get('number', '?')}: {issue.get('title', 'Untitled Issue')}"
                description = issue.get("body", "")
                persona = rule.persona if rule else "IssueResolver"
                return title, description, persona, action

        elif source == "sentry":
            incident = payload.get("incident", {}) or payload.get("issue", {})
            title = f"Sentry Incident: {incident.get('title', 'Production 500 Spike')}"
            culprit = incident.get("culprit", "app/auth_service.py")
            description = (
                f"**Sentry Alert Triggered**\n\n"
                f"Error: `{incident.get('title', 'KeyError in production')}`\n"
                f"Culprit: `{culprit}`\n\n"
                f"Triage and draft patch in isolated ephemeral sandbox."
            )
            persona = rule.persona if rule else "APMTriage"
            return title, description, persona, action

        elif source == "appsignal":
            incident = payload.get("incident", {})
            exc = incident.get("exception_name") or payload.get("exception", "ActiveRecord::RecordNotFound")
            msg = incident.get("error_message") or payload.get("message", "Error in production")
            title = f"AppSignal Alert: {exc}"
            description = f"Exception: `{exc}`\nMessage: {msg}\nBacktrace:\n```\n{payload.get('backtrace', [])}\n```"
            persona = rule.persona if rule else "APMTriage"
            return title, description, persona, action

        elif source == "slack":
            text = payload.get("text", "Ad-hoc task from Slack")
            title = f"Slack Task: {text[:60]}"
            description = text
            persona = rule.persona if rule else "IssueResolver"
            return title, description, persona, action

        # Default fallback
        title = payload.get("title") or f"{source.capitalize()} Event: {event_type}"
        description = payload.get("description") or str(payload)
        persona = rule.persona if rule else (payload.get("persona") or "IssueResolver")
        return title, description, persona, action


event_router = EventRouter()
