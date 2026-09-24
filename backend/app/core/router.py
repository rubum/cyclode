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

        # 5. Check if an existing session/task or active PR listener exists
        existing_task_id = None
        custom_listener_persona = None
        repo_listening_subscribed = False

        async with async_session_factory() as session:
            from app.db.models import TaskPRModel, RepositoryConfigModel

            # A. Check existing task by session_key
            if session_key:
                stmt = select(TaskModel).where(TaskModel.session_key == session_key).order_by(TaskModel.created_at.desc())
                res = await session.execute(stmt)
                existing_task = res.scalars().first()
                if existing_task:
                    existing_task_id = existing_task.id
                    if existing_task.is_listening and existing_task.listener_persona:
                        custom_listener_persona = existing_task.listener_persona

            # B. Check PR-level listener
            pr_num = payload.get("number") or payload.get("issue", {}).get("number") or payload.get("pull_request", {}).get("number")
            if pr_num and existing_task_id:
                stmt_pr = select(TaskPRModel).where(TaskPRModel.task_id == existing_task_id, TaskPRModel.pr_number == pr_num)
                res_pr = await session.execute(stmt_pr)
                pr_model = res_pr.scalars().first()
                if pr_model and pr_model.is_listening:
                    action = "awaken_session"
                    if pr_model.listener_persona:
                        custom_listener_persona = pr_model.listener_persona

            # C. Check Repository-level Sentinel listener
            if repo_name:
                stmt_repo = select(RepositoryConfigModel).where(
                    (RepositoryConfigModel.full_name == repo_name) | (RepositoryConfigModel.name == repo_name)
                )
                res_repo = await session.execute(stmt_repo)
                repo_conf = res_repo.scalars().first()
                if repo_conf and repo_conf.is_listening:
                    sub_events = [e.strip() for e in (repo_conf.subscribed_events or "").split(",") if e.strip()]
                    if not sub_events or event_type in sub_events or any(event_type.startswith(se.replace("*", "")) for se in sub_events):
                        repo_listening_subscribed = True
                    if repo_conf.default_persona:
                        custom_listener_persona = repo_conf.default_persona

        if custom_listener_persona:
            persona = custom_listener_persona

        # 6. Actionability Gate: Determine whether to dispatch an autonomous agent task
        is_actionable = self._is_actionable_event(source, event_type, payload)
        should_dispatch = bool(rule) or repo_listening_subscribed or (source in ["generic", "api", "sentry", "appsignal", "slack"]) or is_actionable

        is_awakening_event = (
            action == "awaken_session" or
            event_type in ["pull_request.synchronize", "issue_comment.created", "check_run.completed"] or
            event_type.startswith("issue_comment") or
            event_type.startswith("pull_request_review_comment") or
            event_type in ["check_run", "check_run.completed"]
        )

        task_id = None
        is_awakened = False

        if should_dispatch and is_actionable:
            if existing_task_id and is_awakening_event:
                logger.info(f"Awakening existing task {existing_task_id} for session {session_key} (persona: {persona})")
                task_id = await agent_pool.awaken_task(
                    task_id=existing_task_id,
                    event_id=event_id,
                    event_title=title,
                    event_description=description,
                    commit_sha=commit_sha
                )
                is_awakened = True
            else:
                logger.info(f"Spawning new task for {source}:{event_type}, session: {session_key} (persona: {persona})")
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
        else:
            logger.info(f"Recorded passive telemetry event for {source}:{event_type} (task spawning skipped)")

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
            repo_name = repo_info.get("full_name") or repo_info.get("name") or "workspace/repository"
            repo_url = repo_info.get("clone_url") or repo_info.get("html_url")

            if event_type.startswith("pull_request") and not event_type.startswith("pull_request_review_comment"):
                pr = payload.get("pull_request", {})
                pr_num = pr.get("number") or payload.get("number") or 1
                session_key = f"github:{repo_name}:pr:{pr_num}"
                branch = pr.get("head", {}).get("ref") or "main"
                commit_sha = pr.get("head", {}).get("sha") or payload.get("after") or "c7a8b9f"

            elif event_type.startswith("issue_comment") or event_type.startswith("pull_request_review_comment"):
                issue = payload.get("issue") or payload.get("pull_request") or {}
                num = issue.get("number") or payload.get("number") or 1
                is_pr = "pull_request" in issue or event_type.startswith("pull_request") or "pull_request" in payload
                prefix = "pr" if is_pr else "pr"
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

            elif event_type in ["check_run", "check_run.completed", "status", "workflow_run", "workflow_run.completed"]:
                # CI/CD failure event
                check_run = payload.get("check_run", {})
                workflow_run = payload.get("workflow_run", {})
                
                # Check PR references first
                prs = check_run.get("pull_requests", []) or workflow_run.get("pull_requests", [])
                if prs and isinstance(prs, list) and len(prs) > 0:
                    pr_num = prs[0].get("number")
                    if pr_num:
                        session_key = f"github:{repo_name}:pr:{pr_num}"
                
                branches_list = payload.get("branches", [])
                branch_from_list = branches_list[0].get("name") if isinstance(branches_list, list) and len(branches_list) > 0 and isinstance(branches_list[0], dict) else None
                head_branch = check_run.get("check_suite", {}).get("head_branch") or workflow_run.get("head_branch") or payload.get("branch") or branch_from_list or "main"
                branch = head_branch
                if not session_key:
                    session_key = f"github:{repo_name}:branch:{head_branch}"
                commit_sha = check_run.get("head_sha") or check_run.get("check_suite", {}).get("head_sha") or workflow_run.get("head_sha") or payload.get("sha")

        elif source == "sentry":
            incident = payload.get("incident", {}) or payload.get("issue", {})
            issue_id = incident.get("id") or payload.get("id", "incident-101")
            proj = incident.get("project") or payload.get("project", "backend")
            session_key = f"sentry:{proj}:issue:{issue_id}"
            repo_name = payload.get("repository") or f"{proj}-service"

        elif source == "appsignal":
            incident = payload.get("incident", {})
            exc_id = incident.get("id") or payload.get("id", "exc-202")
            session_key = f"appsignal:exception:{exc_id}"
            repo_name = incident.get("repository") or "backend-service"

        elif source == "slack":
            channel = payload.get("channel", "general")
            thread_ts = payload.get("thread_ts") or payload.get("ts")
            if thread_ts:
                session_key = f"slack:{channel}:{thread_ts}"
            repo_name = payload.get("repository") or "slack-channel"

        return session_key, repo_name, repo_url, branch, commit_sha

    def _is_actionable_event(self, source: str, event_type: str, payload: Dict[str, Any]) -> bool:
        """
        Determines if an incoming event represents an actionable trigger requiring an autonomous agent task,
        or passive telemetry (e.g. background CI sub-jobs, successful checks, status pings) that should only
        be logged in the events table.
        """
        if source != "github":
            return True

        # Pure background noise events
        if event_type in ["workflow_job", "status", "ping", "star", "fork", "watch", "deployment", "deployment_status"]:
            return False

        # CI Checks / Check Suites / Workflow Runs: Only actionable if failure or timeout occurred
        if event_type in ["check_run", "check_run.completed", "check_suite", "check_suite.completed", "workflow_run", "workflow_run.completed"]:
            check_obj = payload.get("check_run", {}) or payload.get("check_suite", {}) or payload.get("workflow_run", {}) or {}
            conclusion = check_obj.get("conclusion") or payload.get("conclusion") or payload.get("state")
            action = payload.get("action")
            if action in ["requested", "in_progress", "queued"]:
                return False
            return conclusion in ["failure", "timed_out", "action_required"]

        # PR Reviews: Only actionable if review requested changes or has actionable comments
        if event_type.startswith("pull_request_review") and not event_type.startswith("pull_request_review_comment"):
            action = payload.get("action")
            review = payload.get("review", {})
            state = review.get("state", "").lower()
            return action == "submitted" and (state in ["changes_requested", "commented"] or bool(review.get("body")))

        if event_type.startswith("pull_request"):
            action = payload.get("action")
            return action in ["opened", "reopened", "synchronize", None]

        if event_type.startswith("issues"):
            action = payload.get("action")
            return action in ["opened", "reopened", None]

        if event_type.startswith("issue_comment") or event_type.startswith("pull_request_review_comment"):
            action = payload.get("action")
            return action in ["created", None]

        return True

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

            elif event_type.startswith("issue_comment") or event_type.startswith("pull_request_review_comment") or event_type in ["issue_comment", "pull_request_review_comment"]:
                comment = payload.get("comment", {})
                issue = payload.get("issue", {}) or payload.get("pull_request", {})
                pr_obj = payload.get("pull_request", {}) or issue.get("pull_request", {})
                is_pr = bool(pr_obj) or event_type.startswith("pull_request")
                target_type = "PR" if is_pr else "Issue"
                target_num = issue.get("number") or payload.get("number") or pr_obj.get("number", "?")
                commenter = comment.get("user", {}).get("login", "developer") if isinstance(comment.get("user"), dict) else str(comment.get("user") or "developer")
                title = f"Comment on {target_type} #{target_num} by @{commenter}"
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

            elif event_type in ["check_run", "check_run.completed", "status", "workflow_run", "workflow_run.completed"]:
                check_run = payload.get("check_run", {})
                workflow_run = payload.get("workflow_run", {})
                check_name = check_run.get("name") or workflow_run.get("name") or payload.get("context", "CI Test Suite")
                conclusion = check_run.get("conclusion") or workflow_run.get("conclusion") or payload.get("state", "failure")
                html_url = check_run.get("html_url") or workflow_run.get("html_url") or payload.get("target_url", "")
                output_summary = check_run.get("output", {}).get("summary") or check_run.get("output", {}).get("text") or payload.get("description") or f"Check '{check_name}' finished with conclusion: {conclusion}."
                
                is_failure = conclusion in ["failure", "timed_out", "action_required"]
                status_header = "GitHub CI/CD Failure Detected" if is_failure else f"GitHub CI/CD Status: {str(conclusion).capitalize()}"
                title = f"CI {'Failure' if is_failure else 'Status'}: {check_name} ({conclusion})"
                description = (
                    f"**{status_header}**\n\n"
                    f"- **Check Name:** `{check_name}`\n"
                    f"- **Conclusion:** `{conclusion}`\n"
                    f"- **Details URL:** {html_url}\n\n"
                    f"**Check Summary:**\n```\n{output_summary}\n```\n\n"
                    f"{'Investigate failure logs, reproduce in isolated sandbox, and draft fix.' if is_failure else 'Automated CI status check recorded.'}"
                )
                persona = rule.persona if rule else "SoftwareEngineer"
                action = "awaken_session"
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
        import json
        title = payload.get("title") or f"{source.capitalize()} Event: {event_type}"
        formatted_payload = json.dumps(payload, indent=2) if isinstance(payload, (dict, list)) else str(payload)
        description = payload.get("description") or f"Inbound `{source}` `{event_type}` event.\n\n```json\n{formatted_payload}\n```"
        persona = rule.persona if rule else (payload.get("persona") or "IssueResolver")
        return title, description, persona, action


event_router = EventRouter()

