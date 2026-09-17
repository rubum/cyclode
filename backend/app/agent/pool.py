import asyncio
import logging
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, Any, Optional, List
from sqlalchemy import select, update, delete
from app.config import settings
from app.db.session import async_session_factory
from app.db.models import TaskModel, TaskMessageModel, TaskLogModel, TaskApprovalModel, TaskDiffModel, TaskPRModel, get_utc_now
from app.core.worktree import worktree_manager
from app.agent.tools import WorkspaceTools
from app.core.sandboxes.manager import sandbox_manager
from app.core.sandboxes.base import CloneAuthRequiredException, CloneFailedException
from app.agent.harness import antigravity_harness
from app.api.websocket import ws_manager
from app.integrations.github_client import github_client
from app.integrations.slack_client import slack_client
from app.agent.title_generator import generate_heuristic_title, generate_ai_title

logger = logging.getLogger("cyclode.pool")


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    words = len(text.split())
    chars = len(text)
    return max(1, int(max(words * 1.3, chars / 4)))


class AgentTaskPool:
    def __init__(self):
        self.active_tasks: Dict[str, asyncio.Task] = {}
        self.pending_inquiries: Dict[str, Dict[str, Any]] = {}

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
        commit_sha: Optional[str] = None,
        is_subsession: bool = False,
        parent_task_id: Optional[str] = None
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

        # Auto-resolve repository from database vault if repository name is referenced
        if not repo_url:
            try:
                from app.db.session import ensure_default_repositories
                await ensure_default_repositories()
                from app.db.models import RepositoryConfigModel
                async with async_session_factory() as session:
                    res = await session.execute(select(RepositoryConfigModel))
                    saved_repos = sorted(
                        res.scalars().all(),
                        key=lambda r: max(len(r.full_name or ""), len(r.name or "")),
                        reverse=True
                    )
                    combined_lower = f"{title} {description}".lower()
                    for r in saved_repos:
                        r_name = (r.name or "").lower()
                        r_full = (r.full_name or "").lower()
                        if (
                            (r_name and (r_name in combined_lower.split() or f"@{r_name}" in combined_lower)) or
                            (r_full and (r_full in combined_lower or f"@{r_full}" in combined_lower)) or
                            f"repo {r_name}" in combined_lower or
                            f"on {r_name}" in combined_lower or
                            f"in {r_name}" in combined_lower
                        ):
                            repo_url = r.clone_url
                            repo_name = r.full_name
                            target_branch = target_branch or r.default_branch
                            break
            except Exception as e:
                logger.debug(f"Vault auto-resolution note: {e}")

        # If interactive user session without an explicit custom title, generate clean heuristic title immediately
        initial_title = title
        if not event_id and (not title or "http" in title or title == description[:70]):
            initial_title = generate_heuristic_title(description or title, repo_name)

        chosen_model = model_name or settings.ANTIGRAVITY_MODEL
        init_tokens = estimate_tokens(description or initial_title)
        
        async with async_session_factory() as session:
            task = TaskModel(
                title=initial_title,
                custom_title=False,
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
                is_subsession=is_subsession,
                parent_task_id=parent_task_id,
                sandbox_status="PROVISIONING",
                total_tokens=init_tokens,
                git_branch=f"cyclode/task-{datetime.now().strftime('%Y%m%d%H%M%S')}"
            )
            session.add(task)
            await session.commit()
            await session.refresh(task)
            task_id = task.id

        # Broadcast task creation to UI
        await ws_manager.broadcast("TASK_CREATED", {
            "id": task_id,
            "title": initial_title,
            "persona": persona,
            "model_name": chosen_model,
            "status": "INITIALIZING",
            "session_key": session_key,
            "repo_name": repo_name,
            "commit_sha": commit_sha,
            "is_subsession": is_subsession,
            "parent_task_id": parent_task_id,
            "sandbox_status": "PROVISIONING",
            "created_at": datetime.now(timezone.utc).isoformat()
        })

        # For user-initiated tasks, spawn async AI title generator in background
        if not event_id:
            asyncio.create_task(
                self._generate_and_update_title(
                    task_id=task_id,
                    prompt=description or initial_title,
                    repo_name=repo_name,
                    model_name=chosen_model
                )
            )

        # Spawn background execution worker
        worker = asyncio.create_task(
            self._run_task_worker(
                task_id=task_id,
                title=initial_title,
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

    async def _generate_and_update_title(
        self,
        task_id: str,
        prompt: str,
        repo_name: Optional[str] = None,
        model_name: Optional[str] = None
    ):
        """
        Asynchronously generates a concise 3-6 word AI title using the active model provider and updates
        the task title in the database & broadcasts via WebSocket, respecting user custom titles.
        """
        try:
            # Yield control so worker starts first
            await asyncio.sleep(0.1)
            title_model = model_name if (model_name and model_name.lower() not in ["auto", "adaptive"]) else settings.ANTIGRAVITY_MINOR_MODEL
            ai_title = await generate_ai_title(prompt, repo_name, model_name=title_model)
            if not ai_title:
                return

            async with async_session_factory() as session:
                stmt = select(TaskModel).where(TaskModel.id == task_id)
                res = await session.execute(stmt)
                task = res.scalars().first()
                if not task:
                    return
                # Do NOT overwrite if user has manually edited the title!
                if getattr(task, "custom_title", False):
                    logger.info(f"Skipping AI title update for task {task_id} because custom title is set")
                    return

                task.title = ai_title
                await session.commit()

            # Broadcast update over WebSocket
            await ws_manager.broadcast("TASK_TITLE_UPDATED", {
                "task_id": task_id,
                "title": ai_title,
                "custom_title": False
            })
            logger.info(f"Task {task_id} title updated to '{ai_title}' via AI")
        except Exception as e:
            logger.debug(f"Async AI title generation notice: {e}")

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
            task_model_name = settings.ANTIGRAVITY_MODEL

            # Update status to RUNNING, sandbox to ACTIVE, and fetch model_name
            async with async_session_factory() as session:
                task_rec = await session.get(TaskModel, task_id)
                if task_rec and task_rec.model_name:
                    task_model_name = task_rec.model_name
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

            active_plan: Optional[Dict[str, Any]] = None

            # Define telemetry callbacks
            async def on_plan(plan_data: Dict[str, Any]):
                nonlocal active_plan
                active_plan = plan_data
                try:
                    async with async_session_factory() as session:
                        await session.execute(
                            update(TaskModel).where(TaskModel.id == task_id).values(plan=plan_data)
                        )
                        await session.commit()
                except Exception as e:
                    logger.debug(f"Plan db update note: {e}")

                await ws_manager.broadcast("TASK_PLAN_UPDATED", {
                    "task_id": task_id,
                    "plan": plan_data
                })

            async def on_thought(thought_text: str):
                t_tokens = estimate_tokens(thought_text)
                async with async_session_factory() as session:
                    msg = TaskMessageModel(
                        task_id=task_id,
                        sender="agent",
                        content="",
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
                        plan=active_plan if sender == "agent" else None,
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
                    "plan": active_plan if sender == "agent" else None,
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

            # Define WebSocket streaming callbacks
            async def on_stream_start(stream_type: str, stream_id: str):
                await ws_manager.broadcast("STREAM_START", {
                    "task_id": task_id,
                    "stream_id": stream_id,
                    "stream_type": stream_type,
                    "sender": "agent",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })

            async def on_stream_chunk(stream_type: str, stream_id: str, delta: str, accumulated: str):
                await ws_manager.broadcast("STREAM_CHUNK", {
                    "task_id": task_id,
                    "stream_id": stream_id,
                    "stream_type": stream_type,
                    "delta": delta,
                    "accumulated": accumulated
                })

            async def on_stream_end(stream_type: str, stream_id: str, final_content: str):
                tokens = estimate_tokens(final_content)
                await ws_manager.broadcast("STREAM_END", {
                    "task_id": task_id,
                    "stream_id": stream_id,
                    "stream_type": stream_type,
                    "final_content": final_content,
                    "tokens": tokens,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                })

            async def on_inquiry(question: str, options: List[Dict[str, Any]], default_option_id: str, timeout_seconds: int = 25) -> Dict[str, Any]:
                expires_at = (datetime.now(timezone.utc) + timedelta(seconds=timeout_seconds)).isoformat()
                approval_id = None

                # Create TaskApprovalModel for inquiry
                async with async_session_factory() as session:
                    approval = TaskApprovalModel(
                        task_id=task_id,
                        action_type="user_inquiry",
                        action_details={
                            "question": question,
                            "options": options,
                            "default_option_id": default_option_id,
                            "timeout_seconds": timeout_seconds,
                            "expires_at": expires_at
                        },
                        status="PENDING"
                    )
                    session.add(approval)
                    await session.execute(
                        update(TaskModel).where(TaskModel.id == task_id).values(status="AWAITING_INPUT")
                    )
                    await session.commit()
                    await session.refresh(approval)
                    approval_id = approval.id

                # Broadcast inquiry to UI
                await ws_manager.broadcast("INQUIRY_REQUESTED", {
                    "task_id": task_id,
                    "approval_id": approval_id,
                    "question": question,
                    "options": options,
                    "default_option_id": default_option_id,
                    "timeout_seconds": timeout_seconds,
                    "expires_at": expires_at,
                    "status": "AWAITING_INPUT"
                })
                await ws_manager.broadcast("APPROVAL_REQUIRED", {
                    "task_id": task_id,
                    "approval_id": approval_id,
                    "action_type": "user_inquiry",
                    "details": {
                        "question": question,
                        "options": options,
                        "default_option_id": default_option_id,
                        "timeout_seconds": timeout_seconds,
                        "expires_at": expires_at
                    },
                    "status": "AWAITING_INPUT"
                })
                await ws_manager.broadcast("TASK_STATUS_CHANGE", {
                    "task_id": task_id,
                    "status": "AWAITING_INPUT"
                })

                inquiry_event = asyncio.Event()
                self.pending_inquiries[task_id] = {
                    "event": inquiry_event,
                    "response_data": None,
                    "default_option_id": default_option_id,
                    "options": options,
                    "approval_id": approval_id
                }

                default_label = default_option_id
                for o in options:
                    if isinstance(o, dict) and o.get("id") == default_option_id:
                        default_label = o.get("label", default_option_id)
                        break

                timed_out = False
                res_data: Dict[str, Any] = {}

                try:
                    await asyncio.wait_for(inquiry_event.wait(), timeout=float(timeout_seconds))
                    res_data = self.pending_inquiries.get(task_id, {}).get("response_data", {}) or {}
                except asyncio.TimeoutError:
                    timed_out = True
                finally:
                    self.pending_inquiries.pop(task_id, None)

                selected_opt_id = res_data.get("selected_option_id") or default_option_id
                selected_label = default_label
                for o in options:
                    if isinstance(o, dict) and o.get("id") == selected_opt_id:
                        selected_label = o.get("label", selected_opt_id)
                        break

                custom_resp = res_data.get("custom_response")

                # Update approval record and task status in DB
                async with async_session_factory() as session:
                    stmt_a = select(TaskApprovalModel).where(TaskApprovalModel.id == approval_id)
                    res_a = await session.execute(stmt_a)
                    app_record = res_a.scalars().first()
                    if app_record:
                        app_record.status = "APPROVED"
                        app_record.feedback = f"User responded: {custom_resp}" if custom_resp else (
                            f"(Auto-proceeded after timeout: {selected_label})" if timed_out else f"Selected: {selected_label}"
                        )
                        app_record.resolved_at = get_utc_now()

                    await session.execute(
                        update(TaskModel).where(TaskModel.id == task_id).values(status="RUNNING")
                    )
                    await session.commit()

                await ws_manager.broadcast("APPROVAL_RESOLVED", {
                    "task_id": task_id,
                    "approval_id": approval_id,
                    "status": "APPROVED",
                    "selection": selected_label,
                    "timed_out": timed_out
                })
                await ws_manager.broadcast("TASK_STATUS_CHANGE", {
                    "task_id": task_id,
                    "status": "RUNNING"
                })

                return {
                    "selected_option_id": selected_opt_id,
                    "label": selected_label,
                    "custom_response": custom_resp,
                    "timed_out": timed_out
                }

            # Execute via Antigravity Harness configured for the task's model
            from app.agent.harness import AntigravityHarness
            task_harness = AntigravityHarness(model_name=task_model_name)
            result = await task_harness.execute_task(
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
                history=history,
                on_stream_start=on_stream_start,
                on_stream_chunk=on_stream_chunk,
                on_stream_end=on_stream_end,
                on_inquiry=on_inquiry,
                on_plan=on_plan
            )

            # Determine final status
            raw_status = result.get("status", "COMPLETED")
            async with async_session_factory() as session:
                stmt_t = select(TaskModel).where(TaskModel.id == task_id)
                res_t = await session.execute(stmt_t)
                t = res_t.scalars().first()
                session_key = t.session_key if t else None
                current_sb_status = t.sandbox_status if t else "NONE"

                # If task is awaiting input (e.g. auth required), keep AWAITING_INPUT during conversational turns
                if current_sb_status in ["AUTH_REQUIRED", "CLONE_FAILED"] and not repo_url:
                    final_status = "AWAITING_INPUT"
                    final_sb_status = current_sb_status
                elif raw_status == "COMPLETED" and session_key:
                    final_status = "IDLE"
                    final_sb_status = "ACTIVE" if repo_url else current_sb_status
                else:
                    final_status = raw_status
                    final_sb_status = "ACTIVE" if repo_url else current_sb_status

                await session.execute(
                    update(TaskModel)
                    .where(TaskModel.id == task_id)
                    .values(
                        status=final_status,
                        sandbox_status=final_sb_status,
                        result_summary=result.get("summary", ""),
                        completed_at=get_utc_now() if final_status in ["COMPLETED", "IDLE"] else None
                    )
                )
                await session.commit()

            await ws_manager.broadcast("TASK_STATUS_CHANGE", {
                "task_id": task_id,
                "status": final_status,
                "sandbox_status": final_sb_status,
                "result_summary": result.get("summary", "")
            })

        except CloneAuthRequiredException as e:
            logger.info(f"Task {task_id} requires GitHub authentication for {e.repo_url}")
            guidance_msg = (
                f"### 🔒 GitHub Authentication Required\n\n"
                f"I attempted to clone `{e.repo_url}`, but it is a **private repository** or requires GitHub authorization (`fatal: could not read Username`).\n\n"
                f"#### How you can assist:\n"
                f"- **Paste your Token here in Chat**: Reply directly with your GitHub Personal Access Token (`ghp_...` or `github_pat_...`). It will be automatically masked in the UI and used to authenticate.\n"
                f"- **Configure Integrations**: Open the **Integrations** tab in the sidebar and configure your GitHub token globally.\n\n"
                f"Feel free to ask me any questions, or paste your token and I'll immediately clone `{e.repo_url}` and proceed with your task!"
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
            err_content = f"### ⚠️ Execution Error\n\nAn unexpected error occurred during execution:\n```text\n{e}\n```\n\nYou can click **Retry** to re-run the task."
            async with async_session_factory() as session:
                err_msg = TaskMessageModel(
                    task_id=task_id,
                    sender="agent",
                    content=err_content,
                    thought="Execution encountered an unhandled exception.",
                    tokens=estimate_tokens(err_content)
                )
                session.add(err_msg)
                await session.execute(
                    update(TaskModel)
                    .where(TaskModel.id == task_id)
                    .values(status="FAILED", result_summary=str(e), completed_at=get_utc_now())
                )
                await session.commit()

            await ws_manager.broadcast("TASK_MESSAGE", {
                "task_id": task_id,
                "sender": "agent",
                "content": err_content,
                "tokens": estimate_tokens(err_content),
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

            await ws_manager.broadcast("TASK_STATUS_CHANGE", {
                "task_id": task_id,
                "status": "FAILED",
                "error": str(e)
            })
        finally:
            # We preserve the sandbox workspace on disk throughout the session lifetime.
            # Sandbox is only destroyed when the user explicitly deletes the task session (DELETE /api/tasks/{task_id})
            # or clears all sessions. This ensures continuous file/diff browsing and multi-turn context.
            if sandbox_ctx and sandbox_ctx.workspace_path.exists():
                async with async_session_factory() as session:
                    await session.execute(
                        update(TaskModel)
                        .where(TaskModel.id == task_id)
                        .values(sandbox_status="ACTIVE")
                    )
                    await session.commit()

                await ws_manager.broadcast("TASK_STATUS_CHANGE", {
                    "task_id": task_id,
                    "sandbox_status": "ACTIVE"
                })

            self.active_tasks.pop(task_id, None)

    async def respond_to_inquiry(
        self,
        task_id: str,
        selected_option_id: Optional[str] = None,
        custom_response: Optional[str] = None,
        feedback: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Resolves an active inquiry with user choice or custom write-in.
        """
        if task_id in self.pending_inquiries:
            inq = self.pending_inquiries[task_id]
            inq["response_data"] = {
                "selected_option_id": selected_option_id or inq.get("default_option_id"),
                "custom_response": custom_response,
                "feedback": feedback
            }
            if "event" in inq and not inq["event"].is_set():
                inq["event"].set()
            return {"ok": True, "task_id": task_id, "status": "RESOLVED"}

        # Fallback if task is not in memory: resolve in DB
        async with async_session_factory() as session:
            stmt = select(TaskApprovalModel).where(
                TaskApprovalModel.task_id == task_id,
                TaskApprovalModel.status == "PENDING"
            )
            result = await session.execute(stmt)
            approval = result.scalars().first()
            if approval:
                approval.status = "APPROVED"
                approval.feedback = custom_response or feedback or selected_option_id
                approval.resolved_at = get_utc_now()
                await session.commit()

        await ws_manager.broadcast("APPROVAL_RESOLVED", {
            "task_id": task_id,
            "status": "APPROVED"
        })
        return {"ok": True, "task_id": task_id, "status": "RESOLVED"}

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

            if approval and approval.action_type == "user_inquiry":
                return await self.respond_to_inquiry(
                    task_id=task_id,
                    custom_response=feedback,
                    feedback=feedback
                )

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
                head_branch=f"cyclode/fix-{task_id[:8]}"
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

    async def execute_pr_action(
        self,
        task_id: str,
        pr_id: str,
        action: str,
        custom_feedback: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Executes a targeted action on a Pull Request (run_tests, sync, post_review, auto_fix).
        """
        async with async_session_factory() as session:
            stmt = select(TaskPRModel).where(TaskPRModel.id == pr_id, TaskPRModel.task_id == task_id)
            res = await session.execute(stmt)
            pr = res.scalars().first()
            if not pr and pr_id.isdigit():
                stmt_num = select(TaskPRModel).where(TaskPRModel.pr_number == int(pr_id), TaskPRModel.task_id == task_id)
                res_num = await session.execute(stmt_num)
                pr = res_num.scalars().first()
            if not pr:
                return {"ok": False, "error": f"Pull Request {pr_id} not found for task {task_id}"}

            task_stmt = select(TaskModel).where(TaskModel.id == task_id)
            task_res = await session.execute(task_stmt)
            task = task_res.scalars().first()
            repo_name = task.repo_name if task else None
            repo_url = task.repo_url if task else None

            if action == "run_tests":
                pr.status = "REVIEWING"
                await session.commit()
                await ws_manager.broadcast("TASK_PR_UPDATED", {
                    "task_id": task_id,
                    "pr_id": pr.id,
                    "pr_number": pr.pr_number,
                    "status": "REVIEWING"
                })

                workspace_path = Path(task.workspace_path if task and task.workspace_path else "/workspaces")
                test_cmd = "pytest -v" if (workspace_path / "pytest.ini").exists() or (workspace_path / "tests").exists() else "npm test"
                if repo_name:
                    from app.db.models import RepositoryConfigModel
                    r_res = await session.execute(select(RepositoryConfigModel).where(RepositoryConfigModel.full_name == repo_name))
                    r_cfg = r_res.scalars().first()
                    if r_cfg and r_cfg.test_command:
                        test_cmd = r_cfg.test_command

                res_run = WorkspaceTools.run_command(workspace_path, test_cmd)
                exit_code = res_run.get("exit_code", 0)
                output = res_run.get("stdout", "") or res_run.get("stderr", "") or "Test command executed."
                pr.status = "TESTS_PASSING" if exit_code == 0 else "TESTS_FAILED"
                pr.test_output = output
                await session.commit()

                await ws_manager.broadcast("TASK_PR_UPDATED", {
                    "task_id": task_id,
                    "pr_id": pr.id,
                    "pr_number": pr.pr_number,
                    "status": pr.status,
                    "test_output": pr.test_output
                })
                return {"ok": True, "status": pr.status, "test_output": pr.test_output}

            elif action == "sync":
                if repo_name:
                    pr_info = await github_client.get_pull_request(repo_name, pr.pr_number)
                    if pr_info:
                        pr.title = pr_info.get("title", pr.title)
                        pr.head_branch = pr_info.get("head_branch", pr.head_branch)
                        pr.base_branch = pr_info.get("base_branch", pr.base_branch)
                        pr.author = pr_info.get("author", pr.author)
                        pr.html_url = pr_info.get("html_url", pr.html_url)
                        raw_state = (pr_info.get("state") or "OPEN").upper()
                        if pr_info.get("merged"):
                            pr.status = "MERGED"
                        elif raw_state == "CLOSED":
                            pr.status = "CLOSED"
                        elif pr.status not in ["TESTS_PASSING", "TESTS_FAILED"]:
                            pr.status = "OPEN"
                        pr.diff_stats = {
                            "additions": pr_info.get("additions", 0),
                            "deletions": pr_info.get("deletions", 0),
                            "changed_files": pr_info.get("changed_files_count", 0)
                        }
                        await session.commit()

                await ws_manager.broadcast("TASK_PR_UPDATED", {
                    "task_id": task_id,
                    "pr_id": pr.id,
                    "pr_number": pr.pr_number,
                    "title": pr.title,
                    "status": pr.status,
                    "head_branch": pr.head_branch,
                    "base_branch": pr.base_branch,
                    "diff_stats": pr.diff_stats
                })
                return {"ok": True, "pr": {
                    "id": pr.id,
                    "pr_number": pr.pr_number,
                    "title": pr.title,
                    "status": pr.status
                }}

            elif action == "post_review":
                review_body = custom_feedback or pr.review_summary or f"AI Review for PR #{pr.pr_number}: Automated analysis complete."
                if repo_name:
                    review_res = await github_client.post_pull_request_review(
                        repo_name=repo_name,
                        pr_number=pr.pr_number,
                        body=review_body,
                        event="COMMENT"
                    )
                    pr.review_summary = review_body
                    await session.commit()
                    await ws_manager.broadcast("TASK_PR_UPDATED", {
                        "task_id": task_id,
                        "pr_id": pr.id,
                        "pr_number": pr.pr_number,
                        "review_summary": pr.review_summary
                    })
                    return {"ok": True, "result": review_res}
                return {"ok": False, "error": "No repository name attached to task"}

            return {"ok": False, "error": f"Unknown action '{action}'"}

    async def send_user_message(
        self,
        task_id: str,
        message_text: str,
        model_name: Optional[str] = None
    ) -> Dict[str, Any]:
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

            update_vals: Dict[str, Any] = {"total_tokens": TaskModel.total_tokens + u_tokens}
            if model_name:
                update_vals["model_name"] = model_name

            await session.execute(
                update(TaskModel)
                .where(TaskModel.id == task_id)
                .values(**update_vals)
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

        # Auto-resolve from database vault if repository is referenced in user message
        if not active_repo_url and not repo_match:
            try:
                from app.db.models import RepositoryConfigModel
                async with async_session_factory() as session:
                    res = await session.execute(select(RepositoryConfigModel))
                    saved_repos = res.scalars().all()
                    msg_lower = message_text.lower()
                    for r in saved_repos:
                        r_name = (r.name or "").lower()
                        r_full = (r.full_name or "").lower()
                        if (r_name and r_name in msg_lower.split()) or (r_full and r_full in msg_lower) or f"repo {r_name}" in msg_lower or f"on {r_name}" in msg_lower:
                            active_repo_url = r.clone_url
                            active_repo_name = r.full_name
                            await session.execute(
                                update(TaskModel)
                                .where(TaskModel.id == task_id)
                                .values(repo_url=active_repo_url, repo_name=active_repo_name, target_branch=r.default_branch)
                            )
                            await session.commit()
                            break
            except Exception as e:
                logger.debug(f"Vault auto-resolution note in message: {e}")

        # Determine whether to attempt repository clone or operate in conversational mode
        repo_url_to_pass = active_repo_url
        if task.sandbox_status in ["AUTH_REQUIRED", "CLONE_FAILED"] and not gh_match and not repo_match and not active_repo_url:
            # User is asking questions or chatting before a token or new URL is provided
            repo_url_to_pass = None

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
                repo_url=repo_url_to_pass,
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
                # If user hasn't manually renamed the session, update title to match new prompt
                if not getattr(task, "custom_title", False):
                    new_heuristic = generate_heuristic_title(new_content, repo_name)
                    task.title = new_heuristic
                    title = new_heuristic
                    asyncio.create_task(
                        self._generate_and_update_title(
                            task_id=task_id,
                            prompt=new_content,
                            repo_name=repo_name
                        )
                    )
                task.status = "RUNNING"
                task.result_summary = None
                task.completed_at = None

                # Delete all messages, logs, approvals, diffs
                await session.execute(delete(TaskMessageModel).where(TaskMessageModel.task_id == task_id))
                await session.execute(delete(TaskLogModel).where(TaskLogModel.task_id == task_id))
                await session.execute(delete(TaskApprovalModel).where(TaskApprovalModel.task_id == task_id))
                await session.execute(delete(TaskDiffModel).where(TaskDiffModel.task_id == task_id))
                await session.commit()

                if not getattr(task, "custom_title", False):
                    await ws_manager.broadcast("TASK_TITLE_UPDATED", {
                        "task_id": task_id,
                        "title": title,
                        "custom_title": False
                    })

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
            stmt_task = select(TaskModel).where(TaskModel.id == task_id)
            res_task = await session.execute(stmt_task)
            task = res_task.scalars().first()
            if not task:
                return {"ok": False, "error": "Task not found"}

            if from_message_id == "initial":
                return await self.edit_and_resubmit_message(task_id, "initial", task.description or task.title)

            if from_message_id:
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
                return await self.edit_and_resubmit_message(task_id, "initial", task.description or task.title)


agent_pool = AgentTaskPool()
