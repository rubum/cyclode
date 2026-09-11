import asyncio
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List
from sqlalchemy import select, update, delete
from app.config import settings
from app.db.session import async_session_factory
from app.db.models import TaskModel, TaskMessageModel, TaskLogModel, TaskApprovalModel, TaskDiffModel, get_utc_now
from app.core.worktree import worktree_manager
from app.core.sandboxes.manager import sandbox_manager
from app.core.sandboxes.base import CloneAuthRequiredException, CloneFailedException
from app.agent.harness import antigravity_harness
from app.api.websocket import ws_manager
from app.integrations.github_client import github_client
from app.integrations.slack_client import slack_client

logger = logging.getLogger("adappty.pool")


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    words = len(text.split())
    chars = len(text)
    return max(1, int(max(words * 1.3, chars / 4)))


class AgentTaskPool:
    def __init__(self):
        self.active_tasks: Dict[str, asyncio.Task] = {}

    async def spawn_task(
        self,
        title: str,
        description: str,
        persona: str = "IssueResolver",
        model_name: Optional[str] = None,
        event_id: Optional[str] = None,
        session_key: Optional[str] = None,
        repo_name: Optional[str] = None,
        repo_url: Optional[str] = None,
        target_branch: Optional[str] = None,
        commit_sha: Optional[str] = None
    ) -> str:
        """
        Creates a new task in the database and dispatches it to an asynchronous worker
        with an isolated, ephemeral sandbox.
        """
        # Auto-extract repo URL from description or title if not explicitly passed
        if not repo_url:
            combined_text = f"{title} {description}"
            repo_match = re.search(r"(https?://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?)", combined_text, re.IGNORECASE)
            if repo_match:
                repo_url = repo_match.group(1).rstrip(".")
                if not repo_name:
                    repo_name = repo_url.split("github.com/")[-1].replace(".git", "")

        chosen_model = model_name or settings.ANTIGRAVITY_MODEL
        init_tokens = estimate_tokens(description or title)
        
        async with async_session_factory() as session:
            task = TaskModel(
                title=title,
                description=description,
                persona=persona,
                model_name=chosen_model,
                status="INITIALIZING",
                event_id=event_id,
                session_key=session_key,
                repo_name=repo_name,
                repo_url=repo_url,
                target_branch=target_branch,
                commit_sha=commit_sha,
                sandbox_status="PROVISIONING",
                total_tokens=init_tokens,
                git_branch=f"adappty/task-{datetime.now().strftime('%Y%m%d%H%M%S')}"
            )
            session.add(task)
            await session.commit()
            await session.refresh(task)
            task_id = task.id

        # Broadcast task creation to UI
        await ws_manager.broadcast("TASK_CREATED", {
            "id": task_id,
            "title": title,
            "persona": persona,
            "model_name": chosen_model,
            "status": "INITIALIZING",
            "session_key": session_key,
            "repo_name": repo_name,
            "commit_sha": commit_sha,
            "sandbox_status": "PROVISIONING",
            "created_at": datetime.now(timezone.utc).isoformat()
        })

        # Spawn background execution worker
        worker = asyncio.create_task(
            self._run_task_worker(
                task_id=task_id,
                title=title,
                description=description,
                persona=persona,
                repo_name=repo_name,
                repo_url=repo_url,
                target_branch=target_branch,
                commit_sha=commit_sha
            )
        )
        self.active_tasks[task_id] = worker
        return task_id

    async def awaken_task(
        self,
        task_id: str,
        event_id: Optional[str] = None,
        event_title: str = "",
        event_description: str = "",
        commit_sha: Optional[str] = None
    ) -> str:
        """
        Awakens an existing task/session with incoming event context,
        retaining conversation history and provisioning a fresh ephemeral sandbox.
        """
        # Cancel any active running worker if present
        if task_id in self.active_tasks:
            worker = self.active_tasks[task_id]
            if not worker.done():
                worker.cancel()
            self.active_tasks.pop(task_id, None)

        async with async_session_factory() as session:
            stmt = select(TaskModel).where(TaskModel.id == task_id)
            res = await session.execute(stmt)
            task = res.scalars().first()
            if not task:
                raise ValueError(f"Task {task_id} not found to awaken.")

            task.status = "RUNNING"
            task.sandbox_status = "PROVISIONING"
            if commit_sha:
                task.commit_sha = commit_sha
            task.result_summary = None
            task.completed_at = None

            # Add system awakening notice
            sha_label = f"`{commit_sha[:7]}`" if commit_sha else "`HEAD`"
            awakening_text = (
                f"⚡ **Session Awakened:** New event received: *{event_title}* (Commit: {sha_label})\n\n"
                f"{event_description}"
            )
            notice_msg = TaskMessageModel(
                task_id=task_id,
                sender="system",
                content=awakening_text
            )
            session.add(notice_msg)
            await session.commit()

            # Retrieve conversation history
            stmt_msgs = select(TaskMessageModel).where(TaskMessageModel.task_id == task_id).order_by(TaskMessageModel.created_at)
            res_msgs = await session.execute(stmt_msgs)
            db_messages = res_msgs.scalars().all()
            history = [
                {"sender": m.sender, "content": m.content, "thought": m.thought}
                for m in db_messages
            ]

            title = task.title
            persona = task.persona
            repo_name = task.repo_name
            repo_url = task.repo_url
            target_branch = task.target_branch
            active_sha = task.commit_sha

        # Broadcast awakened status and system message
        await ws_manager.broadcast("TASK_STATUS_CHANGE", {
            "task_id": task_id,
            "status": "RUNNING",
            "sandbox_status": "PROVISIONING",
            "commit_sha": active_sha
        })
        await ws_manager.broadcast("CHAT_MESSAGE", {
            "task_id": task_id,
            "sender": "system",
            "content": awakening_text,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })

        # Spawn worker
        worker = asyncio.create_task(
            self._run_task_worker(
                task_id=task_id,
                title=title,
                description=event_description or event_title,
                persona=persona,
                repo_name=repo_name,
                repo_url=repo_url,
                target_branch=target_branch,
                commit_sha=active_sha,
                history=history,
                is_awakening=True
            )
        )
        self.active_tasks[task_id] = worker
        return task_id

    async def _run_task_worker(
        self,
        task_id: str,
        title: str,
        description: str,
        persona: str,
        repo_name: Optional[str] = None,
        repo_url: Optional[str] = None,
        target_branch: Optional[str] = None,
        commit_sha: Optional[str] = None,
        history: Optional[List[Dict[str, Any]]] = None,
        is_awakening: bool = False
    ):
        sandbox_ctx = None
        try:
            # 1. Provision Ephemeral Sandbox
            sandbox_ctx = await sandbox_manager.get_or_create(
                task_id=task_id,
                repo_name=repo_name,
                repo_url=repo_url,
                branch=target_branch,
                commit_sha=commit_sha
            )
            workspace_path = sandbox_ctx.workspace_path

            # Update status to RUNNING and sandbox to ACTIVE
            async with async_session_factory() as session:
                await session.execute(
                    update(TaskModel)
                    .where(TaskModel.id == task_id)
                    .values(
                        status="RUNNING",
                        sandbox_status="ACTIVE",
                        workspace_path=str(workspace_path)
                    )
                )
                await session.commit()

            await ws_manager.broadcast("TASK_STATUS_CHANGE", {
                "task_id": task_id,
                "status": "RUNNING",
                "sandbox_status": "ACTIVE",
                "workspace_path": str(workspace_path)
            })

            # Define telemetry callbacks
            async def on_thought(thought_text: str):
                t_tokens = estimate_tokens(thought_text)
                async with async_session_factory() as session:
                    msg = TaskMessageModel(
                        task_id=task_id,
                        sender="agent",
                        content=thought_text,
                        thought=thought_text,
                        tokens=t_tokens
                    )
                    session.add(msg)
                    await session.commit()

                await ws_manager.broadcast("AGENT_THOUGHT", {
                    "task_id": task_id,
                    "thought": thought_text,
                    "tokens": t_tokens,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })

            async def on_tool_start(tool_name: str, tool_args: Dict[str, Any]):
                await ws_manager.broadcast("TOOL_START", {
                    "task_id": task_id,
                    "tool_name": tool_name,
                    "tool_input": tool_args,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })

            async def on_tool_end(tool_name: str, tool_output: str, exit_code: int, duration_ms: int, tool_input: Optional[Dict[str, Any]] = None):
                async with async_session_factory() as session:
                    log = TaskLogModel(
                        task_id=task_id,
                        tool_name=tool_name,
                        tool_input=tool_input or {},
                        tool_output=tool_output,
                        exit_code=exit_code,
                        duration_ms=duration_ms
                    )
                    session.add(log)
                    await session.commit()

                await ws_manager.broadcast("TOOL_END", {
                    "task_id": task_id,
                    "tool_name": tool_name,
                    "tool_input": tool_input or {},
                    "tool_output": tool_output,
                    "exit_code": exit_code,
                    "duration_ms": duration_ms,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })

            async def on_message(sender: str, content: str):
                m_tokens = estimate_tokens(content)
                async with async_session_factory() as session:
                    msg = TaskMessageModel(
                        task_id=task_id,
                        sender=sender,
                        content=content,
                        tokens=m_tokens
                    )
                    session.add(msg)
                    await session.execute(
                        update(TaskModel)
                        .where(TaskModel.id == task_id)
                        .values(total_tokens=TaskModel.total_tokens + m_tokens)
                    )
                    await session.commit()

                await ws_manager.broadcast("CHAT_MESSAGE", {
                    "task_id": task_id,
                    "sender": sender,
                    "content": content,
                    "tokens": m_tokens,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })

            async def on_approval_required(action_type: str, details: Dict[str, Any]):
                async with async_session_factory() as session:
                    approval = TaskApprovalModel(
                        task_id=task_id,
                        action_type=action_type,
                        action_details=details,
                        status="PENDING"
                    )
                    session.add(approval)
                    await session.execute(
                        update(TaskModel).where(TaskModel.id == task_id).values(status="AWAITING_APPROVAL")
                    )
                    await session.commit()
                    await session.refresh(approval)
                    approval_id = approval.id

                # Broadcast to UI and Slack
                await ws_manager.broadcast("APPROVAL_REQUIRED", {
                    "task_id": task_id,
                    "approval_id": approval_id,
                    "action_type": action_type,
                    "details": details,
                    "status": "AWAITING_APPROVAL"
                })
                await slack_client.send_approval_request(
                    task_id=task_id,
                    title=title,
                    action_type=action_type,
                    details=details.get("description", "")
                )

            async def on_diff_updated(diffs: List[Dict[str, Any]]):
                async with async_session_factory() as session:
                    for d in diffs:
                        diff_record = TaskDiffModel(
                            task_id=task_id,
                            file_path=d["file_path"],
                            diff_content=d["diff_content"],
                            additions=d.get("additions", 0),
                            deletions=d.get("deletions", 0)
                        )
                        session.add(diff_record)
                    await session.commit()

                await ws_manager.broadcast("DIFF_UPDATED", {
                    "task_id": task_id,
                    "diffs": diffs
                })

            # Execute via Antigravity Harness
            result = await antigravity_harness.execute_task(
                task_id=task_id,
                title=title,
                description=description,
                persona_name=persona,
                workspace_path=workspace_path,
                on_thought=on_thought,
                on_tool_start=on_tool_start,
                on_tool_end=on_tool_end,
                on_message=on_message,
                on_approval_required=on_approval_required,
                on_diff_updated=on_diff_updated,
                history=history
            )

            # Determine final status
            raw_status = result.get("status", "COMPLETED")
            async with async_session_factory() as session:
                stmt_t = select(TaskModel).where(TaskModel.id == task_id)
                res_t = await session.execute(stmt_t)
                t = res_t.scalars().first()
                session_key = t.session_key if t else None

                # For standing sessions (PRs, issues), transition to IDLE when completed
                if raw_status == "COMPLETED" and session_key:
                    final_status = "IDLE"
                else:
                    final_status = raw_status

                await session.execute(
                    update(TaskModel)
                    .where(TaskModel.id == task_id)
                    .values(
                        status=final_status,
                        result_summary=result.get("summary", ""),
                        completed_at=get_utc_now() if final_status in ["COMPLETED", "IDLE"] else None
                    )
                )
                await session.commit()

            await ws_manager.broadcast("TASK_STATUS_CHANGE", {
                "task_id": task_id,
                "status": final_status,
                "result_summary": result.get("summary", "")
            })

        except CloneAuthRequiredException as e:
            logger.info(f"Task {task_id} requires GitHub authentication for {e.repo_url}")
            guidance_msg = (
                f"### 🔒 GitHub Authentication Required\n\n"
                f"I attempted to clone `{e.repo_url}`, but it is a **private repository** or requires GitHub authorization (`fatal: could not read Username`).\n\n"
                f"#### How you can assist:\n"
                f"- **Paste your Token here in Chat**: Reply directly with your GitHub Personal Access Token (`ghp_...` or `github_pat_...`). It will be automatically masked in the UI and used to authenticate.\n"
                f"- **Configure Integrations**: Open the **Integrations** modal in the top header and configure your GitHub token globally.\n\n"
                f"Once provided, I'll immediately clone `{e.repo_url}` and proceed with your task!"
            )
            m_tokens = estimate_tokens(guidance_msg)
            async with async_session_factory() as session:
                msg = TaskMessageModel(
                    task_id=task_id,
                    sender="agent",
                    content=guidance_msg,
                    tokens=m_tokens
                )
                session.add(msg)
                await session.execute(
                    update(TaskModel)
                    .where(TaskModel.id == task_id)
                    .values(
                        status="AWAITING_INPUT",
                        sandbox_status="AUTH_REQUIRED",
                        result_summary="Awaiting GitHub credentials."
                    )
                )
                await session.commit()

            await ws_manager.broadcast("TASK_STATUS_CHANGE", {
                "task_id": task_id,
                "status": "AWAITING_INPUT",
                "sandbox_status": "AUTH_REQUIRED",
                "result_summary": "Awaiting GitHub credentials."
            })
            await ws_manager.broadcast("CHAT_MESSAGE", {
                "task_id": task_id,
                "sender": "agent",
                "content": guidance_msg,
                "tokens": m_tokens,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            return

        except CloneFailedException as e:
            logger.warning(f"Task {task_id} clone failed for {e.repo_url}: {e.stderr}")
            err_msg = (
                f"### ❌ Repository Clone Failed\n\n"
                f"Unable to clone `{e.repo_url}` into the isolated task sandbox:\n\n"
                f"```text\n{e.stderr or str(e)}\n```\n\n"
                f"Please verify that the repository URL and target branch exist. You can reply with an updated URL or instructions."
            )
            m_tokens = estimate_tokens(err_msg)
            async with async_session_factory() as session:
                msg = TaskMessageModel(
                    task_id=task_id,
                    sender="agent",
                    content=err_msg,
                    tokens=m_tokens
                )
                session.add(msg)
                await session.execute(
                    update(TaskModel)
                    .where(TaskModel.id == task_id)
                    .values(
                        status="AWAITING_INPUT",
                        sandbox_status="CLONE_FAILED",
                        result_summary="Repository clone failed."
                    )
                )
                await session.commit()

            await ws_manager.broadcast("TASK_STATUS_CHANGE", {
                "task_id": task_id,
                "status": "AWAITING_INPUT",
                "sandbox_status": "CLONE_FAILED",
                "result_summary": "Repository clone failed."
            })
            await ws_manager.broadcast("CHAT_MESSAGE", {
                "task_id": task_id,
                "sender": "agent",
                "content": err_msg,
                "tokens": m_tokens,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            return

        except Exception as e:
            logger.error(f"Error executing task {task_id}: {e}", exc_info=True)
            async with async_session_factory() as session:
                await session.execute(
                    update(TaskModel)
                    .where(TaskModel.id == task_id)
                    .values(status="FAILED", result_summary=str(e), completed_at=get_utc_now())
                )
                await session.commit()

            await ws_manager.broadcast("TASK_STATUS_CHANGE", {
                "task_id": task_id,
                "status": "FAILED",
                "error": str(e)
            })
        finally:
            # Tear down ephemeral sandbox completely
            if sandbox_ctx:
                await sandbox_manager.destroy(sandbox_ctx)
                async with async_session_factory() as session:
                    await session.execute(
                        update(TaskModel)
                        .where(TaskModel.id == task_id)
                        .values(sandbox_status="DESTROYED")
                    )
                    await session.commit()

                await ws_manager.broadcast("TASK_STATUS_CHANGE", {
                    "task_id": task_id,
                    "sandbox_status": "DESTROYED"
                })

            self.active_tasks.pop(task_id, None)

    async def approve_task(self, task_id: str, feedback: Optional[str] = None) -> Dict[str, Any]:
        """
        Processes human approval for an awaiting task.
        """
        async with async_session_factory() as session:
            # Update approval model
            stmt = select(TaskApprovalModel).where(
                TaskApprovalModel.task_id == task_id,
                TaskApprovalModel.status == "PENDING"
            )
            result = await session.execute(stmt)
            approval = result.scalars().first()

            if approval:
                approval.status = "APPROVED"
                approval.feedback = feedback
                approval.resolved_at = get_utc_now()

            # Execute the approved external action
            pr_res = await github_client.create_pull_request(
                owner="org",
                repo="repo",
                title=f"fix: resolve task {task_id[:8]}",
                body=f"Approved resolution for task {task_id}",
                head_branch=f"adappty/fix-{task_id[:8]}"
            )

            # Record agent confirmation message
            msg = TaskMessageModel(
                task_id=task_id,
                sender="agent",
                content=f"🎉 **Action Approved!** Pull Request created: [{pr_res.get('html_url')}]({pr_res.get('html_url')})"
            )
            session.add(msg)

            # Update task to COMPLETED
            await session.execute(
                update(TaskModel)
                .where(TaskModel.id == task_id)
                .values(
                    status="COMPLETED",
                    result_summary=f"Approved & PR Created: {pr_res.get('html_url')}",
                    completed_at=get_utc_now()
                )
            )
            await session.commit()

        await ws_manager.broadcast("APPROVAL_RESOLVED", {
            "task_id": task_id,
            "status": "APPROVED",
            "pr_url": pr_res.get("html_url")
        })
        await ws_manager.broadcast("TASK_STATUS_CHANGE", {
            "task_id": task_id,
            "status": "COMPLETED"
        })

        return {"ok": True, "task_id": task_id, "status": "APPROVED", "pr": pr_res}

    async def reject_task(self, task_id: str, feedback: Optional[str] = None) -> Dict[str, Any]:
        """
        Rejects an action or task.
        """
        async with async_session_factory() as session:
            stmt = select(TaskApprovalModel).where(
                TaskApprovalModel.task_id == task_id,
                TaskApprovalModel.status == "PENDING"
            )
            result = await session.execute(stmt)
            approval = result.scalars().first()

            if approval:
                approval.status = "REJECTED"
                approval.feedback = feedback
                approval.resolved_at = get_utc_now()

            msg = TaskMessageModel(
                task_id=task_id,
                sender="system",
                content=f"🛑 **Action Rejected by Reviewer.** Reason: {feedback or 'No feedback provided.'}"
            )
            session.add(msg)

            await session.execute(
                update(TaskModel)
                .where(TaskModel.id == task_id)
                .values(
                    status="CANCELLED",
                    result_summary=f"Rejected: {feedback or 'No feedback'}",
                    completed_at=get_utc_now()
                )
            )
            await session.commit()

        await ws_manager.broadcast("APPROVAL_RESOLVED", {
            "task_id": task_id,
            "status": "REJECTED",
            "feedback": feedback
        })
        await ws_manager.broadcast("TASK_STATUS_CHANGE", {
            "task_id": task_id,
            "status": "CANCELLED"
        })

        return {"ok": True, "task_id": task_id, "status": "REJECTED"}

    async def stop_task(self, task_id: str, reason: Optional[str] = None) -> Dict[str, Any]:
        """
        Instantly halts a running agent task worker, cancels asyncio.Task, updates DB status to CANCELLED,
        and broadcasts status change to frontend.
        """
        logger.info(f"Stopping task {task_id}, reason: {reason}")
        if task_id in self.active_tasks:
            worker = self.active_tasks.pop(task_id)
            if not worker.done():
                worker.cancel()

        async with async_session_factory() as session:
            stmt = select(TaskModel).where(TaskModel.id == task_id)
            res = await session.execute(stmt)
            task = res.scalars().first()
            if not task:
                return {"ok": False, "error": "Task not found"}

            task.status = "CANCELLED"
            task.completed_at = get_utc_now()
            task.result_summary = f"Execution stopped: {reason or 'Stopped by user'}"

            stop_msg = TaskMessageModel(
                task_id=task_id,
                sender="system",
                content=f"⏹ **Task stopped by user.** {reason or ''}".strip()
            )
            session.add(stop_msg)
            await session.commit()

        await ws_manager.broadcast("TASK_STATUS_CHANGE", {
            "task_id": task_id,
            "status": "CANCELLED"
        })
        return {"ok": True, "task_id": task_id, "status": "CANCELLED"}

    async def send_user_message(self, task_id: str, message_text: str) -> Dict[str, Any]:
        """
        Injects a user message into a task chat thread and executes the agentic follow-up.
        """
        async with async_session_factory() as session:
            # 1. Fetch task model
            stmt = select(TaskModel).where(TaskModel.id == task_id)
            result = await session.execute(stmt)
            task = result.scalars().first()
            if not task:
                return {"ok": False, "error": "Task not found"}

            title = task.title
            persona = task.persona
            workspace_path = Path(task.workspace_path or str(worktree_manager.get_task_workspace_path(task_id)))

            # 2. Record user message in DB
            u_tokens = estimate_tokens(message_text)
            user_msg = TaskMessageModel(
                task_id=task_id,
                sender="user",
                content=message_text,
                tokens=u_tokens
            )
            session.add(user_msg)
            await session.execute(
                update(TaskModel)
                .where(TaskModel.id == task_id)
                .values(total_tokens=TaskModel.total_tokens + u_tokens)
            )
            await session.commit()

            # 3. Retrieve full conversation history for multi-turn context
            stmt_msgs = select(TaskMessageModel).where(TaskMessageModel.task_id == task_id).order_by(TaskMessageModel.created_at)
            res_msgs = await session.execute(stmt_msgs)
            db_messages = res_msgs.scalars().all()
            history = [
                {"sender": m.sender, "content": m.content, "thought": m.thought}
                for m in db_messages
            ]

        # Broadcast user message
        await ws_manager.broadcast("CHAT_MESSAGE", {
            "task_id": task_id,
            "sender": "user",
            "content": message_text,
            "tokens": u_tokens,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })

        # Check if user message contains credentials to store
        gh_match = re.search(r"(ghp_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{10,})", message_text)
        if gh_match:
            new_gh_token = gh_match.group(1)
            from app.integrations.manager import integration_manager
            await integration_manager.update_credentials("github", {"token": new_gh_token})
            github_client.token = new_gh_token
            logger.info(f"Updated GitHub credentials from user chat message in task {task_id}")

        # Auto-extract repo URL from user message if provided
        active_repo_url = task.repo_url
        active_repo_name = task.repo_name
        repo_match = re.search(r"(https?://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?)", message_text, re.IGNORECASE)
        if repo_match:
            active_repo_url = repo_match.group(1).rstrip(".")
            active_repo_name = active_repo_url.split("github.com/")[-1].replace(".git", "")
            async with async_session_factory() as session:
                await session.execute(
                    update(TaskModel)
                    .where(TaskModel.id == task_id)
                    .values(repo_url=active_repo_url, repo_name=active_repo_name)
                )
                await session.commit()

        # Build execution prompt
        worker_prompt = message_text
        if gh_match and task.description and task.description != message_text:
            worker_prompt = f"{task.description}\n\nUser provided credential: {message_text}"

        # Spawn asynchronous execution worker for the agent response
        worker = asyncio.create_task(
            self._run_task_worker(
                task_id=task_id,
                title=title,
                description=worker_prompt,
                persona=persona,
                repo_name=active_repo_name,
                repo_url=active_repo_url,
                target_branch=task.target_branch,
                commit_sha=task.commit_sha,
                history=history
            )
        )
        self.active_tasks[task_id] = worker

        return {"ok": True, "task_id": task_id}

    async def edit_and_resubmit_message(
        self,
        task_id: str,
        message_id: str,
        new_content: str
    ) -> Dict[str, Any]:
        """
        Edits a user message (or initial task prompt), prunes subsequent messages/logs,
        and re-runs the agent from that point in the conversation.
        """
        # Cancel any active running worker for this task
        if task_id in self.active_tasks:
            worker = self.active_tasks[task_id]
            if not worker.done():
                worker.cancel()
            self.active_tasks.pop(task_id, None)

        async with async_session_factory() as session:
            stmt = select(TaskModel).where(TaskModel.id == task_id)
            result = await session.execute(stmt)
            task = result.scalars().first()
            if not task:
                return {"ok": False, "error": "Task not found"}

            title = task.title
            persona = task.persona
            repo_name = task.repo_name
            repo_url = task.repo_url
            target_branch = task.target_branch
            commit_sha = task.commit_sha

            if message_id == "initial":
                # Editing initial task prompt
                task.description = new_content
                task.title = new_content[:70]
                task.status = "RUNNING"
                task.result_summary = None
                task.completed_at = None

                # Delete all messages, logs, approvals, diffs
                await session.execute(delete(TaskMessageModel).where(TaskMessageModel.task_id == task_id))
                await session.execute(delete(TaskLogModel).where(TaskLogModel.task_id == task_id))
                await session.execute(delete(TaskApprovalModel).where(TaskApprovalModel.task_id == task_id))
                await session.execute(delete(TaskDiffModel).where(TaskDiffModel.task_id == task_id))
                await session.commit()

                history = None
                prompt_to_run = new_content
            else:
                # Editing an existing message in the chat feed
                stmt_msg = select(TaskMessageModel).where(
                    TaskMessageModel.id == message_id,
                    TaskMessageModel.task_id == task_id
                )
                res_msg = await session.execute(stmt_msg)
                target_msg = res_msg.scalars().first()
                if not target_msg:
                    return {"ok": False, "error": "Target message not found"}

                target_created_at = target_msg.created_at
                target_msg.content = new_content

                # Delete messages created strictly after this message
                await session.execute(
                    delete(TaskMessageModel).where(
                        TaskMessageModel.task_id == task_id,
                        TaskMessageModel.created_at > target_created_at
                    )
                )
                # Prune logs, diffs, approvals created after
                await session.execute(
                    delete(TaskLogModel).where(
                        TaskLogModel.task_id == task_id,
                        TaskLogModel.created_at >= target_created_at
                    )
                )
                await session.execute(
                    delete(TaskApprovalModel).where(
                        TaskApprovalModel.task_id == task_id,
                        TaskApprovalModel.created_at >= target_created_at
                    )
                )
                await session.execute(
                    delete(TaskDiffModel).where(
                        TaskDiffModel.task_id == task_id,
                        TaskDiffModel.created_at >= target_created_at
                    )
                )

                task.status = "RUNNING"
                task.result_summary = None
                task.completed_at = None
                await session.commit()

                # Fetch history up to this message
                stmt_hist = select(TaskMessageModel).where(
                    TaskMessageModel.task_id == task_id,
                    TaskMessageModel.created_at <= target_created_at
                ).order_by(TaskMessageModel.created_at)
                res_hist = await session.execute(stmt_hist)
                db_messages = res_hist.scalars().all()
                history = [
                    {"sender": m.sender, "content": m.content, "thought": m.thought}
                    for m in db_messages
                ]
                prompt_to_run = new_content

        # Broadcast status change
        await ws_manager.broadcast("TASK_STATUS_CHANGE", {
            "task_id": task_id,
            "status": "RUNNING"
        })

        # Spawn asynchronous execution worker
        worker = asyncio.create_task(
            self._run_task_worker(
                task_id=task_id,
                title=title,
                description=prompt_to_run,
                persona=persona,
                repo_name=repo_name,
                repo_url=repo_url,
                target_branch=target_branch,
                commit_sha=commit_sha,
                history=history
            )
        )
        self.active_tasks[task_id] = worker

        return {"ok": True, "task_id": task_id}

    async def retry_task(
        self,
        task_id: str,
        from_message_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Retries / regenerates execution for a task or from a specific user message.
        """
        async with async_session_factory() as session:
            if from_message_id and from_message_id != "initial":
                stmt_msg = select(TaskMessageModel).where(
                    TaskMessageModel.id == from_message_id,
                    TaskMessageModel.task_id == task_id
                )
                res_msg = await session.execute(stmt_msg)
                target_msg = res_msg.scalars().first()
                if target_msg:
                    return await self.edit_and_resubmit_message(task_id, from_message_id, target_msg.content)

            # Find latest user message
            stmt_user = select(TaskMessageModel).where(
                TaskMessageModel.task_id == task_id,
                TaskMessageModel.sender == "user"
            ).order_by(TaskMessageModel.created_at.desc())
            res_user = await session.execute(stmt_user)
            last_user_msg = res_user.scalars().first()

            if last_user_msg:
                return await self.edit_and_resubmit_message(task_id, last_user_msg.id, last_user_msg.content)
            else:
                stmt_task = select(TaskModel).where(TaskModel.id == task_id)
                res_task = await session.execute(stmt_task)
                task = res_task.scalars().first()
                if not task:
                    return {"ok": False, "error": "Task not found"}
                return await self.edit_and_resubmit_message(task_id, "initial", task.description or task.title)


agent_pool = AgentTaskPool()
