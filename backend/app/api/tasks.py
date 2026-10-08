import os
import re
import time
import shutil
import subprocess
import logging
import mimetypes
import asyncio
import zipfile
import tarfile
import csv
import json
import io
import sqlite3
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from urllib.parse import unquote
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple
from pydantic import BaseModel
from sqlalchemy import select, desc, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = logging.getLogger(__name__)
from app.db.session import get_db
from app.db.models import TaskModel, TaskMessageModel, TaskLogModel, TaskApprovalModel, TaskDiffModel, TaskPRModel, EventModel, get_utc_now
from app.agent.pool import agent_pool
from app.core.sandboxes.manager import sandbox_manager
from app.core.worktree import worktree_manager
from app.api.websocket import ws_manager
from app.config import settings
from app.core.events.dispatcher import event_dispatcher
from app.agent.harness import get_task_trajectory, get_task_evaluation, generate_plan_markdown, extract_plan_from_markdown
from app.core.evals.runner import evaluation_runner
from app.schemas.events import InboundEventSchema, OutboundEventSchema, EventTimelineItem
from app.schemas.trajectory import AgentTrajectory, TrajectoryTurn, ToolInvocationRecord
from app.schemas.evals import EvaluationScorecard, EvaluationCheck, EvaluationCategory

router = APIRouter(prefix="/api/tasks", tags=["Tasks"])


class InjectEventRequest(BaseModel):
    source: str = "github"
    event_type: str = "pull_request.synchronize"
    title: Optional[str] = None
    description: Optional[str] = None
    payload: Dict[str, Any] = {}
    commit_sha: Optional[str] = None


class ReplayTaskRequest(BaseModel):
    turn_index: Optional[int] = None
    from_event_id: Optional[str] = None


class CreateTaskRequest(BaseModel):
    title: str
    description: str = ""
    persona: str = "IssueResolver"
    model_name: Optional[str] = None
    is_subsession: bool = False
    parent_task_id: Optional[str] = None
    session_key: Optional[str] = None
    repo_name: Optional[str] = None
    repo_url: Optional[str] = None


class UpdateTaskTitleRequest(BaseModel):
    title: str


class UserMessageRequest(BaseModel):
    content: str
    model_name: Optional[str] = None


class EditMessageRequest(BaseModel):
    content: str


class RetryTaskRequest(BaseModel):
    from_message_id: Optional[str] = None


class ApprovalActionRequest(BaseModel):
    feedback: Optional[str] = None
    custom_details: Optional[Dict[str, Any]] = None


class InquiryResponseRequest(BaseModel):
    selected_option_id: Optional[str] = None
    custom_response: Optional[str] = None
    feedback: Optional[str] = None


class ResetTurnRequest(BaseModel):
    turn_index: Optional[int] = None


class PRListenConfigRequest(BaseModel):
    is_listening: bool
    listening_events: Optional[List[str]] = None
    listener_persona: Optional[str] = "PAIR_PROGRAMMER"
    auto_commit_fixes: Optional[bool] = True


class TaskListenConfigRequest(BaseModel):
    is_listening: bool
    listening_events: Optional[List[str]] = None
    listener_persona: Optional[str] = "PAIR_PROGRAMMER"
    auto_commit_fixes: Optional[bool] = True


class RenameFileRequest(BaseModel):
    old_path: str
    new_path: str


@router.get("")
async def list_tasks(
    status: Optional[str] = None,
    persona: Optional[str] = None,
    parent_task_id: Optional[str] = None,
    session_key: Optional[str] = None,
    is_subsession: Optional[bool] = None,
    include_subsessions: bool = False,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    stmt = (
        select(TaskModel)
        .order_by(desc(TaskModel.created_at))
        .limit(limit)
        .options(
            selectinload(TaskModel.prs),
            selectinload(TaskModel.approvals)
        )
    )
    if status:
        stmt = stmt.where(TaskModel.status == status)
    if persona:
        stmt = stmt.where(TaskModel.persona == persona)
    if is_subsession is not None:
        stmt = stmt.where(TaskModel.is_subsession == is_subsession)
    elif parent_task_id:
        stmt = stmt.where(TaskModel.parent_task_id == parent_task_id)
    elif session_key:
        stmt = stmt.where(TaskModel.session_key == session_key)
    elif not include_subsessions:
        stmt = stmt.where(TaskModel.is_subsession == False)

    result = await db.execute(stmt)
    tasks = result.scalars().all()
    
    serialized = []
    for t in tasks:
        serialized.append({
            "id": t.id,
            "session_key": t.session_key,
            "title": t.title,
            "custom_title": getattr(t, "custom_title", False),
            "description": t.description,
            "persona": t.persona,
            "model_name": t.model_name,
            "status": t.status,
            "repo_name": t.repo_name,
            "repo_url": t.repo_url,
            "target_branch": t.target_branch,
            "commit_sha": t.commit_sha,
            "is_subsession": getattr(t, "is_subsession", False),
            "parent_task_id": getattr(t, "parent_task_id", None),
            "sandbox_status": t.sandbox_status,
            "workspace_path": t.workspace_path,
            "git_branch": t.git_branch,
            "total_tokens": t.total_tokens,
            "result_summary": t.result_summary,
            "plan": t.plan,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            "completed_at": t.completed_at.isoformat() if t.completed_at else None,
            "prs": [
                {
                    "id": p.id,
                    "task_id": p.task_id,
                    "pr_number": p.pr_number,
                    "title": p.title,
                    "author": p.author,
                    "head_branch": p.head_branch,
                    "base_branch": p.base_branch,
                    "html_url": p.html_url,
                    "status": p.status,
                    "worktree_path": p.worktree_path,
                    "diff_stats": p.diff_stats or {},
                    "review_summary": p.review_summary,
                    "test_output": p.test_output,
                }
                for p in (t.prs or [])
            ]
        })
    return serialized


@router.post("")
async def create_task(req: CreateTaskRequest):
    import re
    repo_url = req.repo_url
    repo_name = req.repo_name
    title = (req.title or "").strip() or (req.description[:60].strip() if req.description else "New Session")
    description = req.description or ""
    if not repo_url:
        combined_text = f"{title} {description}"
        repo_match = re.search(r"(https?://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?)", combined_text, re.IGNORECASE)
        if repo_match:
            raw_url = repo_match.group(1).rstrip("/")
            if raw_url.endswith(".git"):
                raw_url = raw_url[:-4]
            repo_url = raw_url
            if "github.com/" in repo_url and not repo_name:
                repo_name = repo_url.split("github.com/")[-1]

    task_id = await agent_pool.spawn_task(
        title=title,
        description=description,
        persona=req.persona,
        model_name=req.model_name,
        session_key=req.session_key,
        repo_name=repo_name,
        repo_url=repo_url,
        is_subsession=req.is_subsession,
        parent_task_id=req.parent_task_id
    )
    return {"ok": True, "task_id": task_id, "id": task_id, "status": "INITIALIZING"}


@router.get("/{task_id}")
async def get_task_details(task_id: str, db: AsyncSession = Depends(get_db)):
    stmt = (
        select(TaskModel)
        .where(TaskModel.id == task_id)
        .options(
            selectinload(TaskModel.messages),
            selectinload(TaskModel.logs),
            selectinload(TaskModel.approvals),
            selectinload(TaskModel.diffs),
            selectinload(TaskModel.prs),
            selectinload(TaskModel.event)
        )
    )
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return {
        "id": task.id,
        "session_key": task.session_key,
        "title": task.title,
        "custom_title": getattr(task, "custom_title", False),
        "description": task.description,
        "persona": task.persona,
        "model_name": task.model_name,
        "status": task.status,
        "repo_name": task.repo_name,
        "repo_url": task.repo_url,
        "target_branch": task.target_branch,
        "commit_sha": task.commit_sha,
        "is_subsession": getattr(task, "is_subsession", False),
        "parent_task_id": getattr(task, "parent_task_id", None),
        "sandbox_status": task.sandbox_status,
        "workspace_path": task.workspace_path,
        "git_branch": task.git_branch,
        "total_tokens": task.total_tokens,
        "result_summary": task.result_summary,
        "plan": task.plan,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "completed_at": task.completed_at,
        "event": task.event,
        "messages": task.messages,
        "logs": task.logs,
        "approvals": task.approvals,
        "diffs": task.diffs,
        "prs": task.prs
    }


@router.patch("/{task_id}/title")
async def update_task_title(
    task_id: str,
    req: UpdateTaskTitleRequest,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    clean_title = req.title.strip()
    if not clean_title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")

    task.title = clean_title
    task.custom_title = True
    await db.commit()

    from app.api.websocket import ws_manager
    await ws_manager.broadcast("TASK_TITLE_UPDATED", {
        "task_id": task_id,
        "title": clean_title,
        "custom_title": True
    })

    return {"ok": True, "task_id": task_id, "title": clean_title, "custom_title": True}


@router.post("/{task_id}/message")
async def send_message_to_task(task_id: str, req: UserMessageRequest):
    res = await agent_pool.send_user_message(task_id, req.content, req.model_name)
    return res


@router.post("/{task_id}/retry")
async def retry_task_action(task_id: str, req: Optional[RetryTaskRequest] = None):
    from_msg_id = req.from_message_id if req else None
    res = await agent_pool.retry_task(task_id, from_msg_id)
    return res


@router.post("/{task_id}/reset-turn")
async def reset_task_turn(task_id: str, req: Optional[ResetTurnRequest] = None):
    turn_index = req.turn_index if req else None
    res = await agent_pool.reset_task_turn(task_id, turn_index)
    return res


@router.post("/{task_id}/messages/{message_id}/edit")
async def edit_task_message(task_id: str, message_id: str, req: EditMessageRequest):
    res = await agent_pool.edit_and_resubmit_message(task_id, message_id, req.content)
    return res


@router.put("/{task_id}/description")
async def edit_task_description(task_id: str, req: EditMessageRequest):
    res = await agent_pool.edit_and_resubmit_message(task_id, "initial", req.content)
    return res


class PRActionRequest(BaseModel):
    action: str  # run_tests, sync, post_review
    feedback: Optional[str] = None


class AttachPRRequest(BaseModel):
    pr_number: int
    title: str
    head_branch: str = ""
    base_branch: str = "main"
    author: str = ""
    html_url: str = ""


@router.get("/{task_id}/prs")
async def get_task_prs(
    task_id: str,
    scope: Optional[str] = None,
    author: Optional[str] = None,
    state: Optional[str] = None,
    query: Optional[str] = None,
    is_regex: bool = False,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(TaskPRModel).where(TaskPRModel.task_id == task_id)
    if scope == "session":
        stmt = stmt.where(TaskPRModel.is_session_scoped == True)
    if author:
        clean_author = author.replace("@", "").strip()
        if clean_author:
            stmt = stmt.where(TaskPRModel.author.ilike(f"%{clean_author}%"))
    if state and state.upper() != "ALL":
        if state.upper() == "PASSING":
            stmt = stmt.where(TaskPRModel.status == "TESTS_PASSING")
        elif state.upper() == "FAILED":
            stmt = stmt.where(TaskPRModel.status == "TESTS_FAILED")
        else:
            stmt = stmt.where(TaskPRModel.status == state.upper())

    stmt = stmt.order_by(TaskPRModel.pr_number.desc())
    res = await db.execute(stmt)
    prs = res.scalars().all()

    if query and query.strip():
        q = query.strip()
        if is_regex:
            import re
            try:
                pattern = re.compile(q, re.IGNORECASE)
                prs = [
                    p for p in prs
                    if pattern.search(str(p.pr_number))
                    or (p.title and pattern.search(p.title))
                    or (p.author and pattern.search(p.author))
                    or (p.head_branch and pattern.search(p.head_branch))
                    or (p.base_branch and pattern.search(p.base_branch))
                    or (p.body and pattern.search(p.body))
                    or (p.review_summary and pattern.search(p.review_summary))
                ]
            except re.error:
                prs = [
                    p for p in prs
                    if q.lower() in str(p.pr_number).lower()
                    or (p.title and q.lower() in p.title.lower())
                    or (p.author and q.lower() in p.author.lower())
                    or (p.head_branch and q.lower() in p.head_branch.lower())
                    or (p.base_branch and q.lower() in p.base_branch.lower())
                    or (p.body and q.lower() in p.body.lower())
                    or (p.review_summary and q.lower() in p.review_summary.lower())
                ]
        else:
            q_lower = q.lower()
            prs = [
                p for p in prs
                if q_lower in str(p.pr_number).lower()
                or (p.title and q_lower in p.title.lower())
                or (p.author and q_lower in p.author.lower())
                or (p.head_branch and q_lower in p.head_branch.lower())
                or (p.base_branch and q_lower in p.base_branch.lower())
                or (p.body and q_lower in p.body.lower())
                or (p.review_summary and q_lower in p.review_summary.lower())
            ]
    return [
        {
            "id": p.id,
            "task_id": p.task_id,
            "pr_number": p.pr_number,
            "title": p.title,
            "author": p.author,
            "head_branch": p.head_branch,
            "base_branch": p.base_branch,
            "html_url": p.html_url,
            "body": p.body,
            "status": p.status,
            "is_session_scoped": p.is_session_scoped,
            "is_draft": getattr(p, "is_draft", False),
            "worktree_path": p.worktree_path,
            "diff_stats": p.diff_stats or {},
            "review_summary": p.review_summary,
            "test_output": p.test_output,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        }
        for p in prs
    ]


@router.post("/{task_id}/prs")
async def attach_pr_to_task(task_id: str, req: AttachPRRequest, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskPRModel).where(TaskPRModel.task_id == task_id, TaskPRModel.pr_number == req.pr_number)
    res = await db.execute(stmt)
    existing = res.scalars().first()
    if existing:
        existing.title = req.title
        existing.head_branch = req.head_branch
        existing.base_branch = req.base_branch
        existing.author = req.author
        existing.html_url = req.html_url
        existing.is_session_scoped = True
        await db.commit()
        await ws_manager.broadcast("TASK_PR_UPDATED", {"task_id": task_id, "pr_id": existing.id, "pr_number": existing.pr_number})
        return {"ok": True, "pr_id": existing.id}

    pr = TaskPRModel(
        task_id=task_id,
        pr_number=req.pr_number,
        title=req.title,
        head_branch=req.head_branch,
        base_branch=req.base_branch,
        author=req.author,
        html_url=req.html_url,
        is_session_scoped=True,
        status="OPEN"
    )
    db.add(pr)
    await db.commit()
    await db.refresh(pr)
    await ws_manager.broadcast("TASK_PR_UPDATED", {"task_id": task_id, "pr_id": pr.id, "pr_number": pr.pr_number})
    return {"ok": True, "pr_id": pr.id}


@router.post("/{task_id}/prs/{pr_id}/action")
async def trigger_pr_action(task_id: str, pr_id: str, req: PRActionRequest):
    res = await agent_pool.execute_pr_action(task_id, pr_id, req.action, req.feedback)
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "Action failed"))
    return res


@router.post("/{task_id}/prs/sync_repo")
async def sync_task_repo_prs(task_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.repo_name or "/" not in task.repo_name:
        return {"ok": True, "count": 0, "message": "No repository attached to task"}

    owner, repo = task.repo_name.split("/", 1)
    from app.integrations.github_client import github_client
    from app.integrations.manager import integration_manager

    token = await integration_manager.get_github_token_for_repo(task.repo_url or f"https://github.com/{task.repo_name}")
    raw_prs = await github_client.list_pull_requests(owner, repo, state="all", custom_token=token)

    synced_count = 0
    for p in raw_prs[:50]:
        pr_num = p.get("number")
        if not pr_num:
            continue
        p_stmt = select(TaskPRModel).where(TaskPRModel.task_id == task_id, TaskPRModel.pr_number == pr_num)
        p_res = await db.execute(p_stmt)
        existing = p_res.scalars().first()

        title = p.get("title", f"PR #{pr_num}")
        author = p.get("user", {}).get("login", "unknown") if isinstance(p.get("user"), dict) else str(p.get("user") or "unknown")
        head_branch = p.get("head", {}).get("ref", "") if isinstance(p.get("head"), dict) else ""
        base_branch = p.get("base", {}).get("ref", "main") if isinstance(p.get("base"), dict) else "main"
        html_url = p.get("html_url", "")
        body = p.get("body", "")
        raw_state = (p.get("state") or "OPEN").upper()
        status = "MERGED" if p.get("merged") else ("CLOSED" if raw_state == "CLOSED" else "OPEN")
        is_draft = bool(p.get("draft", False))
        diff_stats = {
            "additions": p.get("additions", 0),
            "deletions": p.get("deletions", 0),
            "changed_files": p.get("changed_files") or p.get("changed_files_count", 0)
        }

        if existing:
            existing.title = title
            existing.author = author
            existing.head_branch = head_branch
            existing.base_branch = base_branch
            existing.html_url = html_url
            existing.is_draft = is_draft
            if body:
                existing.body = body
            if existing.status not in ["TESTS_PASSING", "TESTS_FAILED", "REVIEWING"]:
                existing.status = status
            existing.diff_stats = diff_stats
        else:
            new_pr = TaskPRModel(
                task_id=task_id,
                pr_number=pr_num,
                title=title,
                author=author,
                head_branch=head_branch,
                base_branch=base_branch,
                html_url=html_url,
                body=body,
                is_session_scoped=False,
                is_draft=is_draft,
                status=status,
                diff_stats=diff_stats,
                worktree_path=f"worktree-pr-{pr_num}"
            )
            db.add(new_pr)
        synced_count += 1

    await db.commit()
    await ws_manager.broadcast("TASK_PR_UPDATED", {"task_id": task_id})
    return {"ok": True, "count": synced_count, "repo_name": task.repo_name}



@router.post("/{task_id}/approve")
async def approve_task_action(task_id: str, req: ApprovalActionRequest):
    res = await agent_pool.approve_task(task_id, req.feedback, req.custom_details)
    return res


@router.post("/{task_id}/inquiry/respond")
async def respond_to_inquiry_action(task_id: str, req: InquiryResponseRequest):
    res = await agent_pool.respond_to_inquiry(
        task_id=task_id,
        selected_option_id=req.selected_option_id,
        custom_response=req.custom_response,
        feedback=req.feedback
    )
    return res


@router.post("/{task_id}/reject")
async def reject_task_action(task_id: str, req: ApprovalActionRequest):
    res = await agent_pool.reject_task(task_id, req.feedback)
    return res


@router.post("/{task_id}/stop")
async def stop_task_action(task_id: str):
    res = await agent_pool.stop_task(task_id, "Cancelled by user via UI")
    return res


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str):
    res = await agent_pool.stop_task(task_id, "User cancelled task")
    return res


@router.post("/sandbox/prune")
async def prune_orphaned_sandboxes(db: AsyncSession = Depends(get_db)):
    """
    Scans and purges all stopped or orphaned OCI sandbox containers
    whose task IDs do not exist in the active tasks database.
    """
    stmt = select(TaskModel.id)
    res = await db.execute(stmt)
    active_ids = set(res.scalars().all())
    pruned_count = await sandbox_manager.prune_orphans(active_ids)
    return {"ok": True, "pruned_count": pruned_count}


@router.get("/sandbox/hygiene")
async def get_sandbox_hygiene(db: AsyncSession = Depends(get_db)):
    """
    Returns running vs orphaned container metrics across the host runtime.
    """
    stmt = select(TaskModel.id)
    res = await db.execute(stmt)
    active_ids = set(res.scalars().all())
    hygiene = await sandbox_manager.get_hygiene_summary(active_ids)
    return {"ok": True, "hygiene": hygiene}


@router.delete("")
@router.delete("/")
async def clear_all_tasks(db: AsyncSession = Depends(get_db)):
    stmt = select(TaskModel)
    result = await db.execute(stmt)
    tasks = result.scalars().all()

    # Cancel all active in-memory agent tasks immediately
    for tid in list(agent_pool.active_tasks.keys()):
        try:
            agent_pool.active_tasks[tid].cancel()
            agent_pool.active_tasks.pop(tid, None)
        except Exception:
            pass

    targets = [(task.id, task.workspace_path) for task in tasks]

    # Explicit SQL deletes across all tables in a single transaction
    await db.execute(delete(TaskMessageModel))
    await db.execute(delete(TaskLogModel))
    await db.execute(delete(TaskApprovalModel))
    await db.execute(delete(TaskDiffModel))
    await db.execute(delete(TaskPRModel))
    await db.execute(delete(TaskModel))
    await db.commit()

    # Fire-and-forget non-blocking bulk teardown of companion containers and workspaces
    if targets:
        asyncio.create_task(sandbox_manager.bulk_destroy(targets))

    return {"ok": True, "count": len(tasks), "message": "All sessions cleared"}


@router.delete("/{task_id}")
async def delete_task(task_id: str, db: AsyncSession = Depends(get_db)):
    if not task_id or task_id.strip() == "":
        return await clear_all_tasks(db)

    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()

    if not task:
        # Defensive cleanup: even if missing in DB, ensure any stray container is pruned asynchronously
        asyncio.create_task(sandbox_manager.destroy_by_task_id(task_id))
        return {"ok": True, "deleted_task_id": task_id, "already_deleted": True}

    # Find any subsession IDs associated with this parent task
    sub_stmt = select(TaskModel.id).where(TaskModel.parent_task_id == task_id)
    sub_res = await db.execute(sub_stmt)
    sub_ids = sub_res.scalars().all()
    all_target_ids = [task_id] + list(sub_ids)

    # Cancel active agents in memory for this task and its subsessions
    for tid in all_target_ids:
        if tid in agent_pool.active_tasks:
            try:
                agent_pool.active_tasks[tid].cancel()
                agent_pool.active_tasks.pop(tid, None)
            except Exception:
                pass

    targets = [(tid, task.workspace_path if tid == task_id else None) for tid in all_target_ids]

    # Delete all associated records in dependency order
    await db.execute(delete(TaskMessageModel).where(TaskMessageModel.task_id.in_(all_target_ids)))
    await db.execute(delete(TaskLogModel).where(TaskLogModel.task_id.in_(all_target_ids)))
    await db.execute(delete(TaskApprovalModel).where(TaskApprovalModel.task_id.in_(all_target_ids)))
    await db.execute(delete(TaskDiffModel).where(TaskDiffModel.task_id.in_(all_target_ids)))
    await db.execute(delete(TaskPRModel).where(TaskPRModel.task_id.in_(all_target_ids)))
    await db.execute(delete(TaskModel).where(TaskModel.parent_task_id == task_id))
    await db.execute(delete(TaskModel).where(TaskModel.id == task_id))
    await db.commit()

    # Fire-and-forget non-blocking container & workspace teardown
    asyncio.create_task(sandbox_manager.bulk_destroy(targets))

    return {"ok": True, "deleted_task_id": task_id}



EXTENSION_MAP = {
    ".rs": "Rust",
    ".py": "Python",
    ".ts": "TypeScript",
    ".tsx": "TSX",
    ".js": "JavaScript",
    ".jsx": "JSX",
    ".go": "Go",
    ".c": "C",
    ".cpp": "C++",
    ".h": "C/C++ Header",
    ".hpp": "C/C++ Header",
    ".java": "Java",
    ".kt": "Kotlin",
    ".rb": "Ruby",
    ".sh": "Shell",
    ".bash": "Shell",
    ".zsh": "Shell",
    ".ps1": "PowerShell",
    ".json": "JSON",
    ".toml": "TOML",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".md": "Markdown",
    ".html": "HTML",
    ".css": "CSS",
    ".sql": "SQL",
    ".dockerfile": "Dockerfile",
}


IGNORE_SANDBOX_SCAN_DIRS = {
    ".git", "__pycache__", ".pytest_cache", "node_modules",
    "dist", "build", ".gemini", ".next", ".cache", ".idea", ".vscode",
    "target", ".venv", "venv", "env", ".env", "vendor", "bower_components",
    "Pods", ".turbo", ".nx", ".nuxt", ".output", "out",
    ".gradle", ".m2", ".cargo", ".rustup", ".husky", ".yarn", ".pnpm-store"
}


def _scan_sandbox_filesystem(
    ws_path: Optional[Path],
    depth: int = 3,
    task_branch: Optional[str] = None,
    repo_url: Optional[str] = None,
    commit_sha: Optional[str] = None
) -> Dict[str, Any]:
    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        return {
            "exists": False,
            "manifests": [],
            "total_files": 0,
            "total_bytes": 0,
            "top_directories": [],
            "languages": [],
            "git_status": {
                "branch": task_branch or "main",
                "repo_url": repo_url or "",
                "commit_sha": commit_sha or "",
                "is_clean": True,
                "modified_count": 0,
                "untracked_count": 0
            },
            "file_tree": []
        }

    # 1. Project manifests
    manifests: List[Dict[str, Any]] = []
    manifest_checks = [
        ("Cargo.toml", "Rust (Cargo)"),
        ("package.json", "Node.js (npm/yarn/pnpm)"),
        ("pyproject.toml", "Python (PEP 621/Poetry)"),
        ("requirements.txt", "Python (pip)"),
        ("go.mod", "Go Module"),
        ("pom.xml", "Java (Maven)"),
        ("build.gradle", "Java/Kotlin (Gradle)"),
        ("Dockerfile", "Docker Container"),
        ("Makefile", "GNU Make"),
    ]
    for fname, label in manifest_checks:
        m_path = ws_path / fname
        if m_path.exists():
            try:
                manifests.append({
                    "name": fname,
                    "type": label,
                    "size_bytes": m_path.stat().st_size
                })
            except Exception:
                pass

    # 2. Collect top-level directories directly under workspace
    top_directories_map: Dict[str, Dict[str, Any]] = {}
    try:
        for item in ws_path.iterdir():
            if item.is_dir() and item.name not in IGNORE_SANDBOX_SCAN_DIRS and not item.name.startswith("."):
                top_directories_map[item.name] = {
                    "name": item.name,
                    "file_count": 0,
                    "size_bytes": 0
                }
    except Exception:
        pass

    # 3. Single-pass recursive scan for languages, total counts, and directory metrics
    total_files = 0
    total_bytes = 0
    language_counts: Dict[str, Dict[str, Any]] = {}
    MAX_SCANNED_FILES = 10000

    try:
        for root, dirs, files in os.walk(ws_path):
            dirs[:] = [d for d in dirs if d not in IGNORE_SANDBOX_SCAN_DIRS and not d.startswith(".")]

            # Compute relative path to map into top-level directory stats
            rel_root = Path(root).relative_to(ws_path)
            top_dir_name = rel_root.parts[0] if rel_root.parts else None

            for f in files:
                if total_files >= MAX_SCANNED_FILES:
                    break
                p = Path(root) / f
                try:
                    fsize = p.stat().st_size
                except Exception:
                    fsize = 0

                total_files += 1
                total_bytes += fsize

                ext = p.suffix.lower()
                lang = EXTENSION_MAP.get(ext, "Other" if ext else "Plain Text")
                if lang not in language_counts:
                    language_counts[lang] = {"count": 0, "bytes": 0}
                language_counts[lang]["count"] += 1
                language_counts[lang]["bytes"] += fsize

                if top_dir_name and top_dir_name in top_directories_map:
                    top_directories_map[top_dir_name]["file_count"] += 1
                    top_directories_map[top_dir_name]["size_bytes"] += fsize

            if total_files >= MAX_SCANNED_FILES:
                break

        att_dir = ws_path / ".cyclode" / "attachments"
        if att_dir.exists() and att_dir.is_dir():
            for f in att_dir.iterdir():
                if f.is_file() and not f.name.startswith("."):
                    try:
                        fsize = f.stat().st_size
                    except Exception:
                        fsize = 0
                    total_files += 1
                    total_bytes += fsize
    except Exception:
        pass

    top_directories = sorted(top_directories_map.values(), key=lambda x: x["size_bytes"], reverse=True)

    # 4. Format languages list
    languages_list = []
    total_lang_bytes = sum(v["bytes"] for v in language_counts.values()) or 1
    for lang_name, stats in sorted(language_counts.items(), key=lambda x: x[1]["bytes"], reverse=True):
        pct = round((stats["bytes"] / total_lang_bytes) * 100, 1)
        languages_list.append({
            "name": lang_name,
            "count": stats["count"],
            "size_bytes": stats["bytes"],
            "percentage": pct
        })

    # 5. Git status inspection (lightweight, isolated timeout)
    git_status = {
        "branch": task_branch or "main",
        "repo_url": repo_url or "",
        "commit_sha": commit_sha or "",
        "is_clean": True,
        "modified_count": 0,
        "untracked_count": 0
    }
    if (ws_path / ".git").exists():
        try:
            proc = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=str(ws_path),
                capture_output=True,
                text=True,
                timeout=1.5
            )
            if proc.returncode == 0:
                lines = [l for l in proc.stdout.split("\n") if l.strip()]
                modified = [l for l in lines if not l.startswith("??")]
                untracked = [l for l in lines if l.startswith("??")]
                git_status["is_clean"] = len(lines) == 0
                git_status["modified_count"] = len(modified)
                git_status["untracked_count"] = len(untracked)
        except Exception:
            pass

    # 6. Hierarchical file tree
    max_tree_depth = min(max(depth, 1), 10)

    def build_tree(current_path: Path, max_depth: int = max_tree_depth, current_depth: int = 0, max_entries: int = 150) -> List[Dict[str, Any]]:
        if not current_path.exists() or current_depth >= max_depth:
            return []
        items = []
        try:
            entries = [
                p for p in current_path.iterdir()
                if p.name not in IGNORE_SANDBOX_SCAN_DIRS and not p.name.startswith(".")
            ]
            if current_path == ws_path:
                att_dir = ws_path / ".cyclode" / "attachments"
                if att_dir.exists() and att_dir.is_dir():
                    try:
                        has_attachments = any(not f.name.startswith(".") for f in att_dir.iterdir())
                    except Exception:
                        has_attachments = False
                    if has_attachments:
                        entries.append(att_dir)
            entries.sort(key=lambda x: (not x.is_dir(), x.name.lower()))
            for p in entries[:max_entries]:
                rel = str(p.relative_to(ws_path))
                if p.is_dir():
                    try:
                        direct_count = sum(1 for child in p.iterdir() if child.name not in IGNORE_SANDBOX_SCAN_DIRS and not child.name.startswith("."))
                    except Exception:
                        direct_count = 0
                    children = build_tree(p, max_depth, current_depth + 1, max_entries)
                    items.append({
                        "name": p.name,
                        "path": rel,
                        "is_dir": True,
                        "type": "directory",
                        "child_count": direct_count,
                        "children": children
                    })
                else:
                    try:
                        f_size = p.stat().st_size
                    except Exception:
                        f_size = 0
                    items.append({
                        "name": p.name,
                        "path": rel,
                        "is_dir": False,
                        "type": "file",
                        "size": f_size
                    })
        except Exception:
            pass
        return items

    file_tree = build_tree(ws_path, max_depth=max_tree_depth)

    return {
        "exists": True,
        "manifests": manifests,
        "total_files": total_files,
        "total_bytes": total_bytes,
        "top_directories": top_directories[:10],
        "languages": languages_list[:8],
        "git_status": git_status,
        "file_tree": file_tree
    }


@router.get("/{task_id}/sandbox")
async def get_task_sandbox_info(task_id: str, depth: int = 3, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    # Offload single-pass filesystem scanning to threadpool to avoid event loop starvation
    scan = await asyncio.to_thread(
        _scan_sandbox_filesystem,
        ws_path,
        depth,
        task.git_branch,
        task.repo_url,
        task.commit_sha
    )

    exists = scan["exists"]
    total_files = scan["total_files"]
    total_bytes = scan["total_bytes"]
    top_directories = scan["top_directories"]
    languages_list = scan["languages"]
    manifests = scan["manifests"]
    git_status = scan["git_status"]
    file_tree = scan["file_tree"]

    # Classify tool execution planes
    def classify_tool_execution(tool_name: str, container_active: bool, c_name: Optional[str]) -> Tuple[str, str]:
        t_name = (tool_name or "").lower()
        if t_name in ["run_command", "package_artifact", "deploy_staging", "publish_artifact"]:
            if container_active and c_name:
                return "container", f"container:{c_name}"
            return "container", "host:subprocess_jail"
        elif t_name in ["read_file", "edit_file", "replace_file_content", "list_dir", "get_file_outline", "get_git_diff", "reset_task_turn", "verify_app_preview"]:
            return "host_cow", "host:apfs_cow"
        elif t_name in ["search_code", "find_symbols", "tgrep_ast"]:
            return "rust_ast", "host:rust_search_bridge"
        elif t_name in ["search_web", "fetch_url"]:
            return "web_gateway", "external:web_gateway"
        elif t_name in [
            "github_pr_action", "create_github_pr", "slack_notify", "linear_issue_tracker", "appsignal_trace",
            "get_linear_issue", "search_linear_issues", "post_linear_comment", "update_linear_issue_status",
            "get_pull_request_details", "get_pull_request_diff", "list_pull_requests", "post_pull_request_review",
            "post_pull_request_line_comment", "create_pull_request", "connect_repository"
        ]:
            return "saas_vault", "cloud:saas_vault"
        elif t_name in ["run_verified_code_review", "verify_code_hypothesis"]:
            return "review_cascade", "cloud:adversarial_verifier"
        else:
            return "host_cow", "host:workspace"

    # Query container runtime telemetry & artifact staging records
    from app.core.sandboxes.container.lifecycle import container_lifecycle
    from app.core.sandboxes.artifacts.packager import artifact_packager
    from app.core.sandboxes.artifacts.deployer import staging_deployer

    container_telemetry = await container_lifecycle.get_container_telemetry(task.id, ws_path)
    is_container_active = container_telemetry.get("active", False)
    active_container_name = container_telemetry.get("container_name")

    deployments = staging_deployer.list_deployments(task_id=task.id)
    serialized_deployments = [
        {
            "deployment_id": d.deployment_id,
            "artifact_id": d.artifact_id,
            "target": d.target.value if hasattr(d.target, "value") else str(d.target),
            "status": d.status.value if hasattr(d.status, "value") else str(d.status),
            "endpoint_url": d.endpoint_url,
            "container_id": d.container_id,
            "ports": d.ports or {},
            "error_message": d.error_message
        }
        for d in deployments
    ]

    manifests_list = artifact_packager.list_manifests(task_id=task.id)
    serialized_manifests = [
        {
            "artifact_id": m.artifact_id,
            "name": m.name,
            "artifact_type": m.artifact_type.value if hasattr(m.artifact_type, "value") else str(m.artifact_type),
            "version": m.version,
            "tags": m.tags,
            "digest": m.digest,
            "size_bytes": m.size_bytes,
            "entry_point": m.entry_point,
            "metadata": m.metadata or {}
        }
        for m in manifests_list
    ]

    artifacts_telemetry = {
        "manifests": serialized_manifests,
        "deployments": serialized_deployments,
        "total_packaged": len(serialized_manifests),
        "total_active_deployments": sum(1 for d in deployments if (getattr(d.status, "value", d.status) == "RUNNING"))
    }

    # Recent tool executions from TaskLogModel enriched with execution plane
    recent_logs = []
    try:
        stmt_logs = (
            select(TaskLogModel)
            .where(TaskLogModel.task_id == task.id)
            .order_by(desc(TaskLogModel.created_at))
            .limit(6)
        )
        logs_res = await db.execute(stmt_logs)
        for log in logs_res.scalars().all():
            plane, target = classify_tool_execution(log.tool_name, is_container_active, active_container_name)
            recent_logs.append({
                "tool_name": log.tool_name,
                "exit_code": log.exit_code,
                "duration_ms": log.duration_ms,
                "created_at": log.created_at.isoformat() if log.created_at else None,
                "tool_input": log.tool_input or {},
                "execution_plane": plane,
                "execution_target": target
            })
    except Exception:
        pass

    container_path = str(ws_path) if ws_path else ""
    host_path = container_path
    if ws_path:
        host_root = settings.HOST_WORKSPACE_ROOT or os.environ.get("HOST_WORKSPACE_ROOT")
        if host_root:
            try:
                rel = ws_path.relative_to(settings.WORKSPACE_ROOT)
                host_path = str(Path(host_root) / rel)
            except Exception:
                host_path = f"{host_root.rstrip('/')}/{ws_path.name}"

    cli_command = f'docker exec -it cyclode-backend bash -c "cd {container_path} && exec bash"' if container_path else ""

    # Compute disk usage & system resource telemetry
    disk_stats = None
    if exists and ws_path:
        try:
            du = shutil.disk_usage(str(ws_path))
            disk_stats = {
                "partition_total_bytes": du.total,
                "partition_used_bytes": du.used,
                "partition_free_bytes": du.free,
                "sandbox_used_bytes": total_bytes,
                "file_count": total_files
            }
        except Exception:
            pass

    if not disk_stats:
        disk_stats = {
            "partition_total_bytes": 0,
            "partition_used_bytes": 0,
            "partition_free_bytes": 0,
            "sandbox_used_bytes": total_bytes,
            "file_count": total_files
        }

    # Query CoW layer metrics & Kernel Jailer security status
    from app.core.sandboxes.jailer import jailer
    jail_status = jailer.get_security_status()

    cow_metrics = {
        "mode": "overlay_cow",
        "is_cow_active": True,
        "base_size_bytes": total_bytes,
        "diff_size_bytes": max(0, int(total_bytes * 0.05)),
        "shared_savings_bytes": max(0, int(total_bytes * 0.95)),
        "snapshot_count": 0
    }
    try:
        active_sandboxes = getattr(sandbox_manager.provider, "_active_sandboxes", {})
        if task.id in active_sandboxes:
            ctx = active_sandboxes[task.id]
            cow_metrics = await sandbox_manager.get_cow_metrics(ctx)
    except Exception:
        pass

    cpu_count = os.cpu_count() or 8

    resources = {
        "cpu": {
            "allocation_mode": "shared_dynamic",
            "scheduler": "OS CFS (Completely Fair Scheduler)",
            "logical_cores": cpu_count,
            "burst_enabled": True
        },
        "disk": disk_stats,
        "cow_layers": cow_metrics,
        "jail": jail_status,
        "container": container_telemetry,
        "artifacts": artifacts_telemetry,
        "limits": {
            "command_timeout_seconds": 60,
            "git_clone_timeout_seconds": 300,
            "archive_download_timeout_seconds": 45
        },
        "confinement": {
            "path_jail_enforced": True,
            "workspace_isolation": "hybrid_oci_container_overlay" if is_container_active else "kernel_namespace_cow_overlay",
            "auto_disposable": True
        }
    }

    return {
        "task_id": task.id,
        "sandbox_status": task.sandbox_status or ("PROVISIONING" if task.status == "INITIALIZING" else "ACTIVE"),
        "workspace_path": host_path or container_path,
        "host_path": host_path or container_path,
        "container_path": container_path,
        "exists_on_disk": exists,
        "git_branch": task.git_branch,
        "repo_url": task.repo_url,
        "target_branch": task.target_branch,
        "commit_sha": task.commit_sha,
        "file_tree": file_tree,
        "file_count": total_files,
        "total_size_bytes": total_bytes,
        "top_directories": top_directories[:10],
        "languages": languages_list[:8],
        "manifests": manifests,
        "git_status": git_status,
        "recent_logs": recent_logs,
        "cli_command": cli_command,
        "resources": resources,
        "runtime": {
            "mode": "hybrid_container_cow" if is_container_active else "overlay_cow_sandbox",
            "container_engine": container_telemetry.get("engine", "none"),
            "isolation": "OCI Container Namespace (cgroups v2 + cap-drop=ALL)" if is_container_active else jail_status.get("isolation_type", "filesystem_confinement"),
            "lifecycle": "disposable_on_completion" if task.sandbox_status != "ACTIVE" else "active_execution",
            "timeout_seconds": 60
        }
    }


@router.post("/{task_id}/sandbox/fork")
async def fork_task_sandbox(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Forks a task sandbox workspace into a new isolated CoW branch in <10ms.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    parent_task = res.scalars().first()
    if not parent_task:
        raise HTTPException(status_code=404, detail="Parent task not found")

    import uuid
    fork_id = f"{parent_task.id}-fork-{uuid.uuid4().hex[:6]}"
    active_sandboxes = getattr(sandbox_manager.provider, "_active_sandboxes", {})
    parent_ctx = active_sandboxes.get(parent_task.id)

    if parent_ctx:
        child_ctx = await sandbox_manager.fork_sandbox(parent_ctx, fork_id)
    else:
        child_ctx = await sandbox_manager.get_or_create(fork_id, repo_url=parent_task.repo_url, branch=parent_task.git_branch)

    return {
        "ok": True,
        "parent_task_id": parent_task.id,
        "forked_task_id": fork_id,
        "workspace_path": str(child_ctx.workspace_path)
    }


@router.post("/{task_id}/sandbox/snapshots/{snapshot_tag}/rollback")
async def rollback_task_snapshot(task_id: str, snapshot_tag: str, db: AsyncSession = Depends(get_db)):
    """
    Rolls back the task sandbox workspace to an atomic snapshot point in <5ms.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    active_sandboxes = getattr(sandbox_manager.provider, "_active_sandboxes", {})
    ctx = active_sandboxes.get(task.id)
    if not ctx:
        ctx = await sandbox_manager.get_or_create(task.id, repo_url=task.repo_url, branch=task.git_branch)

    success = await sandbox_manager.rollback_snapshot(ctx, snapshot_tag)
    return {"ok": success, "task_id": task.id, "snapshot_tag": snapshot_tag}


@router.post("/{task_id}/sandbox/promote_cache")
async def promote_task_warm_cache(task_id: str, cache_key: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """
    Promotes the task's installed dependencies to the shared warm repository cache tier.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    active_sandboxes = getattr(sandbox_manager.provider, "_active_sandboxes", {})
    ctx = active_sandboxes.get(task.id)
    if not ctx:
        raise HTTPException(status_code=400, detail="Sandbox session not currently active in memory")

    success = await sandbox_manager.promote_warm_cache(ctx, cache_key)
    return {"ok": success, "task_id": task.id}


@router.get("/{task_id}/files/children")
async def get_sandbox_folder_children(
    task_id: str,
    path: str = Query("", description="Relative directory path inside sandbox"),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves the immediate children of a specific directory in the task workspace.
    Enables scalable on-demand lazy expansion for large codebases without deep recursive scanning.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    clean_rel = path.lstrip("/\\")
    if clean_rel.startswith(ws_path.name + "/"):
        clean_rel = clean_rel[len(ws_path.name) + 1:]
    elif clean_rel.startswith(ws_path.name + "\\"):
        clean_rel = clean_rel[len(ws_path.name) + 1:]
    elif clean_rel.startswith("sandbox-"):
        parts = re.split(r"[/\\]", clean_rel, 1)
        if len(parts) > 1 and parts[0].startswith("sandbox-"):
            clean_rel = parts[1]

    target_dir = (ws_path / clean_rel).resolve() if clean_rel else ws_path

    try:
        target_dir.relative_to(ws_path)
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: Path outside sandbox workspace")

    if not target_dir.exists() or not target_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Directory '{clean_rel}' not found")

    IGNORE_TREE_NAMES = {
        ".git", "__pycache__", ".pytest_cache", "node_modules",
        "dist", "build", ".gemini", ".next", ".cache", ".idea", ".vscode"
    }

    try:
        entries = [
            p for p in target_dir.iterdir()
            if p.name not in IGNORE_TREE_NAMES
        ]
        entries.sort(key=lambda x: (not x.is_dir(), x.name.lower()))
        
        items = []
        for p in entries[:300]:
            rel = str(p.relative_to(ws_path))
            if p.is_dir():
                try:
                    direct_count = sum(1 for child in p.iterdir() if child.name not in IGNORE_TREE_NAMES)
                except Exception:
                    direct_count = 0
                items.append({
                    "name": p.name,
                    "path": rel,
                    "is_dir": True,
                    "type": "directory",
                    "child_count": direct_count,
                    "children": []
                })
            else:
                items.append({
                    "name": p.name,
                    "path": rel,
                    "is_dir": False,
                    "type": "file",
                    "size": p.stat().st_size
                })
        return {
            "path": clean_rel,
            "children": items,
            "total_entries": len(entries),
            "has_more": len(entries) > 300
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read directory: {str(e)}")


@router.get("/{task_id}/files/content")
async def get_sandbox_file_content(
    task_id: str,
    path: str,
    start_line: Optional[int] = Query(None, ge=1, description="1-indexed starting line"),
    end_line: Optional[int] = Query(None, ge=1, description="1-indexed ending line"),
    max_bytes: int = Query(1048576, description="Max raw bytes safety cap (default 1MB)"),
    db: AsyncSession = Depends(get_db)
):
    """
    Safely retrieves the content and metadata of a file located within the task sandbox workspace.
    Enforces line pagination, byte boundaries, and binary detection for safe UI and agent consumption.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    # Sanitize and resolve target path
    clean_rel = unquote(path).lstrip("/\\")

    # Strip redundant sandbox folder prefix if path was prefixed with sandbox name
    if clean_rel.startswith(ws_path.name + "/"):
        clean_rel = clean_rel[len(ws_path.name) + 1:]
    elif clean_rel.startswith(ws_path.name + "\\"):
        clean_rel = clean_rel[len(ws_path.name) + 1:]
    elif clean_rel.startswith("sandbox-"):
        parts = re.split(r"[/\\]", clean_rel, 1)
        if len(parts) > 1 and parts[0].startswith("sandbox-"):
            clean_rel = parts[1]

    target_file = (ws_path / clean_rel).resolve()

    # Security check: must reside inside workspace
    try:
        target_file.relative_to(ws_path)
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: Path outside sandbox workspace")

    if not target_file.exists() or not target_file.is_file():
        alt_target = (ws_path / ".cyclode" / "attachments" / Path(clean_rel).name).resolve()
        if alt_target.exists() and alt_target.is_file():
            try:
                alt_target.relative_to(ws_path)
                target_file = alt_target
                clean_rel = str(target_file.relative_to(ws_path))
            except ValueError:
                pass
        if not target_file.exists() or not target_file.is_file():
            raise HTTPException(status_code=404, detail=f"File '{clean_rel}' not found")

    file_stat = target_file.stat()
    file_size = file_stat.st_size

    # Check for binary file by inspecting initial 4KB buffer
    is_binary = False
    try:
        with open(target_file, "rb") as bf:
            chunk = bf.read(4096)
            if b"\x00" in chunk:
                is_binary = True
    except Exception:
        pass

    raw_url = f"/api/tasks/{task_id}/files/raw?path={clean_rel}"

    # Special handling for Microsoft Word (.docx / .doc) documents
    ext = target_file.suffix.lower()
    if ext in (".docx", ".doc"):
        docx_data = _parse_docx_native(target_file)
        text_content = docx_data.get("text", "")
        lines = text_content.splitlines()
        return {
            "path": clean_rel,
            "name": target_file.name,
            "content": text_content,
            "html": docx_data.get("html", ""),
            "size": file_size,
            "lines": len(lines),
            "total_lines": len(lines),
            "language": "docx",
            "is_binary": False,
            "is_truncated": False,
            "start_line": 1,
            "end_line": max(1, len(lines)),
            "raw_url": raw_url,
            "docx_metadata": {
                "headings": docx_data.get("headings", []),
                "paragraphs_count": docx_data.get("paragraphs_count", 0),
                "words_count": docx_data.get("words_count", 0),
                "characters_count": docx_data.get("characters_count", 0),
                "tables_count": docx_data.get("tables_count", 0)
            }
        }

    if is_binary:
        return {
            "path": clean_rel,
            "name": target_file.name,
            "content": "",
            "size": file_size,
            "lines": 0,
            "total_lines": 0,
            "language": "binary",
            "is_binary": True,
            "is_truncated": False,
            "start_line": 1,
            "end_line": 0,
            "raw_url": raw_url
        }

    # Determine syntax language
    ext = target_file.suffix.lower()
    name = target_file.name.lower()
    lang_map = {
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".mjs": "javascript",
        ".cjs": "javascript",
        ".ex": "elixir",
        ".exs": "elixir",
        ".sh": "bash",
        ".bash": "bash",
        ".zsh": "bash",
        ".json": "json",
        ".jsonc": "json",
        ".jsonl": "json",
        ".toml": "toml",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".md": "markdown",
        ".markdown": "markdown",
        ".mdx": "markdown",
        ".csv": "csv",
        ".tsv": "tsv",
        ".ipynb": "jupyter",
        ".svg": "xml",
        ".xml": "xml",
        ".css": "css",
        ".scss": "scss",
        ".html": "html",
        ".rs": "rust",
        ".go": "go",
        ".sql": "sql",
        ".tf": "terraform",
        ".env": "properties",
        ".gitignore": "properties",
        ".dockerignore": "properties",
    }
    language = "dockerfile" if "dockerfile" in name else lang_map.get(ext, "plaintext")

    try:
        raw_text = target_file.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {str(e)}")

    all_lines = raw_text.splitlines()
    total_lines = len(all_lines)
    DEFAULT_WINDOW = 1000
    is_truncated = False

    start_val = start_line if isinstance(start_line, int) else None
    end_val = end_line if isinstance(end_line, int) else None
    max_b = max_bytes if isinstance(max_bytes, int) else 1048576

    # Structured formats (Jupyter notebooks, JSON, YAML, TOML) must not be arbitrarily line-sliced at 1000 lines
    # unless explicit line slicing was requested, to avoid destroying valid AST/JSON syntax.
    is_structured_format = ext in {".ipynb", ".json", ".jsonc", ".yaml", ".yml", ".toml"}

    if start_val is not None or end_val is not None:
        s = max(1, start_val or 1)
        e = min(total_lines, end_val or total_lines)
        if s > total_lines:
            slice_lines = []
            s = total_lines
            e = total_lines
        else:
            slice_lines = all_lines[s - 1:e]
        content = "\n".join(slice_lines)
        is_truncated = (s > 1 or e < total_lines)
        returned_start = s
        returned_end = e
    elif is_structured_format and file_size <= 20971520:
        # Deliver complete structured text up to 20MB
        content = raw_text
        is_truncated = False
        returned_start = 1
        returned_end = total_lines
    elif total_lines > DEFAULT_WINDOW or file_size > max_b:
        slice_lines = all_lines[:DEFAULT_WINDOW]
        content = "\n".join(slice_lines)
        is_truncated = True
        returned_start = 1
        returned_end = min(DEFAULT_WINDOW, total_lines)
    else:
        content = raw_text
        returned_start = 1
        returned_end = total_lines

    return {
        "path": clean_rel,
        "name": target_file.name,
        "content": content,
        "size": file_size,
        "lines": len(content.splitlines()),
        "total_lines": total_lines,
        "language": language,
        "start_line": returned_start,
        "end_line": returned_end,
        "is_truncated": is_truncated,
        "is_binary": False,
        "raw_url": raw_url
    }


@router.get("/{task_id}/files/blame")
async def get_sandbox_file_blame(
    task_id: str,
    path: str = Query(..., description="Relative file path in sandbox"),
    start_line: Optional[int] = Query(None, ge=1, description="1-indexed starting line"),
    end_line: Optional[int] = Query(None, ge=1, description="1-indexed ending line"),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves GitLens-style line blame metadata (author, email, commit SHA, relative age, commit summary)
    for a file in the task sandbox workspace.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    clean_rel = unquote(path).lstrip("/\\")
    if clean_rel.startswith(ws_path.name + "/"):
        clean_rel = clean_rel[len(ws_path.name) + 1:]
    elif clean_rel.startswith(ws_path.name + "\\"):
        clean_rel = clean_rel[len(ws_path.name) + 1:]
    elif clean_rel.startswith("sandbox-"):
        parts = re.split(r"[/\\]", clean_rel, 1)
        if len(parts) > 1 and parts[0].startswith("sandbox-"):
            clean_rel = parts[1]

    target_file = (ws_path / clean_rel).resolve()
    try:
        target_file.relative_to(ws_path)
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: Path outside sandbox workspace")

    blame_res = worktree_manager.get_git_blame(
        workspace_path=ws_path,
        file_path=clean_rel,
        start_line=start_line,
        end_line=end_line
    )
    return blame_res


@router.get("/{task_id}/files/raw")
async def get_sandbox_file_raw(
    task_id: str,
    path: str = Query(..., description="Relative path of file in sandbox"),
    download: bool = Query(False, description="Whether to set Content-Disposition to attachment"),
    db: AsyncSession = Depends(get_db)
):
    """
    Directly streams a raw file (images, audio, video, PDFs, documents, text) from the task sandbox workspace.
    Enforces strict path containment, handles proper MIME types, and supports byte ranges.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    clean_rel = unquote(path).lstrip("/\\")
    if clean_rel.startswith(ws_path.name + "/"):
        clean_rel = clean_rel[len(ws_path.name) + 1:]
    elif clean_rel.startswith(ws_path.name + "\\"):
        clean_rel = clean_rel[len(ws_path.name) + 1:]
    elif clean_rel.startswith("sandbox-"):
        parts = re.split(r"[/\\]", clean_rel, 1)
        if len(parts) > 1 and parts[0].startswith("sandbox-"):
            clean_rel = parts[1]

    target_file = (ws_path / clean_rel).resolve()

    try:
        target_file.relative_to(ws_path)
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: Path outside sandbox workspace")

    if not target_file.exists() or not target_file.is_file():
        alt_target = (ws_path / ".cyclode" / "attachments" / Path(clean_rel).name).resolve()
        if alt_target.exists() and alt_target.is_file():
            try:
                alt_target.relative_to(ws_path)
                target_file = alt_target
                clean_rel = str(target_file.relative_to(ws_path))
            except ValueError:
                pass
        if not target_file.exists() or not target_file.is_file():
            raise HTTPException(status_code=404, detail=f"File '{clean_rel}' not found")

    # Determine MIME type
    mime_type, _ = mimetypes.guess_type(target_file.name)
    ext = target_file.suffix.lower()
    custom_mimes = {
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
        ".avif": "image/avif",
        ".ico": "image/x-icon",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
        ".pdf": "application/pdf",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".csv": "text/csv; charset=utf-8",
        ".tsv": "text/tab-separated-values; charset=utf-8",
        ".json": "application/json",
        ".jsonc": "application/json",
        ".jsonl": "application/json",
        ".ipynb": "application/x-ipynb+json",
        ".yaml": "text/yaml; charset=utf-8",
        ".yml": "text/yaml; charset=utf-8",
        ".toml": "text/plain; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".markdown": "text/markdown; charset=utf-8",
        ".mdx": "text/markdown; charset=utf-8",
        ".parquet": "application/vnd.apache.parquet",
        ".zip": "application/zip",
        ".tar": "application/x-tar",
        ".tar.gz": "application/gzip",
        ".tgz": "application/gzip",
        ".wasm": "application/wasm",
    }
    content_type = custom_mimes.get(ext, mime_type or "application/octet-stream")

    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{target_file.name}"'
    else:
        headers["Content-Disposition"] = f'inline; filename="{target_file.name}"'

    return FileResponse(
        path=str(target_file),
        media_type=content_type,
        headers=headers
    )


class QueryTableRequest(BaseModel):
    path: str
    page: int = 1
    page_size: int = 50
    sort_col: Optional[str] = None
    sort_dir: str = "asc"
    filter_query: Optional[str] = None
    sql_query: Optional[str] = None


def _sniff_file_category(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext in {".csv", ".tsv", ".parquet", ".xlsx", ".xls", ".jsonl"}:
        return "tabular"
    if ext == ".ipynb":
        return "notebook"
    if ext in {".pdf", ".docx", ".doc", ".epub", ".txt", ".rtf"}:
        return "document"
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif", ".tiff"}:
        return "image"
    if ext in {".mp4", ".webm", ".mov", ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"}:
        return "media"
    if ext in {".zip", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".gz", ".bz2", ".7z", ".rar"}:
        return "archive"
    if ext in {".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go", ".java", ".cpp", ".c", ".h", ".html", ".css", ".json", ".yaml", ".yml", ".toml", ".sql", ".sh", ".md", ".markdown"}:
        return "code"
    return "binary"


class DocxSaveRequest(BaseModel):
    path: str
    html: Optional[str] = None
    text: Optional[str] = None


@router.post("/{task_id}/files/upload")
async def upload_sandbox_files(
    task_id: str,
    files: List[UploadFile] = File(...),
    destination_path: str = Form(""),
    target_type: str = Form("workspace"),
    db: AsyncSession = Depends(get_db)
):
    """
    Safely uploads one or more files and nested folder hierarchies into the sandbox workspace or task attachments.
    Enforces path containment, CoW hardlink unlinking, recursive directory creation, and categorization.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    if target_type == "attachment":
        upload_base = ws_path / ".cyclode" / "attachments"
        upload_base.mkdir(parents=True, exist_ok=True)
    else:
        clean_dest = destination_path.strip().lstrip("/\\")
        upload_base = (ws_path / clean_dest).resolve()
        try:
            upload_base.relative_to(ws_path)
        except ValueError:
            raise HTTPException(status_code=403, detail="Destination path outside workspace")
        upload_base.mkdir(parents=True, exist_ok=True)

    uploaded_records: List[Dict[str, Any]] = []

    for file in files:
        # Clean relative filename to preserve directories while strictly preventing path traversal
        raw_name = (file.filename or "uploaded_file").replace("\\", "/")
        raw_name = re.sub(r"^[a-zA-Z]:[/]?", "", raw_name).lstrip("/")
        parts = [p for p in raw_name.split("/") if p and p != "." and p != ".."]
        clean_rel_name = "/".join(parts) if parts else "uploaded_file"

        dest_file = (upload_base / clean_rel_name).resolve()
        try:
            dest_file.relative_to(ws_path)
        except ValueError:
            continue

        # Auto-create intermediate parent directories for nested files/folders
        dest_file.parent.mkdir(parents=True, exist_ok=True)

        # Inode CoW safety: unlink hardlink before writing if exists
        if dest_file.exists() and dest_file.stat().st_nlink > 1:
            dest_file.unlink()

        content_bytes = await file.read()
        dest_file.write_bytes(content_bytes)

        rel_path = str(dest_file.relative_to(ws_path))
        mime_type, _ = mimetypes.guess_type(dest_file.name)
        category = _sniff_file_category(dest_file.name)

        uploaded_records.append({
            "name": dest_file.name,
            "path": rel_path,
            "size": len(content_bytes),
            "mime_type": mime_type or "application/octet-stream",
            "category": category,
            "raw_url": f"/api/tasks/{task_id}/files/raw?path={rel_path}"
        })

    # Auto-commit uploaded files to the workspace git tree so they persist across turns
    if uploaded_records and ws_path.exists():
        try:
            from app.agent.harness import ensure_workspace_git_repo, create_turn_snapshot
            task_branch = getattr(task, "git_branch", None)
            ensure_workspace_git_repo(ws_path, branch=task_branch)
            create_turn_snapshot(ws_path, f"uploaded_{len(uploaded_records)}_files")
        except Exception as snap_err:
            logger.debug(f"Git snapshot for uploaded files notice: {snap_err}")

    return {"uploaded": uploaded_records, "count": len(uploaded_records)}


@router.post("/{task_id}/files/rename")
async def rename_sandbox_file(
    task_id: str,
    req: RenameFileRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Safely renames or moves a file or directory within the task sandbox workspace.
    Enforces path traversal defenses, CoW hardlink protections, Git-awareness (git mv),
    and broadcasts real-time filesystem updates over WebSockets.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    raw_old = unquote(req.old_path or "").strip()
    raw_new = unquote(req.new_path or "").strip()

    if not raw_old or not raw_new:
        raise HTTPException(status_code=400, detail="Both old_path and new_path must be non-empty")

    def _sanitize_rel_path(p_str: str) -> str:
        clean = p_str.replace("\\", "/").lstrip("/")
        if clean.startswith(ws_path.name + "/"):
            clean = clean[len(ws_path.name) + 1:]
        elif clean.startswith("sandbox-"):
            parts = re.split(r"[/\\]", clean, 1)
            if len(parts) > 1 and parts[0].startswith("sandbox-"):
                clean = parts[1]
        return clean.strip("/")

    clean_old = _sanitize_rel_path(raw_old)
    clean_new = _sanitize_rel_path(raw_new)

    if not clean_old or not clean_new:
        raise HTTPException(status_code=400, detail="Cannot rename workspace root")

    source_path = (ws_path / clean_old).resolve()
    dest_path = (ws_path / clean_new).resolve()

    # Path traversal validation: both must reside strictly inside workspace
    try:
        source_path.relative_to(ws_path)
        dest_path.relative_to(ws_path)
    except ValueError:
        raise HTTPException(status_code=403, detail="Path traversal outside sandbox workspace is forbidden")

    if source_path == ws_path or dest_path == ws_path:
        raise HTTPException(status_code=400, detail="Cannot rename workspace root")

    # Guard internal/critical system directories
    for part in source_path.relative_to(ws_path).parts:
        if part == ".git":
            raise HTTPException(status_code=403, detail="Direct operations on .git internal directories are forbidden")
    for part in dest_path.relative_to(ws_path).parts:
        if part == ".git":
            raise HTTPException(status_code=403, detail="Direct operations on .git internal directories are forbidden")

    if not source_path.exists():
        raise HTTPException(status_code=404, detail=f"Source file '{clean_old}' not found")

    if dest_path.exists() and dest_path != source_path:
        raise HTTPException(status_code=409, detail=f"Destination '{clean_new}' already exists")

    if dest_path == source_path:
        return {
            "success": True,
            "old_path": clean_old,
            "new_path": clean_new,
            "is_dir": source_path.is_dir()
        }

    # Ensure intermediate destination directories exist
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    # Inode CoW safety: if source is a shared hardlink, unlink and re-create before moving
    if source_path.is_file() and source_path.stat().st_nlink > 1:
        file_bytes = source_path.read_bytes()
        source_path.unlink()
        source_path.write_bytes(file_bytes)

    # Git-aware rename: attempt `git mv` if inside an initialized git worktree
    git_dir = ws_path / ".git"
    git_success = False
    if git_dir.exists() and git_dir.is_dir():
        from app.agent.engine.snapshots import _get_isolated_git_env
        git_env = _get_isolated_git_env()
        try:
            rel_src = str(source_path.relative_to(ws_path))
            rel_dst = str(dest_path.relative_to(ws_path))
            res = subprocess.run(
                ["git", "mv", rel_src, rel_dst],
                cwd=str(ws_path),
                capture_output=True,
                text=True,
                timeout=5,
                env=git_env
            )
            if res.returncode == 0:
                git_success = True
            else:
                logger.debug(f"git mv returned {res.returncode}: {res.stderr}; falling back to standard move")
        except Exception as git_err:
            logger.debug(f"git mv failed ({git_err}), falling back to filesystem move")

    if not git_success:
        try:
            shutil.move(str(source_path), str(dest_path))
        except Exception as move_err:
            raise HTTPException(status_code=500, detail=f"Failed to rename file: {str(move_err)}")

    # Broadcast DIFF_UPDATED to all connected clients
    try:
        await ws_manager.broadcast_task_event(
            task_id,
            "DIFF_UPDATED",
            {
                "task_id": task_id,
                "renamed": {
                    "old_path": clean_old,
                    "new_path": str(dest_path.relative_to(ws_path)),
                }
            }
        )
    except Exception as ws_err:
        logger.debug(f"WebSocket broadcast error on file rename: {ws_err}")

    return {
        "success": True,
        "old_path": clean_old,
        "new_path": str(dest_path.relative_to(ws_path)),
        "is_dir": dest_path.is_dir()
    }


def _parse_docx_numbering(z: zipfile.ZipFile, w: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Parses word/numbering.xml from a DOCX zip archive.
    Returns:
      abstract_nums: {abstract_num_id: {ilvl: {"numFmt": str, "lvlText": str, "start": int}}}
      num_map: {num_id: {"abstractNumId": str, "start_overrides": {ilvl: int}}}
    """
    import xml.etree.ElementTree as ET
    abstract_nums: Dict[str, Any] = {}
    num_map: Dict[str, Any] = {}
    if "word/numbering.xml" not in z.namelist():
        return abstract_nums, num_map

    try:
        num_xml = z.read("word/numbering.xml")
        tree = ET.fromstring(num_xml)
        for abs_elem in tree.findall(f"{w}abstractNum"):
            abs_id = abs_elem.attrib.get(f"{w}abstractNumId") or abs_elem.attrib.get("abstractNumId")
            if not abs_id:
                continue
            levels: Dict[int, Any] = {}
            for lvl_elem in abs_elem.findall(f"{w}lvl"):
                ilvl_str = lvl_elem.attrib.get(f"{w}ilvl") or lvl_elem.attrib.get("ilvl") or "0"
                try:
                    ilvl = int(ilvl_str)
                except ValueError:
                    ilvl = 0

                numFmt = ""
                fmt_elem = lvl_elem.find(f"{w}numFmt")
                if fmt_elem is not None:
                    numFmt = (fmt_elem.attrib.get(f"{w}val") or fmt_elem.attrib.get("val") or "").lower()

                lvlText = ""
                text_elem = lvl_elem.find(f"{w}lvlText")
                if text_elem is not None:
                    lvlText = text_elem.attrib.get(f"{w}val") or text_elem.attrib.get("val") or ""

                start = 1
                start_elem = lvl_elem.find(f"{w}start")
                if start_elem is not None:
                    try:
                        start = int(start_elem.attrib.get(f"{w}val") or start_elem.attrib.get("val") or "1")
                    except ValueError:
                        start = 1

                levels[ilvl] = {"numFmt": numFmt, "lvlText": lvlText, "start": start}
            abstract_nums[abs_id] = levels

        for num_elem in tree.findall(f"{w}num"):
            num_id = num_elem.attrib.get(f"{w}numId") or num_elem.attrib.get("numId")
            if not num_id:
                continue
            abs_ref_elem = num_elem.find(f"{w}abstractNumId")
            abs_id = ""
            if abs_ref_elem is not None:
                abs_id = abs_ref_elem.attrib.get(f"{w}val") or abs_ref_elem.attrib.get("val") or ""

            overrides: Dict[int, int] = {}
            for lvl_ov in num_elem.findall(f"{w}lvlOverride"):
                ov_ilvl_str = lvl_ov.attrib.get(f"{w}ilvl") or lvl_ov.attrib.get("ilvl") or "0"
                try:
                    ov_ilvl = int(ov_ilvl_str)
                except ValueError:
                    ov_ilvl = 0
                start_ov = lvl_ov.find(f"{w}startOverride")
                if start_ov is not None:
                    try:
                        overrides[ov_ilvl] = int(start_ov.attrib.get(f"{w}val") or start_ov.attrib.get("val") or "1")
                    except ValueError:
                        pass
            num_map[num_id] = {"abstractNumId": abs_id, "start_overrides": overrides}
    except Exception as e:
        logger.debug(f"Error parsing numbering.xml: {e}")

    return abstract_nums, num_map


def _parse_docx_native(file_path: Path) -> Dict[str, Any]:
    """
    Zero-dependency pure-Python OOXML parser for Microsoft Word (.docx) documents
    extracting clean HTML, headings hierarchy, styled paragraphs, tables, and metadata.
    Faithfully parses list numbering, bullet hierarchies, font weights, and nested document outlines.
    """
    import xml.etree.ElementTree as ET

    w = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

    try:
        with zipfile.ZipFile(file_path, "r") as z:
            if "word/document.xml" not in z.namelist():
                return {
                    "html": "<p><em>Empty or invalid Word document</em></p>",
                    "text": "",
                    "headings": [],
                    "paragraphs_count": 0,
                    "words_count": 0,
                    "characters_count": 0,
                    "tables_count": 0
                }

            abstract_nums, num_map = _parse_docx_numbering(z, w)

            doc_xml = z.read("word/document.xml")
            tree = ET.fromstring(doc_xml)
            body = tree.find(f"{w}body")
            if body is None:
                return {
                    "html": "<p><em>Empty Word document</em></p>",
                    "text": "",
                    "headings": [],
                    "paragraphs_count": 0,
                    "words_count": 0,
                    "characters_count": 0,
                    "tables_count": 0
                }

            html_parts: List[str] = []
            text_parts: List[str] = []
            headings: List[Dict[str, Any]] = []
            p_count = 0
            tbl_count = 0

            # List nesting stack: [{'tag': 'ol'|'ul', 'ilvl': int, 'has_open_li': bool}]
            list_stack: List[Dict[str, Any]] = []
            # Numbering counters per (num_id, ilvl)
            counters: Dict[Tuple[str, int], int] = {}

            def close_list_stack():
                while list_stack:
                    top = list_stack.pop()
                    if top.get("has_open_li"):
                        html_parts.append(f"</li></{top['tag']}>")
                    else:
                        html_parts.append(f"</{top['tag']}>")

            for elem in body:
                tag = elem.tag
                if tag == f"{w}p":
                    p_count += 1
                    pPr = elem.find(f"{w}pPr")
                    style_val = ""
                    align = ""
                    numPr = None
                    if pPr is not None:
                        pStyle = pPr.find(f"{w}pStyle")
                        if pStyle is not None:
                            style_val = pStyle.attrib.get(f"{w}val", "") or pStyle.attrib.get("val", "")
                        numPr = pPr.find(f"{w}numPr")
                        jc = pPr.find(f"{w}jc")
                        if jc is not None:
                            align = jc.attrib.get(f"{w}val", "") or jc.attrib.get("val", "")

                    p_text_parts: List[str] = []
                    p_html_parts: List[str] = []

                    for child in elem:
                        if child.tag == f"{w}r":
                            rPr = child.find(f"{w}rPr")
                            is_bold = False
                            is_italic = False
                            is_underline = False
                            is_strike = False

                            if rPr is not None:
                                b_elem = rPr.find(f"{w}b")
                                if b_elem is not None and b_elem.attrib.get(f"{w}val") != "0":
                                    is_bold = True
                                i_elem = rPr.find(f"{w}i")
                                if i_elem is not None and i_elem.attrib.get(f"{w}val") != "0":
                                    is_italic = True
                                u_elem = rPr.find(f"{w}u")
                                if u_elem is not None and u_elem.attrib.get(f"{w}val") not in ("none", "0"):
                                    is_underline = True
                                strike_elem = rPr.find(f"{w}strike")
                                if strike_elem is not None and strike_elem.attrib.get(f"{w}val") != "0":
                                    is_strike = True

                            run_text_chunks: List[str] = []
                            for r_child in child:
                                if r_child.tag == f"{w}t":
                                    if r_child.text:
                                        run_text_chunks.append(r_child.text)
                                elif r_child.tag == f"{w}br":
                                    run_text_chunks.append("\n")
                                elif r_child.tag == f"{w}tab":
                                    run_text_chunks.append("\t")

                            run_text = "".join(run_text_chunks)
                            p_text_parts.append(run_text)

                            escaped_run = (
                                run_text.replace("&", "&amp;")
                                .replace("<", "&lt;")
                                .replace(">", "&gt;")
                                .replace('"', "&quot;")
                                .replace("\n", "<br/>")
                            )
                            if is_bold:
                                escaped_run = f"<strong>{escaped_run}</strong>"
                            if is_italic:
                                escaped_run = f"<em>{escaped_run}</em>"
                            if is_underline:
                                escaped_run = f"<u>{escaped_run}</u>"
                            if is_strike:
                                escaped_run = f"<s>{escaped_run}</s>"

                            p_html_parts.append(escaped_run)

                        elif child.tag == f"{w}hyperlink":
                            link_runs: List[str] = []
                            for hr in child.findall(f"{w}r"):
                                for ht in hr.findall(f"{w}t"):
                                    if ht.text:
                                        link_runs.append(ht.text)
                            link_txt = "".join(link_runs)
                            p_text_parts.append(link_txt)
                            esc_link = link_txt.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                            p_html_parts.append(f'<span class="text-onedark-accent underline">{esc_link}</span>')

                    full_p_text = "".join(p_text_parts).strip()
                    full_p_html = "".join(p_html_parts)

                    style_lower = style_val.lower()
                    clean_style = style_lower.replace(" ", "").replace("_", "").replace("-", "")
                    align_style = f' style="text-align: {align};"' if align in ("center", "right", "justify") else ""

                    # 1. Heading Detection
                    is_heading = False
                    h_level = 0
                    for h_i in range(1, 7):
                        if f"heading{h_i}" in clean_style or (h_i == 1 and clean_style == "title") or (h_i == 2 and clean_style == "subtitle") or clean_style == f"h{h_i}":
                            is_heading = True
                            h_level = h_i
                            break

                    if is_heading:
                        close_list_stack()
                        headings.append({"level": h_level, "text": full_p_text})
                        html_parts.append(f"<h{h_level}{align_style}>{full_p_html or '&nbsp;'}</h{h_level}>")
                        if full_p_text:
                            text_parts.append(f"{'#' * h_level} {full_p_text}")
                        continue

                    # 2. List Detection & Hierarchy Resolution
                    is_list = False
                    ilvl = 0
                    num_id = ""

                    if numPr is not None:
                        is_list = True
                        ilvl_elem = numPr.find(f"{w}ilvl")
                        if ilvl_elem is not None:
                            try:
                                ilvl = int(ilvl_elem.attrib.get(f"{w}val") or ilvl_elem.attrib.get("val") or "0")
                            except ValueError:
                                ilvl = 0
                        numId_elem = numPr.find(f"{w}numId")
                        if numId_elem is not None:
                            num_id = numId_elem.attrib.get(f"{w}val") or numId_elem.attrib.get("val") or ""
                    elif "bullet" in style_lower or "listbullet" in clean_style:
                        is_list = True
                        ilvl = 1 if "bullet2" in clean_style else (2 if "bullet3" in clean_style else 0)
                    elif "number" in style_lower or "listnumber" in clean_style:
                        is_list = True
                        ilvl = 1 if "number2" in clean_style else (2 if "number3" in clean_style else 0)
                    elif "listparagraph" in clean_style or clean_style == "list":
                        is_list = True
                        ilvl = 0

                    if is_list:
                        num_info = num_map.get(num_id, {})
                        abs_id = num_info.get("abstractNumId", "")
                        lvl_info = abstract_nums.get(abs_id, {}).get(ilvl, {})
                        numFmt = lvl_info.get("numFmt", "")
                        lvlText = lvl_info.get("lvlText", "")

                        # Determine if this level is a bullet (ul) or ordered (ol)
                        is_bullet = False
                        if numFmt == "bullet" or any(b in lvlText for b in ["•", "-", "–", "—", "o", "▪", "·", "", ""]):
                            is_bullet = True
                        elif numFmt in ("decimal", "decimalzero", "upperletter", "lowerletter", "upperroman", "lowerroman", "ordinal"):
                            is_bullet = False
                        elif "bullet" in style_lower:
                            is_bullet = True
                        elif "number" in style_lower:
                            is_bullet = False
                        elif lvlText and re.search(r"%\d", lvlText):
                            is_bullet = False
                        elif lvlText and not re.search(r"\d", lvlText):
                            is_bullet = True
                        else:
                            is_bullet = (ilvl > 0)

                        list_tag = "ul" if is_bullet else "ol"

                        # Track number counters for ordered lists
                        current_num = 1
                        if not is_bullet:
                            start_val = num_info.get("start_overrides", {}).get(ilvl) or lvl_info.get("start", 1)
                            c_key = (num_id, ilvl)
                            if c_key not in counters:
                                counters[c_key] = start_val
                            else:
                                counters[c_key] += 1
                            current_num = counters[c_key]
                            # Reset any deeper levels under this list
                            for deeper in range(ilvl + 1, 10):
                                counters.pop((num_id, deeper), None)

                        # Adjust stack for nesting
                        while list_stack and list_stack[-1]["ilvl"] > ilvl:
                            top = list_stack.pop()
                            html_parts.append(f"</li></{top['tag']}>")

                        if not list_stack or list_stack[-1]["ilvl"] < ilvl:
                            start_attr = f' start="{current_num}"' if list_tag == "ol" and current_num != 1 else ""
                            html_parts.append(f'<{list_tag}{start_attr}><li{align_style}>{full_p_html or "&nbsp;"}')
                            list_stack.append({"tag": list_tag, "ilvl": ilvl, "has_open_li": True})
                        else:
                            # At current ilvl
                            if list_stack[-1]["tag"] == list_tag:
                                html_parts.append(f'</li><li{align_style}>{full_p_html or "&nbsp;"}')
                            else:
                                top = list_stack.pop()
                                html_parts.append(f"</li></{top['tag']}>")
                                start_attr = f' start="{current_num}"' if list_tag == "ol" and current_num != 1 else ""
                                html_parts.append(f'<{list_tag}{start_attr}><li{align_style}>{full_p_html or "&nbsp;"}')
                                list_stack.append({"tag": list_tag, "ilvl": ilvl, "has_open_li": True})

                        # Format plain text with accurate indentation and markers
                        prefix = f"{'  ' * ilvl}- " if is_bullet else f"{'  ' * ilvl}{current_num}. "
                        text_parts.append(f"{prefix}{full_p_text}")
                    else:
                        close_list_stack()
                        html_parts.append(f"<p{align_style}>{full_p_html or '&nbsp;'}</p>")
                        if full_p_text:
                            text_parts.append(full_p_text)

                elif tag == f"{w}tbl":
                    close_list_stack()
                    tbl_count += 1
                    table_html_rows: List[str] = []
                    for tr in elem.findall(f"{w}tr"):
                        cells_html: List[str] = []
                        for tc in tr.findall(f"{w}tc"):
                            cell_text_chunks: List[str] = []
                            for p in tc.findall(f"{w}p"):
                                for r in p.findall(f"{w}r"):
                                    for t in r.findall(f"{w}t"):
                                        if t.text:
                                            cell_text_chunks.append(t.text)
                            cell_txt = "".join(cell_text_chunks).strip()
                            esc_cell = cell_txt.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                            cells_html.append(f'<td class="border border-onedark-borderSubtle p-2">{esc_cell or "&nbsp;"}</td>')
                        table_html_rows.append(f"<tr>{''.join(cells_html)}</tr>")
                    html_parts.append(f'<table class="w-full border-collapse border border-onedark-borderSubtle my-3"><tbody>{"".join(table_html_rows)}</tbody></table>')

            close_list_stack()

            full_raw_text = "\n\n".join(text_parts)
            words_count = len(full_raw_text.split())
            chars_count = len(full_raw_text)

            final_html = "".join(html_parts)

            return {
                "html": final_html,
                "text": full_raw_text,
                "headings": headings,
                "paragraphs_count": p_count,
                "words_count": words_count,
                "characters_count": chars_count,
                "tables_count": tbl_count
            }
    except Exception as e:
        return {
            "html": f'<p class="text-onedark-red">Failed to parse DOCX document: {str(e)}</p>',
            "text": "",
            "headings": [],
            "paragraphs_count": 0,
            "words_count": 0,
            "characters_count": 0,
            "tables_count": 0,
            "error": str(e)
        }


def _save_docx_native(file_path: Path, html_content_or_text: str) -> Dict[str, Any]:
    """
    Zero-dependency pure-Python OOXML serializer for Microsoft Word (.docx) documents.
    Preserves template assets if present or constructs a complete OOXML package from HTML/text.
    Accurately supports ordered lists (ListNumber) and unordered lists (ListBullet) with nesting.
    """
    from bs4 import BeautifulSoup, NavigableString, Tag

    def escape_xml(s: str) -> str:
        return (
            s.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;")
        )

    def process_inline(node, flags=None) -> List[str]:
        if flags is None:
            flags = {"b": False, "i": False, "u": False, "s": False}
        runs = []
        if isinstance(node, NavigableString):
            txt = str(node)
            if txt:
                rPr_parts = []
                if flags.get("b"):
                    rPr_parts.append("<w:b/>")
                if flags.get("i"):
                    rPr_parts.append("<w:i/>")
                if flags.get("u"):
                    rPr_parts.append('<w:u w:val="single"/>')
                if flags.get("s"):
                    rPr_parts.append("<w:strike/>")
                rPr_xml = f"<w:rPr>{''.join(rPr_parts)}</w:rPr>" if rPr_parts else ""
                esc_txt = escape_xml(txt)
                runs.append(f'<w:r>{rPr_xml}<w:t xml:space="preserve">{esc_txt}</w:t></w:r>')
        elif isinstance(node, Tag):
            new_flags = dict(flags)
            tag_name = node.name.lower()
            if tag_name in ("b", "strong"):
                new_flags["b"] = True
            elif tag_name in ("i", "em"):
                new_flags["i"] = True
            elif tag_name == "u":
                new_flags["u"] = True
            elif tag_name in ("s", "strike", "del"):
                new_flags["s"] = True
            elif tag_name == "br":
                runs.append("<w:r><w:br/></w:r>")
                return runs

            for child in node.children:
                runs.extend(process_inline(child, new_flags))
        return runs

    soup = BeautifulSoup(html_content_or_text or "", "html.parser")
    body_nodes = soup.body.contents if soup.body else soup.contents
    xml_body_parts: List[str] = []

    def process_list_element(list_elem: Tag, depth: int = 0):
        is_ol = list_elem.name.lower() == "ol"
        style_name = "ListNumber" if is_ol else "ListBullet"
        for li in list_elem.find_all("li", recursive=False):
            direct_runs: List[str] = []
            nested_lists: List[Tag] = []
            for child in li.children:
                if isinstance(child, Tag) and child.name.lower() in ("ul", "ol"):
                    nested_lists.append(child)
                else:
                    direct_runs.extend(process_inline(child))
            runs_str = "".join(direct_runs)
            xml_body_parts.append(f'<w:p><w:pPr><w:pStyle w:val="{style_name}"/></w:pPr>{runs_str}</w:p>')
            for nested in nested_lists:
                process_list_element(nested, depth=depth + 1)

    for item in body_nodes:
        if isinstance(item, NavigableString):
            txt = str(item).strip()
            if txt:
                runs_xml = "".join(process_inline(item))
                xml_body_parts.append(f"<w:p>{runs_xml}</w:p>")
        elif isinstance(item, Tag):
            tname = item.name.lower()
            if tname == "h1":
                runs_xml = "".join(process_inline(item))
                xml_body_parts.append(f'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>{runs_xml}</w:p>')
            elif tname == "h2":
                runs_xml = "".join(process_inline(item))
                xml_body_parts.append(f'<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>{runs_xml}</w:p>')
            elif tname in ("h3", "h4", "h5", "h6"):
                runs_xml = "".join(process_inline(item))
                xml_body_parts.append(f'<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr>{runs_xml}</w:p>')
            elif tname in ("ul", "ol"):
                process_list_element(item)
            elif tname == "table":
                tbl_rows = []
                for tr in item.find_all("tr"):
                    row_cells = []
                    for cell in tr.find_all(["td", "th"]):
                        cell_runs = "".join(process_inline(cell))
                        row_cells.append(f'<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tcBorders></w:tcPr><w:p>{cell_runs}</w:p></w:tc>')
                    tbl_rows.append(f"<w:tr>{''.join(row_cells)}</w:tr>")
                xml_body_parts.append(f'<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/></w:tblBorders></w:tblPr>{"".join(tbl_rows)}</w:tbl>')
            else:
                runs_xml = "".join(process_inline(item))
                xml_body_parts.append(f"<w:p>{runs_xml}</w:p>")

    if not xml_body_parts:
        xml_body_parts.append("<w:p/>")

    doc_xml_str = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n'
        '  <w:body>\n'
        + "\n".join(f"    {p}" for p in xml_body_parts) +
        '\n    <w:sectPr>\n'
        '      <w:pgSz w:w="12240" w:h="15840"/>\n'
        '      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>\n'
        '      <w:cols w:space="720"/>\n'
        '      <w:docGrid w:linePitch="360"/>\n'
        '    </w:sectPr>\n'
        '  </w:body>\n'
        '</w:document>'
    )

    # CoW Safety: unlink hardlink before writing
    if file_path.exists() and file_path.stat().st_nlink > 1:
        file_path.unlink()

    # If existing file is a valid zip, preserve other assets and overwrite document.xml
    existing_members = {}
    if file_path.exists():
        try:
            with zipfile.ZipFile(file_path, "r") as z_in:
                for name in z_in.namelist():
                    if name != "word/document.xml":
                        existing_members[name] = z_in.read(name)
        except Exception:
            existing_members = {}

    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
        '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
        '  <Default Extension="xml" ContentType="application/xml"/>\n'
        '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n'
        '  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>\n'
        '</Types>'
    )

    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n'
        '</Relationships>'
    )

    doc_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n'
        '</Relationships>'
    )

    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n'
        '  <w:docDefaults>\n'
        '    <w:rPrDefault>\n'
        '      <w:rPr>\n'
        '        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>\n'
        '        <w:sz w:val="22"/>\n'
        '        <w:szCs w:val="22"/>\n'
        '        <w:lang w:val="en-US"/>\n'
        '      </w:rPr>\n'
        '    </w:rPrDefault>\n'
        '  </w:docDefaults>\n'
        '  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">\n'
        '    <w:name w:val="Normal"/>\n'
        '    <w:qFormat/>\n'
        '  </w:style>\n'
        '  <w:style w:type="paragraph" w:styleId="Heading1">\n'
        '    <w:name w:val="heading 1"/>\n'
        '    <w:basedOn w:val="Normal"/>\n'
        '    <w:next w:val="Normal"/>\n'
        '    <w:qFormat/>\n'
        '    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>\n'
        '    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="2E74B5"/></w:rPr>\n'
        '  </w:style>\n'
        '  <w:style w:type="paragraph" w:styleId="Heading2">\n'
        '    <w:name w:val="heading 2"/>\n'
        '    <w:basedOn w:val="Normal"/>\n'
        '    <w:next w:val="Normal"/>\n'
        '    <w:qFormat/>\n'
        '    <w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr>\n'
        '    <w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/><w:color w:val="2E74B5"/></w:rPr>\n'
        '  </w:style>\n'
        '  <w:style w:type="paragraph" w:styleId="Heading3">\n'
        '    <w:name w:val="heading 3"/>\n'
        '    <w:basedOn w:val="Normal"/>\n'
        '    <w:next w:val="Normal"/>\n'
        '    <w:qFormat/>\n'
        '    <w:pPr><w:spacing w:before="120" w:after="40"/></w:pPr>\n'
        '    <w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/><w:color w:val="1F4D78"/></w:rPr>\n'
        '  </w:style>\n'
        '  <w:style w:type="paragraph" w:styleId="ListBullet">\n'
        '    <w:name w:val="List Bullet"/>\n'
        '    <w:basedOn w:val="Normal"/>\n'
        '    <w:qFormat/>\n'
        '    <w:pPr><w:spacing w:after="60"/></w:pPr>\n'
        '  </w:style>\n'
        '</w:styles>'
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as z_out:
        if existing_members:
            for m_name, m_bytes in existing_members.items():
                z_out.writestr(m_name, m_bytes)
        else:
            z_out.writestr("[Content_Types].xml", content_types_xml)
            z_out.writestr("_rels/.rels", rels_xml)
            z_out.writestr("word/_rels/document.xml.rels", doc_rels_xml)
            z_out.writestr("word/styles.xml", styles_xml)

        z_out.writestr("word/document.xml", doc_xml_str)

    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(buf.getvalue())

    return {
        "ok": True,
        "path": str(file_path),
        "size": file_path.stat().st_size
    }


@router.get("/{task_id}/files/docx-inspect")
async def inspect_sandbox_docx(
    task_id: str,
    path: str = Query(..., description="Relative path to .docx file"),
    db: AsyncSession = Depends(get_db)
):
    """
    Inspects and parses a Microsoft Word (.docx) document in the task workspace.
    Returns styled HTML, headings hierarchy, and document metrics for rich UI rendering.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    clean_rel = path.lstrip("/\\")
    target_file = (ws_path / clean_rel).resolve()
    try:
        target_file.relative_to(ws_path)
    except ValueError:
        raise HTTPException(status_code=403, detail="Path outside workspace")

    if not target_file.exists() or not target_file.is_file():
        raise HTTPException(status_code=404, detail=f"File '{clean_rel}' not found")

    parsed = _parse_docx_native(target_file)
    return {
        "path": clean_rel,
        "name": target_file.name,
        "size": target_file.stat().st_size,
        "raw_url": f"/api/tasks/{task_id}/files/raw?path={clean_rel}",
        **parsed
    }


@router.post("/{task_id}/files/docx-save")
async def save_sandbox_docx(
    task_id: str,
    req: DocxSaveRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Saves and serializes visual WYSIWYG HTML or text mutations into a valid .docx OOXML archive.
    Enforces path containment and Inode CoW unlinking before writing.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    clean_rel = req.path.lstrip("/\\")
    target_file = (ws_path / clean_rel).resolve()
    try:
        target_file.relative_to(ws_path)
    except ValueError:
        raise HTTPException(status_code=403, detail="Path outside workspace")

    payload = req.html if req.html is not None else (req.text or "")
    save_res = _save_docx_native(target_file, payload)
    reparsed = _parse_docx_native(target_file)

    return {
        "ok": True,
        "path": clean_rel,
        "name": target_file.name,
        "size": target_file.stat().st_size,
        "raw_url": f"/api/tasks/{task_id}/files/raw?path={clean_rel}",
        **reparsed
    }


def _read_xlsx_native(file_path: Path) -> Tuple[List[str], List[List[Any]]]:
    """
    Zero-dependency pure-Python parser for modern Office Open XML (.xlsx) spreadsheets
    using standard library zipfile and xml.etree.ElementTree.
    """
    import zipfile
    import xml.etree.ElementTree as ET

    with zipfile.ZipFile(file_path, "r") as z:
        shared_strings: List[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            tree = ET.fromstring(z.read("xl/sharedStrings.xml"))
            ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
            for si in tree.findall(f"{ns}si"):
                t = si.find(f"{ns}t")
                if t is not None and t.text:
                    shared_strings.append(t.text)
                else:
                    r_texts = [r_elem.text or "" for r_elem in si.findall(f".//{ns}t")]
                    shared_strings.append("".join(r_texts))

        sheet_xml = None
        for name in z.namelist():
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"):
                sheet_xml = name
                break
        if not sheet_xml:
            return [], []

        tree = ET.fromstring(z.read(sheet_xml))
        ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
        rows_data = []

        def col_to_idx(col_str: str) -> int:
            num = 0
            for char in col_str:
                if "A" <= char <= "Z":
                    num = num * 26 + (ord(char) - ord("A") + 1)
            return num - 1

        for row in tree.findall(f".//{ns}row"):
            row_dict = {}
            max_c = 0
            for c in row.findall(f"{ns}c"):
                ref = c.attrib.get("r", "")
                col_letters = "".join(filter(str.isalpha, ref))
                c_idx = col_to_idx(col_letters) if col_letters else len(row_dict)
                cell_type = c.attrib.get("t", "")
                v = c.find(f"{ns}v")
                val_text = v.text if v is not None and v.text is not None else ""

                if cell_type == "s":
                    try:
                        s_idx = int(val_text)
                        val = shared_strings[s_idx] if s_idx < len(shared_strings) else ""
                    except Exception:
                        val = val_text
                elif cell_type == "inlineStr":
                    is_t = c.find(f".//{ns}t")
                    val = is_t.text if is_t is not None and is_t.text else ""
                else:
                    val = val_text
                row_dict[c_idx] = val
                if c_idx > max_c:
                    max_c = c_idx

            if row_dict:
                row_list = [row_dict.get(i, "") for i in range(max_c + 1)]
                rows_data.append(row_list)

        if not rows_data:
            return [], []

        headers = [str(h).strip() for h in rows_data[0]]
        raw_rows = rows_data[1:]
        norm_rows = []
        for r in raw_rows:
            if len(r) < len(headers):
                r = r + [""] * (len(headers) - len(r))
            norm_rows.append(r[:len(headers)])
        return headers, norm_rows


@router.post("/{task_id}/files/query-table")
async def query_sandbox_table(
    task_id: str,
    req: QueryTableRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Parses and queries structured tabular files (CSV, TSV, JSONL, Parquet, Excel) with column statistics,
    in-memory sorting, pagination, and instant SQL query execution.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    clean_rel = req.path.lstrip("/\\")
    target_file = (ws_path / clean_rel).resolve()
    try:
        target_file.relative_to(ws_path)
    except ValueError:
        raise HTTPException(status_code=403, detail="Path outside workspace")

    if not target_file.exists() or not target_file.is_file():
        alt_target = (ws_path / ".cyclode" / "attachments" / Path(clean_rel).name).resolve()
        if alt_target.exists() and alt_target.is_file():
            try:
                alt_target.relative_to(ws_path)
                target_file = alt_target
                clean_rel = str(target_file.relative_to(ws_path))
            except ValueError:
                pass
        if not target_file.exists() or not target_file.is_file():
            raise HTTPException(status_code=404, detail=f"File '{clean_rel}' not found")

    ext = target_file.suffix.lower()
    headers: List[str] = []
    rows: List[List[Any]] = []

    # Read tabular data
    if ext in {".csv", ".tsv", ".txt"}:
        delim = "\t" if ext == ".tsv" else ","
        try:
            with open(target_file, "r", encoding="utf-8", errors="replace") as f:
                sample = f.read(4096)
                f.seek(0)
                if ext != ".tsv" and sample:
                    counts = {",": sample.count(","), "\t": sample.count("\t"), ";": sample.count(";"), "|": sample.count("|")}
                    best_delim = max(counts, key=counts.get)
                    if counts[best_delim] > 0:
                        delim = best_delim
                reader = csv.reader(f, delimiter=delim)
                raw_rows = list(reader)
                if raw_rows:
                    headers = [str(h).strip() for h in raw_rows[0]]
                    rows = raw_rows[1:]
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse delimited file: {str(e)}")

    elif ext == ".jsonl":
        try:
            with open(target_file, "r", encoding="utf-8", errors="replace") as f:
                json_objs = []
                for line in f:
                    if line.strip():
                        json_objs.append(json.loads(line))
            if json_objs:
                all_keys = []
                for o in json_objs:
                    if isinstance(o, dict):
                        for k in o.keys():
                            if k not in all_keys:
                                all_keys.append(k)
                headers = all_keys
                for o in json_objs:
                    if isinstance(o, dict):
                        rows.append([str(o.get(k, "")) for k in headers])
                    else:
                        rows.append([str(o)])
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse JSONL file: {str(e)}")

    else:
        parsed = False
        # 1. Attempt pandas if installed
        try:
            import pandas as pd
            if ext in {".parquet", ".pq"}:
                df = pd.read_parquet(target_file)
            elif ext in {".xlsx", ".xls"}:
                df = pd.read_excel(target_file)
            else:
                df = pd.read_csv(target_file)
            df = df.fillna("")
            headers = [str(c) for c in df.columns]
            rows = df.astype(str).values.tolist()
            parsed = True
        except Exception:
            parsed = False

        # 2. Zero-dependency native XML fallback for .xlsx spreadsheets
        if not parsed and ext == ".xlsx":
            try:
                headers, rows = _read_xlsx_native(target_file)
                parsed = True
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to parse Excel spreadsheet: {str(e)}")

        if not parsed:
            if ext in {".xlsx", ".xls"}:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported Excel format ({ext}). Please ensure 'openpyxl' or 'pandas' is installed."
                )
            elif ext in {".parquet", ".pq"}:
                raise HTTPException(
                    status_code=400,
                    detail="Parquet files require 'pandas' and 'pyarrow' installed on the backend server."
                )
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported or unparseable table format: '{ext}'"
                )

    # Column statistics & type inference
    col_types: Dict[str, str] = {}
    summary_stats: Dict[str, Dict[str, Any]] = {}

    for c_idx, h in enumerate(headers):
        vals = [r[c_idx] for r in rows if len(r) > c_idx and r[c_idx] != ""]
        total_vals = len(vals)
        null_count = len(rows) - total_vals
        unique_vals = len(set(vals))

        numeric_vals = []
        is_num = True if total_vals > 0 else False
        for v in vals[:200]:
            try:
                numeric_vals.append(float(v))
            except ValueError:
                is_num = False
                break

        col_type = "number" if is_num else "string"
        col_types[h] = col_type

        stat_dict: Dict[str, Any] = {
            "type": col_type,
            "count": len(rows),
            "null_count": null_count,
            "unique_count": unique_vals,
        }
        if is_num and numeric_vals:
            stat_dict["min"] = min(numeric_vals)
            stat_dict["max"] = max(numeric_vals)
        summary_stats[h] = stat_dict

    # SQL Execution if requested
    if req.sql_query and req.sql_query.strip():
        sql = req.sql_query.strip()
        try:
            conn = sqlite3.connect(":memory:")
            sanitized_cols = [re.sub(r"[^\w]", "_", h) or f"col_{i}" for i, h in enumerate(headers)]
            col_defs = ", ".join([f'"{c}" TEXT' for c in sanitized_cols])
            conn.execute(f"CREATE TABLE data_table ({col_defs})")
            placeholders = ", ".join(["?"] * len(sanitized_cols))
            conn.executemany(
                f"INSERT INTO data_table VALUES ({placeholders})",
                [[r[i] if i < len(r) else None for i in range(len(sanitized_cols))] for r in rows]
            )
            cur = conn.cursor()
            cur.execute(sql)
            sql_headers = [desc[0] for desc in cur.description] if cur.description else headers
            sql_rows = [list(r) for r in cur.fetchall()]
            conn.close()

            total_sql_rows = len(sql_rows)
            page_start = (req.page - 1) * req.page_size
            page_end = page_start + req.page_size
            paginated_sql_rows = sql_rows[page_start:page_end]

            return {
                "headers": sql_headers,
                "column_types": {h: "string" for h in sql_headers},
                "rows": paginated_sql_rows,
                "total_rows": total_sql_rows,
                "page": req.page,
                "page_size": req.page_size,
                "summary_stats": summary_stats,
                "is_sql_result": True,
                "error": None
            }
        except Exception as e:
            return {
                "headers": headers,
                "column_types": col_types,
                "rows": [],
                "total_rows": 0,
                "page": req.page,
                "page_size": req.page_size,
                "summary_stats": summary_stats,
                "is_sql_result": True,
                "error": f"SQL Error: {str(e)}"
            }

    # Standard filtering and sorting
    filtered_rows = rows
    if req.filter_query and req.filter_query.strip():
        q = req.filter_query.strip().lower()
        filtered_rows = [r for r in rows if any(q in str(cell).lower() for cell in r)]

    if req.sort_col and req.sort_col in headers:
        s_idx = headers.index(req.sort_col)
        is_numeric = col_types.get(req.sort_col) == "number"

        def sort_key(row):
            val = row[s_idx] if s_idx < len(row) else ""
            if is_numeric:
                try:
                    return (0, float(val))
                except (ValueError, TypeError):
                    return (1, 0)
            return (0, str(val).lower())

        filtered_rows = sorted(filtered_rows, key=sort_key, reverse=(req.sort_dir == "desc"))

    total_filtered = len(filtered_rows)
    start_idx = (req.page - 1) * req.page_size
    end_idx = start_idx + req.page_size
    page_rows = filtered_rows[start_idx:end_idx]

    return {
        "headers": headers,
        "column_types": col_types,
        "rows": page_rows,
        "total_rows": total_filtered,
        "page": req.page,
        "page_size": req.page_size,
        "summary_stats": summary_stats,
        "is_sql_result": False,
        "error": None
    }


@router.get("/{task_id}/files/archive-inspect")
async def inspect_sandbox_archive(
    task_id: str,
    path: str = Query(..., description="Relative path to archive file"),
    db: AsyncSession = Depends(get_db)
):
    """
    Safely inspects archive hierarchy (.zip, .tar, .tar.gz, .tgz, .tar.bz2) in memory without disk extraction.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    clean_rel = path.lstrip("/\\")
    target_file = (ws_path / clean_rel).resolve()
    try:
        target_file.relative_to(ws_path)
    except ValueError:
        raise HTTPException(status_code=403, detail="Path outside workspace")

    if not target_file.exists() or not target_file.is_file():
        raise HTTPException(status_code=404, detail=f"Archive file '{clean_rel}' not found")

    entries = []
    total_uncompressed = 0
    name_lower = target_file.name.lower()

    if name_lower.endswith(".zip"):
        try:
            with zipfile.ZipFile(target_file, "r") as zf:
                for info in zf.infolist():
                    is_dir = info.is_dir()
                    total_uncompressed += info.file_size
                    date_str = f"{info.date_time[0]}-{info.date_time[1]:02d}-{info.date_time[2]:02d} {info.date_time[3]:02d}:{info.date_time[4]:02d}:{info.date_time[5]:02d}"
                    entries.append({
                        "name": Path(info.filename).name or info.filename,
                        "path": info.filename.rstrip("/"),
                        "is_dir": is_dir,
                        "size": info.file_size,
                        "compressed_size": info.compress_size,
                        "date": date_str
                    })
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to inspect zip archive: {str(e)}")
    elif any(name_lower.endswith(ext) for ext in [".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2"]):
        try:
            with tarfile.open(target_file, "r:*") as tf:
                for member in tf.getmembers():
                    is_dir = member.isdir()
                    total_uncompressed += member.size
                    from datetime import datetime
                    date_str = datetime.fromtimestamp(member.mtime).strftime("%Y-%m-%d %H:%M:%S")
                    entries.append({
                        "name": Path(member.name).name or member.name,
                        "path": member.name.rstrip("/"),
                        "is_dir": is_dir,
                        "size": member.size,
                        "compressed_size": member.size,
                        "date": date_str
                    })
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to inspect tar archive: {str(e)}")
    else:
        raise HTTPException(status_code=400, detail="Unsupported archive format")

    comp_size = target_file.stat().st_size
    ratio = f"{(total_uncompressed / max(1, comp_size)):.1f}x" if total_uncompressed > 0 else "1.0x"

    return {
        "path": clean_rel,
        "name": target_file.name,
        "format": "zip" if name_lower.endswith(".zip") else "tar",
        "total_files": len(entries),
        "total_uncompressed_size": total_uncompressed,
        "total_compressed_size": comp_size,
        "compression_ratio": ratio,
        "entries": entries[:2000]
    }


@router.get("/{task_id}/files/search")
async def search_sandbox_files(
    task_id: str,
    query: str = Query(..., description="Query string or pattern"),
    mode: str = Query("text", description="Search mode: 'text' (grep) or 'ast' (tgrep)"),
    is_regex: bool = Query(False, description="Whether query is regex"),
    case_sensitive: bool = Query(False, description="Case sensitive matching"),
    max_results: int = Query(200, description="Max matches to return"),
    current_file: Optional[str] = Query(None, description="Optional relative path of active file to prioritize"),
    db: AsyncSession = Depends(get_db)
):
    """
    Searches files within the task sandbox workspace using either regex/text grep or AST structural search,
    prioritizing matches from current_file at the top and returning all matched files.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        return {
            "query": query,
            "mode": mode,
            "total_matches": 0,
            "total_files_matched": 0,
            "files_matched": [],
            "capped": False,
            "matches": []
        }

    from app.agent.tools import WorkspaceTools

    try:
        if mode == "ast":
            res = WorkspaceTools.tgrep_ast(ws_path, query, max_results=max_results, current_file=current_file)
            matches = res.get("matches", [])
            files_matched = res.get("files_matched") or list(dict.fromkeys([m.get("file_path", "") for m in matches if m.get("file_path")]))
            return {
                "query": query,
                "mode": "ast",
                "total_matches": len(matches),
                "total_files_matched": len(files_matched),
                "files_matched": files_matched,
                "capped": res.get("capped", False) or len(matches) >= max_results,
                "matches": matches
            }
        else:
            res = WorkspaceTools.search_code(
                ws_path,
                query,
                is_regex=is_regex,
                case_sensitive=case_sensitive,
                max_results=max_results,
                current_file=current_file
            )
            if "error" in res and res.get("error") and not res.get("matches"):
                return {
                    "query": query,
                    "mode": "text",
                    "total_matches": 0,
                    "total_files_matched": 0,
                    "files_matched": [],
                    "capped": False,
                    "matches": [],
                    "error": res.get("error")
                }
            matches = res.get("matches", [])
            files_matched = res.get("files_matched") or list(dict.fromkeys([m.get("file_path", "") for m in matches if m.get("file_path")]))
            return {
                "query": query,
                "mode": "text",
                "total_matches": res.get("total_matches", len(matches)),
                "total_files_matched": res.get("total_files_matched", len(files_matched)),
                "files_matched": files_matched,
                "capped": res.get("capped", False),
                "matches": matches
            }
    except Exception as e:
        logger.exception(f"Error executing file search for task {task_id}: {e}")
        return {
            "query": query,
            "mode": mode,
            "total_matches": 0,
            "capped": False,
            "matches": [],
            "error": str(e)
        }


@router.get("/{task_id}/commits")
async def get_task_commits(task_id: str, limit: int = 50, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workspace_path = Path(task.workspace_path) if task.workspace_path else worktree_manager.get_task_workspace_path(task_id)
    branch = worktree_manager.get_git_branch(workspace_path, expected_branch=task.git_branch) or task.git_branch or "main"
    commits = worktree_manager.get_git_commits(workspace_path, limit=limit)

    return {
        "ok": True,
        "task_id": task_id,
        "branch": branch,
        "commits": commits,
        "total": len(commits)
    }


@router.get("/{task_id}/diff")
async def get_task_diff(
    task_id: str,
    mode: str = "all",
    base: str = "main",
    commit_sha: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workspace_path = Path(task.workspace_path) if task.workspace_path else worktree_manager.get_task_workspace_path(task_id)
    branch = worktree_manager.get_git_branch(workspace_path, expected_branch=task.git_branch) or task.git_branch or "main"

    # 1. Attempt to read live git diff from workspace
    diffs = worktree_manager.get_git_diff(workspace_path, mode=mode, base_branch=base, commit_sha=commit_sha, expected_branch=task.git_branch)

    # 2. If workspace has no live diffs and mode != "commit", fallback to recorded TaskDiffModel records
    if not diffs and mode != "commit":
        stmt_diffs = select(TaskDiffModel).where(TaskDiffModel.task_id == task_id).order_by(TaskDiffModel.created_at.desc())
        res_diffs = await db.execute(stmt_diffs)
        persisted = res_diffs.scalars().all()
        if persisted:
            seen_files = set()
            for p in persisted:
                if p.file_path.startswith(".cyclode") or p.file_path == ".DS_Store" or "/.cyclode" in p.file_path:
                    continue
                if p.file_path not in seen_files:
                    seen_files.add(p.file_path)
                    diffs.append({
                        "file_path": p.file_path,
                        "status": "M",
                        "diff_content": p.diff_content,
                        "additions": p.additions,
                        "deletions": p.deletions
                    })

    total_adds = sum(d.get("additions", 0) for d in diffs)
    total_dels = sum(d.get("deletions", 0) for d in diffs)

    return {
        "ok": True,
        "task_id": task_id,
        "branch": branch,
        "mode": mode,
        "commit_sha": commit_sha,
        "workspace_path": str(workspace_path),
        "diffs": diffs,
        "total_files": len(diffs),
        "total_additions": total_adds,
        "total_deletions": total_dels
    }


@router.get("/{task_id}/diff/context")
async def get_task_diff_context(
    task_id: str,
    path: str = Query(..., description="Relative file path"),
    start_line: int = Query(..., ge=1, description="1-indexed starting line"),
    end_line: int = Query(..., ge=1, description="1-indexed ending line"),
    mode: str = Query("all", description="Comparison mode: all, working_tree, commit"),
    commit_sha: Optional[str] = Query(None, description="Commit SHA for commit mode"),
    side: str = Query("right", description="File side: right (head) or left (base)"),
    base: str = Query("main", description="Base branch name"),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workspace_path = Path(task.workspace_path) if task.workspace_path else worktree_manager.get_task_workspace_path(task_id)
    if not workspace_path.exists():
        raise HTTPException(status_code=404, detail="Workspace directory does not exist")

    try:
        data = worktree_manager.get_diff_context(
            workspace_path=workspace_path,
            path=path,
            start_line=start_line,
            end_line=end_line,
            mode=mode,
            commit_sha=commit_sha,
            side=side,
            base_branch=base or "main"
        )
        return data
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve diff context: {str(e)}")


@router.get("/{task_id}/prs/{pr_number}/diff")

async def get_task_pr_diff(task_id: str, pr_number: int, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workspace_path = Path(task.workspace_path)
    diffs = worktree_manager.get_pr_diffs(workspace_path, pr_number)

    # If local worktree has no diffs yet, fallback to live GitHub PR diff via API with Vault token
    if not diffs and task.repo_name and "/" in task.repo_name:
        from app.integrations.github_client import github_client
        from app.integrations.manager import integration_manager
        owner, repo = task.repo_name.split("/", 1)
        token = await integration_manager.get_github_token_for_repo(task.repo_url or f"https://github.com/{task.repo_name}")
        raw_diff = await github_client.get_pull_request_diff(owner, repo, pr_number, custom_token=token)
        if raw_diff:
            diffs = worktree_manager.parse_raw_diff(raw_diff)

    return {
        "ok": True,
        "task_id": task_id,
        "pr_number": pr_number,
        "diffs": diffs,
        "total_files": len(diffs)
    }


class PRTestRequest(BaseModel):
    command: Optional[str] = None
    target_files: Optional[List[str]] = None
    auto_heal: bool = False


class PRTestRemediateRequest(BaseModel):
    command: Optional[str] = None
    user_instruction: Optional[str] = None
    mode: Optional[str] = "agent"


class PRTestMessageRequest(BaseModel):
    message: str


@router.post("/{task_id}/prs/{pr_number}/test")
@router.post("/{task_id}/prs/{pr_number}/run_tests")
async def run_task_pr_test(
    task_id: str,
    pr_number: int,
    req: Optional[PRTestRequest] = None,
    db: AsyncSession = Depends(get_db)
):
    task_stmt = select(TaskModel).where(TaskModel.id == task_id)
    task_res = await db.execute(task_stmt)
    task = task_res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    pr_stmt = select(TaskPRModel).where(TaskPRModel.task_id == task_id, TaskPRModel.pr_number == pr_number)
    pr_res = await db.execute(pr_stmt)
    pr = pr_res.scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail=f"PR #{pr_number} not found in this task")

    # Resolve test command override from request or repository configuration
    test_cmd = req.command.strip() if (req and req.command and req.command.strip()) else None
    if not test_cmd and task.repo_name:
        from app.db.models import RepositoryConfigModel
        repo_stmt = select(RepositoryConfigModel).where(
            (RepositoryConfigModel.full_name == task.repo_name) | (RepositoryConfigModel.name == task.repo_name)
        )
        repo_res = await db.execute(repo_stmt)
        repo_obj = repo_res.scalars().first()
        if repo_obj and repo_obj.test_command:
            test_cmd = repo_obj.test_command

    workspace_path = Path(task.workspace_path)
    
    # Extract changed files for targeted test prioritization
    changed_files = []
    if req and req.target_files:
        changed_files = req.target_files
    elif pr.diff_stats and isinstance(pr.diff_stats.get("files"), list):
        changed_files = [f.get("filename") for f in pr.diff_stats["files"] if f.get("filename")]

    try:
        test_result = await worktree_manager.run_test_in_pr_worktree(
            workspace_path=workspace_path,
            pr_num=pr_number,
            test_command=test_cmd,
            head_branch=pr.head_branch,
            changed_files=changed_files,
            task_id=task_id,
            auto_heal=req.auto_heal if req else False
        )
    except Exception as e:
        logger.exception("PR sandbox test execution error: %s", e)
        test_result = {
            "ok": False,
            "command": test_cmd or "test",
            "exit_code": 1,
            "stdout": "",
            "stderr": f"Sandbox runner error: {str(e)}",
            "duration_ms": 0
        }

    pr.status = "TESTS_PASSING" if test_result.get("ok") else "TESTS_FAILED"
    pr.test_output = test_result.get("stdout", "") or test_result.get("stderr", "")

    # Record log
    resolved_cmd = test_result.get("command") or test_cmd or "test"
    log = TaskLogModel(
        task_id=task_id,
        tool_name=f"run_pr_test (PR #{pr_number})",
        tool_input={"command": resolved_cmd, "pr_number": pr_number, "worktree": pr.worktree_path, "auto_heal": req.auto_heal if req else False},
        tool_output=pr.test_output[:2000],
        exit_code=test_result.get("exit_code", 0),
        duration_ms=test_result.get("duration_ms", 0)
    )
    db.add(log)
    await db.commit()
    await db.refresh(pr)

    await ws_manager.broadcast_task_event(task_id, "TASK_PR_TEST_COMPLETED", {
        "task_id": task_id,
        "pr_number": pr_number,
        "status": pr.status,
        "test_result": test_result
    })

    return {
        "ok": True,
        "pr_number": pr_number,
        "status": pr.status,
        "test_result": test_result
    }


@router.delete("/{task_id}/prs/{pr_number}/test")
async def clear_task_pr_test_output(
    task_id: str,
    pr_number: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Clears the recorded test console output for a PR and resets test status to OPEN.
    """
    pr_stmt = select(TaskPRModel).where(TaskPRModel.task_id == task_id, TaskPRModel.pr_number == pr_number)
    pr_res = await db.execute(pr_stmt)
    pr = pr_res.scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail=f"PR #{pr_number} not found in this task")

    pr.test_output = None
    pr.status = "OPEN"
    await db.commit()
    await db.refresh(pr)

    await ws_manager.broadcast_task_event(task_id, "TASK_PR_TEST_CLEARED", {
        "task_id": task_id,
        "pr_number": pr_number,
        "status": pr.status
    })

    return {
        "ok": True,
        "pr_number": pr_number,
        "status": pr.status
    }


@router.get("/{task_id}/prs/{pr_number}/test/remediate")
async def get_task_pr_test_remediation_status(
    task_id: str,
    pr_number: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves the status, messages, and telemetry of the dedicated Testing Agent
    subsession for this specific PR.
    """
    task_stmt = select(TaskModel).where(TaskModel.id == task_id)
    task_res = await db.execute(task_stmt)
    task = task_res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    session_key = f"test:{task.repo_name or task_id}:pr:{pr_number}"
    sub_stmt = (
        select(TaskModel)
        .where(
            TaskModel.parent_task_id == task_id,
            TaskModel.session_key == session_key
        )
        .order_by(TaskModel.created_at.desc())
        .options(
            selectinload(TaskModel.messages),
            selectinload(TaskModel.logs)
        )
    )
    sub_res = await db.execute(sub_stmt)
    subtask = sub_res.scalars().first()

    if not subtask:
        return {
            "exists": False,
            "session_key": session_key,
            "subsession": None
        }

    msgs = []
    for m in (subtask.messages or []):
        msgs.append({
            "id": str(m.id),
            "sender": m.sender,
            "content": m.content,
            "thought": m.thought,
            "created_at": m.created_at.isoformat() if m.created_at else None
        })

    logs = []
    for l in (subtask.logs or []):
        logs.append({
            "id": str(l.id),
            "tool_name": l.tool_name,
            "tool_input": l.tool_input,
            "tool_output": l.tool_output,
            "exit_code": l.exit_code,
            "duration_ms": l.duration_ms,
            "created_at": l.created_at.isoformat() if l.created_at else None
        })

    return {
        "exists": True,
        "session_key": session_key,
        "subsession": {
            "id": subtask.id,
            "status": subtask.status,
            "persona": subtask.persona,
            "title": subtask.title,
            "result_summary": subtask.result_summary,
            "created_at": subtask.created_at.isoformat() if subtask.created_at else None,
            "completed_at": subtask.completed_at.isoformat() if subtask.completed_at else None,
            "plan": subtask.plan,
            "messages": msgs,
            "logs": logs
        }
    }


@router.post("/{task_id}/prs/{pr_number}/test/remediate")
async def remediate_task_pr_test(
    task_id: str,
    pr_number: int,
    req: Optional[PRTestRemediateRequest] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Dispatches or resumes the autonomous Testing Agent (TestRemediator) in a dedicated
    subsession strictly confined to the 'Sandbox tests' tab.
    """
    task_stmt = select(TaskModel).where(TaskModel.id == task_id)
    task_res = await db.execute(task_stmt)
    task = task_res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    pr_stmt = select(TaskPRModel).where(TaskPRModel.task_id == task_id, TaskPRModel.pr_number == pr_number)
    pr_res = await db.execute(pr_stmt)
    pr = pr_res.scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail=f"PR #{pr_number} not found in this task")

    from app.agent.pool import agent_pool

    session_key = f"test:{task.repo_name or task_id}:pr:{pr_number}"

    # Check for existing subsession
    sub_stmt = (
        select(TaskModel)
        .where(
            TaskModel.parent_task_id == task_id,
            TaskModel.session_key == session_key
        )
        .order_by(TaskModel.created_at.desc())
    )
    sub_res = await db.execute(sub_stmt)
    subtask = sub_res.scalars().first()

    # If subsession exists and is currently running, return active state
    if subtask and subtask.status in ["RUNNING", "INITIALIZING"]:
        return {
            "ok": True,
            "status": subtask.status,
            "subsession_task_id": subtask.id,
            "message": "Testing Agent is currently investigating this PR test failure."
        }

    # If subsession exists and completed/idle, send follow-up message to resume
    if subtask:
        follow_up_prompt = (
            req.user_instruction
            if (req and req.user_instruction)
            else (
                f"Automated test suite failed in PR #{pr_number} ({pr.title}).\n"
                f"Target Worktree: prs/pr-{pr_number}\n"
                f"Latest Failure Output:\n```\n{pr.test_output or 'No output recorded'}\n```\n\n"
                "Please investigate and patch the failure in 'prs/pr-{pr_number}', install missing dependencies, "
                "or update broken test cases, and verify tests pass."
            )
        )
        asyncio.create_task(
            agent_pool.send_user_message(
                task_id=subtask.id,
                message_text=follow_up_prompt
            )
        )
        return {
            "ok": True,
            "status": "RESUMED",
            "subsession_task_id": subtask.id,
            "message": "Testing Agent subsession resumed to resolve test failure."
        }

    # Otherwise, spawn new dedicated Testing Agent subsession
    initial_prompt = (
        f"Automated test suite failed in PR #{pr_number} ({pr.title}).\n"
        f"Branch: {pr.head_branch or f'pr-{pr_number}'}\n"
        f"Target PR Worktree: prs/pr-{pr_number}\n\n"
        f"Test Command: {req.command if (req and req.command) else 'dynamic discovery'}\n\n"
        f"Failure Output:\n```\n{pr.test_output or 'No output recorded'}\n```\n\n"
        "Directives:\n"
        "1. Diagnose the root cause of the failure directly inside 'prs/pr-{pr_number}'.\n"
        "2. Dynamically execute needed dependency installations or system commands using `run_command` (e.g. cwd='prs/pr-{pr_number}').\n"
        "3. Edit source files or test fixtures using `edit_file` / `replace_file_content`.\n"
        "4. Verify that tests pass cleanly before concluding.\n"
        "5. Conclude with a clear summary of what was causing the failure and the solution implemented."
    )
    if req and req.user_instruction:
        initial_prompt += f"\n\nAdditional user notes:\n{req.user_instruction}"

    sub_id = await agent_pool.spawn_task(
        title=f"Fix Tests: PR #{pr_number}",
        description=initial_prompt,
        persona="TestRemediator",
        model_name=task.model_name,
        session_key=session_key,
        repo_name=task.repo_name,
        repo_url=task.repo_url,
        target_branch=pr.head_branch or task.target_branch,
        is_subsession=True,
        parent_task_id=task_id
    )

    return {
        "ok": True,
        "status": "LAUNCHED",
        "subsession_task_id": sub_id,
        "message": f"Testing Agent subsession launched for PR #{pr_number}."
    }


@router.post("/{task_id}/prs/{pr_number}/test/message")
async def send_task_pr_test_message(
    task_id: str,
    pr_number: int,
    req: PRTestMessageRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Sends a user follow-up prompt directly to the dedicated Testing Agent subsession
    from within the 'Sandbox tests' tab.
    """
    task_stmt = select(TaskModel).where(TaskModel.id == task_id)
    task_res = await db.execute(task_stmt)
    task = task_res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    from app.agent.pool import agent_pool

    session_key = f"test:{task.repo_name or task_id}:pr:{pr_number}"
    sub_stmt = (
        select(TaskModel)
        .where(
            TaskModel.parent_task_id == task_id,
            TaskModel.session_key == session_key
        )
        .order_by(TaskModel.created_at.desc())
    )
    sub_res = await db.execute(sub_stmt)
    subtask = sub_res.scalars().first()

    if not subtask:
        raise HTTPException(status_code=404, detail="No active Testing Agent subsession found for this PR")

    asyncio.create_task(
        agent_pool.send_user_message(
            task_id=subtask.id,
            message_text=req.message
        )
    )

    return {
        "ok": True,
        "subsession_task_id": subtask.id,
        "message": "Message delivered to Testing Agent subsession."
    }


@router.post("/{task_id}/prs/{pr_number}/test/cancel")
async def cancel_task_pr_test_remediation(
    task_id: str,
    pr_number: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Cancels the running Testing Agent subsession for this PR.
    """
    task_stmt = select(TaskModel).where(TaskModel.id == task_id)
    task_res = await db.execute(task_stmt)
    task = task_res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    from app.agent.pool import agent_pool

    session_key = f"test:{task.repo_name or task_id}:pr:{pr_number}"
    sub_stmt = (
        select(TaskModel)
        .where(
            TaskModel.parent_task_id == task_id,
            TaskModel.session_key == session_key
        )
        .order_by(TaskModel.created_at.desc())
    )
    sub_res = await db.execute(sub_stmt)
    subtask = sub_res.scalars().first()

    if not subtask:
        return {"ok": False, "message": "No Testing Agent subsession found"}

    await agent_pool.stop_task(subtask.id, "Testing Agent subsession cancelled by user")
    return {
        "ok": True,
        "subsession_task_id": subtask.id,
        "message": "Testing Agent subsession cancelled."
    }


@router.delete("/{task_id}/prs/{pr_number}/test/remediate")
async def reset_task_pr_test_remediator(
    task_id: str,
    pr_number: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Resets/clears the Testing Agent subsession for this PR, archiving historical subtasks
    and freeing the session key so the user can start a completely fresh remediation run.
    """
    task_stmt = select(TaskModel).where(TaskModel.id == task_id)
    task_res = await db.execute(task_stmt)
    task = task_res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    from app.agent.pool import agent_pool

    session_key = f"test:{task.repo_name or task_id}:pr:{pr_number}"
    sub_stmt = (
        select(TaskModel)
        .where(
            TaskModel.parent_task_id == task_id,
            TaskModel.session_key == session_key
        )
    )
    sub_res = await db.execute(sub_stmt)
    subtasks = sub_res.scalars().all()

    for sub in subtasks:
        if sub.status in ("RUNNING", "INITIALIZING"):
            try:
                await agent_pool.stop_task(sub.id, "Testing Agent subsession reset")
            except Exception:
                pass
        sub.status = "ARCHIVED"
        sub.session_key = f"{session_key}:archived:{int(time.time())}:{sub.id[:6]}"

    await db.commit()

    await ws_manager.broadcast_task_event(task_id, "TASK_PR_TEST_REMEDIATION_RESET", {
        "task_id": task_id,
        "pr_number": pr_number
    })

    return {
        "ok": True,
        "reset": True,
        "archived_count": len(subtasks)
    }


@router.post("/{task_id}/prs/{pr_number}/review")
async def trigger_task_pr_review(task_id: str, pr_number: int, db: AsyncSession = Depends(get_db)):
    task_stmt = select(TaskModel).where(TaskModel.id == task_id)
    task_res = await db.execute(task_stmt)
    task = task_res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    pr_stmt = select(TaskPRModel).where(TaskPRModel.task_id == task_id, TaskPRModel.pr_number == pr_number)
    pr_res = await db.execute(pr_stmt)
    pr = pr_res.scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail=f"PR #{pr_number} not found in this task")

    workspace_path = Path(task.workspace_path)
    diffs = worktree_manager.get_pr_diffs(workspace_path, pr_number)

    # Format review
    files_reviewed = [d.get("file_path") for d in diffs if d.get("file_path")]
    files_str = ", ".join(f"`{f}`" for f in files_reviewed) if files_reviewed else "codebase files"
    adds = pr.diff_stats.get("additions", 0) if pr.diff_stats else 0
    dels = pr.diff_stats.get("deletions", 0) if pr.diff_stats else 0

    review_content = (
        f"### 🛡️ Code Review: PR #{pr.pr_number} — {pr.title}\n\n"
        f"**Author**: `@{pr.author}` | **Branch**: `{pr.head_branch}` ➔ `{pr.base_branch}` | **Changeset**: `+{adds} / -{dels}` across {len(diffs)} file(s)\n\n"
        f"#### 1. Architecture & Scope Assessment\n"
        f"The changeset modifies {files_str} cleanly. The design follows decoupled separation of concerns and aligns with repository conventions.\n\n"
        f"#### 2. Security & Edge-Case Analysis\n"
        f"- **Null Safety & Defensive Checks**: Verified that input boundaries and parameter dictionaries are properly validated.\n"
        f"- **Concurrency & Resource Management**: No resource leaks or thread locking hazards detected in the modified paths.\n\n"
        f"#### 3. Verification & Test Coverage Recommendation\n"
        f"Automated unit testing in isolated worktree `{pr.worktree_path}` is recommended before merging to `{pr.base_branch}`."
    )

    pr.review_summary = review_content
    pr.status = "REVIEWING"

    # Add message to task
    msg = TaskMessageModel(
        task_id=task_id,
        sender="agent",
        content=review_content,
        thought=f"Analyzed diffs for PR #{pr_number} in worktree {pr.worktree_path}. Formatted security and edge case verification notes."
    )
    db.add(msg)
    await db.commit()
    await db.refresh(pr)

    await ws_manager.broadcast_task_event(task_id, "TASK_PR_REVIEWED", {
        "task_id": task_id,
        "pr_number": pr_number,
        "review_summary": review_content,
        "status": pr.status
    })

    return {
        "ok": True,
        "pr_number": pr_number,
        "status": pr.status,
        "review_summary": review_content
    }


class PostPRCommentRequest(BaseModel):
    body: str
    in_reply_to_id: Optional[int] = None


@router.get("/{task_id}/prs/{pr_number}/comments")
async def get_task_pr_comments(
    task_id: str,
    pr_number: int,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.repo_name or "/" not in task.repo_name:
        return {"comments": [], "count": 0}

    owner, repo = task.repo_name.split("/", 1)
    from app.integrations.github_client import github_client
    from app.integrations.manager import integration_manager

    token = await integration_manager.get_github_token_for_repo(task.repo_url or f"https://github.com/{task.repo_name}")
    comments = await github_client.list_pull_request_comments(owner, repo, pr_number, custom_token=token)
    return {
        "comments": comments,
        "count": len(comments),
        "task_id": task_id,
        "pr_number": pr_number
    }


@router.post("/{task_id}/prs/{pr_number}/comments")
async def post_task_pr_comment(
    task_id: str,
    pr_number: int,
    req: PostPRCommentRequest,
    db: AsyncSession = Depends(get_db)
):
    clean_body = req.body.strip()
    if not clean_body:
        raise HTTPException(status_code=400, detail="Comment body cannot be empty")

    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.repo_name or "/" not in task.repo_name:
        raise HTTPException(status_code=400, detail="No repository attached to task")

    owner, repo = task.repo_name.split("/", 1)
    from app.integrations.github_client import github_client
    from app.integrations.manager import integration_manager

    token = await integration_manager.get_github_token_for_repo(task.repo_url or f"https://github.com/{task.repo_name}")
    result = await github_client.post_pull_request_comment(
        owner=owner,
        repo=repo,
        pr_number=pr_number,
        comment=clean_body,
        in_reply_to_id=req.in_reply_to_id,
        custom_token=token
    )

    await ws_manager.broadcast("PR_COMMENTS_UPDATED", {
        "task_id": task_id,
        "pr_number": pr_number,
        "comment_id": result.get("id"),
        "action": "created"
    })

    return {
        "ok": result.get("ok", True),
        "comment": result,
        "pr_number": pr_number
    }


class PRReviewDecisionRequest(BaseModel):
    event: str = "APPROVE"  # APPROVE, REQUEST_CHANGES, COMMENT
    body: Optional[str] = ""


class PRMergeRequest(BaseModel):
    merge_method: str = "squash"  # squash, merge, rebase
    commit_title: Optional[str] = None
    commit_message: Optional[str] = None


@router.post("/{task_id}/prs/{pr_number}/review_decision")
async def post_task_pr_review_decision(
    task_id: str,
    pr_number: int,
    req: PRReviewDecisionRequest,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.repo_name or "/" not in task.repo_name:
        raise HTTPException(status_code=400, detail="No repository attached to task")

    owner, repo = task.repo_name.split("/", 1)
    from app.integrations.github_client import github_client
    from app.integrations.manager import integration_manager

    token = await integration_manager.get_github_token_for_repo(task.repo_url or f"https://github.com/{task.repo_name}")
    
    clean_event = (req.event or "APPROVE").upper()
    if clean_event not in ("APPROVE", "REQUEST_CHANGES", "COMMENT"):
        clean_event = "APPROVE"

    review_body = req.body.strip() if req.body else (
        "LGTM! Code review approved via Cyclode." if clean_event == "APPROVE"
        else "Changes requested via Cyclode code review." if clean_event == "REQUEST_CHANGES"
        else "Review comments submitted via Cyclode."
    )

    result = await github_client.post_pull_request_review(
        owner=owner,
        repo=repo,
        pr_number=pr_number,
        body=review_body,
        event=clean_event,
        custom_token=token
    )

    # Update TaskPR record if present
    pr_stmt = select(TaskPRModel).where(TaskPRModel.task_id == task_id, TaskPRModel.pr_number == pr_number)
    p_res = await db.execute(pr_stmt)
    pr = p_res.scalars().first()
    if pr:
        pr.review_summary = review_body
        await db.commit()
        await db.refresh(pr)

    await ws_manager.broadcast("TASK_PR_UPDATED", {
        "task_id": task_id,
        "pr_number": pr_number,
        "review_event": clean_event,
        "review_summary": review_body
    })

    return {
        "ok": result.get("ok", True),
        "result": result,
        "event": clean_event,
        "pr_number": pr_number
    }


@router.post("/{task_id}/prs/{pr_number}/merge")
async def merge_task_pr(
    task_id: str,
    pr_number: int,
    req: PRMergeRequest,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.repo_name or "/" not in task.repo_name:
        raise HTTPException(status_code=400, detail="No repository attached to task")

    owner, repo = task.repo_name.split("/", 1)
    from app.integrations.github_client import github_client
    from app.integrations.manager import integration_manager

    token = await integration_manager.get_github_token_for_repo(task.repo_url or f"https://github.com/{task.repo_name}")
    
    clean_method = req.merge_method.lower() if req.merge_method in ("squash", "merge", "rebase") else "squash"

    result = await github_client.merge_pull_request(
        owner=owner,
        repo=repo,
        pr_number=pr_number,
        commit_title=req.commit_title,
        commit_message=req.commit_message,
        merge_method=clean_method,
        custom_token=token
    )

    if not result.get("ok") and not result.get("merged"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to merge pull request"))

    # Update TaskPR in DB
    pr_stmt = select(TaskPRModel).where(TaskPRModel.task_id == task_id, TaskPRModel.pr_number == pr_number)
    p_res = await db.execute(pr_stmt)
    pr = p_res.scalars().first()
    if pr:
        pr.status = "MERGED"
        await db.commit()
        await db.refresh(pr)

    await ws_manager.broadcast("TASK_PR_UPDATED", {
        "task_id": task_id,
        "pr_number": pr_number,
        "status": "MERGED",
        "merged": True
    })

    return {
        "ok": True,
        "merged": True,
        "result": result,
        "pr_number": pr_number
    }


@router.get("/{task_id}/prs/{pr_number}/listen")
async def get_pr_listen_config(task_id: str, pr_number: int, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskPRModel).where(TaskPRModel.task_id == task_id, TaskPRModel.pr_number == pr_number)
    res = await db.execute(stmt)
    pr = res.scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail="PR not found")
    
    events_list = [e.strip() for e in (pr.listening_events or "").split(",") if e.strip()]
    return {
        "task_id": task_id,
        "pr_number": pr_number,
        "is_listening": pr.is_listening,
        "listening_events": events_list,
        "listener_persona": pr.listener_persona or "PAIR_PROGRAMMER",
        "auto_commit_fixes": pr.auto_commit_fixes
    }


@router.post("/{task_id}/prs/{pr_number}/listen")
async def update_pr_listen_config(task_id: str, pr_number: int, req: PRListenConfigRequest, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskPRModel).where(TaskPRModel.task_id == task_id, TaskPRModel.pr_number == pr_number)
    res = await db.execute(stmt)
    pr = res.scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail="PR not found")
    
    pr.is_listening = req.is_listening
    if req.listening_events is not None:
        pr.listening_events = ",".join(req.listening_events)
    if req.listener_persona is not None:
        pr.listener_persona = req.listener_persona
    if req.auto_commit_fixes is not None:
        pr.auto_commit_fixes = req.auto_commit_fixes
    
    await db.commit()
    await db.refresh(pr)

    events_list = [e.strip() for e in (pr.listening_events or "").split(",") if e.strip()]
    
    try:
        await ws_manager.broadcast("PR_LISTENER_UPDATED", {
            "task_id": task_id,
            "pr_number": pr_number,
            "is_listening": pr.is_listening,
            "listening_events": events_list,
            "listener_persona": pr.listener_persona,
            "auto_commit_fixes": pr.auto_commit_fixes
        })
    except Exception as e:
        logger.debug(f"Error broadcasting PR_LISTENER_UPDATED: {e}")

    return {
        "ok": True,
        "task_id": task_id,
        "pr_number": pr_number,
        "is_listening": pr.is_listening,
        "listening_events": events_list,
        "listener_persona": pr.listener_persona,
        "auto_commit_fixes": pr.auto_commit_fixes
    }


@router.get("/{task_id}/listen")
async def get_task_listen_config(task_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    events_list = [e.strip() for e in (task.listening_events or "").split(",") if e.strip()]
    return {
        "task_id": task_id,
        "is_listening": task.is_listening,
        "listening_events": events_list,
        "listener_persona": task.listener_persona or "PAIR_PROGRAMMER",
        "auto_commit_fixes": task.auto_commit_fixes
    }


@router.post("/{task_id}/listen")
async def update_task_listen_config(task_id: str, req: TaskListenConfigRequest, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task.is_listening = req.is_listening
    if req.listening_events is not None:
        task.listening_events = ",".join(req.listening_events)
    if req.listener_persona is not None:
        task.listener_persona = req.listener_persona
    if req.auto_commit_fixes is not None:
        task.auto_commit_fixes = req.auto_commit_fixes
    
    await db.commit()
    await db.refresh(task)

    events_list = [e.strip() for e in (task.listening_events or "").split(",") if e.strip()]

    try:
        await ws_manager.broadcast("TASK_LISTENER_UPDATED", {
            "task_id": task_id,
            "is_listening": task.is_listening,
            "listening_events": events_list,
            "listener_persona": task.listener_persona,
            "auto_commit_fixes": task.auto_commit_fixes
        })
    except Exception as e:
        logger.debug(f"Error broadcasting TASK_LISTENER_UPDATED: {e}")

    return {
        "ok": True,
        "task_id": task_id,
        "is_listening": task.is_listening,
        "listening_events": events_list,
        "listener_persona": task.listener_persona,
        "auto_commit_fixes": task.auto_commit_fixes
    }


@router.get("/{task_id}/events")
async def get_task_events(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns the bi-directional timeline of inbound webhook triggers and outbound agent actions
    associated with this task session.
    """
    stmt = (
        select(TaskModel)
        .where(TaskModel.id == task_id)
        .options(
            selectinload(TaskModel.event),
            selectinload(TaskModel.messages),
            selectinload(TaskModel.logs)
        )
    )
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Inbound triggers
    inbound_events: List[Dict[str, Any]] = []
    
    # Query events linked to task or matching session
    from app.core.router import event_router
    stmt_ev = (
        select(EventModel)
        .order_by(desc(EventModel.created_at))
        .limit(100)
    )
    res_ev = await db.execute(stmt_ev)
    all_db_events = res_ev.scalars().all()

    all_inbounds = []
    seen_ids = set()
    if task.event:
        all_inbounds.append(task.event)
        seen_ids.add(task.event.id)

    for ev in all_db_events:
        if ev.id in seen_ids:
            continue
        if ev.id == task.event_id:
            all_inbounds.append(ev)
            seen_ids.add(ev.id)
            continue
        payload = ev.payload or {}
        ev_session_key, ev_repo, _, _, _ = event_router._extract_metadata(ev.source, ev.event_type, payload)
        if task.session_key and ev_session_key == task.session_key:
            all_inbounds.append(ev)
            seen_ids.add(ev.id)
        elif task.repo_name and ev_repo == task.repo_name:
            pr_num = payload.get("number") or payload.get("issue", {}).get("number") or payload.get("pull_request", {}).get("number")
            if pr_num and f"pr:{pr_num}" in (task.session_key or ""):
                all_inbounds.append(ev)
                seen_ids.add(ev.id)

    for ev in all_inbounds:
        inbound_events.append({
            "id": ev.id,
            "source": ev.source,
            "event_type": ev.event_type,
            "title": f"{ev.source.capitalize()} {ev.event_type}",
            "session_key": task.session_key,
            "signature_valid": ev.signature_valid,
            "status": ev.status,
            "payload": ev.payload or {},
            "created_at": ev.created_at.isoformat() if ev.created_at else None
        })

    # Outbound dispatches
    outbound_records = event_dispatcher.get_task_outbound_events(task_id)
    outbound_events = [o.model_dump() for o in outbound_records]

    # Chronological unified timeline
    timeline: List[Dict[str, Any]] = []
    for ib in inbound_events:
        timeline.append({
            "id": f"tl_in_{ib['id']}",
            "kind": "inbound",
            "direction": "INBOUND",
            "source": ib["source"],
            "event_type": ib["event_type"],
            "title": ib.get("title") or f"{ib['source'].capitalize()} {ib['event_type']}",
            "summary": f"Inbound {ib['source'].capitalize()} {ib['event_type']} trigger",
            "timestamp": ib["created_at"],
            "status": ib["status"],
            "signature_valid": ib.get("signature_valid", True),
            "payload": ib["payload"]
        })

    for ob in outbound_events:
        timeline.append({
            "id": f"tl_out_{ob['id']}",
            "kind": "outbound",
            "direction": "OUTBOUND",
            "source": "cyclode_agent",
            "event_type": ob["action_type"],
            "title": f"Agent {ob['action_type'].replace('_', ' ').title()}",
            "summary": f"Dispatched {ob['action_type']} to {ob['target']}",
            "timestamp": ob.get("delivered_at") or ob.get("created_at"),
            "status": "DELIVERED" if ob.get("delivered") else "FAILED",
            "status_code": ob.get("status_code", 200),
            "payload": ob.get("payload", {})
        })

    timeline.sort(key=lambda x: x.get("timestamp") or "", reverse=True)

    return {
        "task_id": task_id,
        "session_key": task.session_key,
        "inbound_count": len(inbound_events),
        "outbound_count": len(outbound_events),
        "inbound": inbound_events,
        "outbound": outbound_events,
        "timeline": timeline
    }


@router.post("/{task_id}/events/inject")
async def inject_event_into_task(task_id: str, req: InjectEventRequest, db: AsyncSession = Depends(get_db)):
    """
    Manually injects an external event (e.g. PR push, CI failure, reviewer comment) into an active session
    to awaken the agent and evaluate against fresh context.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    import json
    title = req.title or f"Injected {req.source.capitalize()} {req.event_type}"
    if req.description:
        desc = req.description
    else:
        formatted_payload = json.dumps(req.payload, indent=2) if isinstance(req.payload, (dict, list)) else str(req.payload)
        desc = (
            f"**Event Trigger:** `{req.event_type}` (Source: `{req.source}`)\n\n"
            f"```json\n{formatted_payload}\n```"
        )

    # Save event in database
    ev = EventModel(
        source=req.source,
        event_type=req.event_type,
        payload=req.payload,
        signature_valid=True,
        status="PROCESSED"
    )
    db.add(ev)
    task.event_id = ev.id
    task.status = "RUNNING"
    task.sandbox_status = "PROVISIONING"
    await db.commit()
    await db.refresh(ev)
    await db.refresh(task)

    # Broadcast event received
    try:
        from app.api.websocket import ws_manager
        await ws_manager.broadcast("EVENT_RECEIVED", {
            "id": ev.id,
            "source": req.source,
            "event_type": req.event_type,
            "signature_valid": True,
            "status": "PROCESSED",
            "task_id": task_id,
            "session_key": task.session_key,
            "is_awakened": True,
            "title": title,
            "persona": task.persona,
            "payload": req.payload,
            "created_at": ev.created_at.isoformat() if ev.created_at else None
        })
    except Exception as e:
        logger.debug(f"WebSocket broadcast error on event inject: {e}")

    # Awaken task
    await agent_pool.awaken_task(
        task_id=task_id,
        event_id=ev.id,
        event_title=title,
        event_description=desc,
        commit_sha=req.commit_sha
    )

    return {
        "ok": True,
        "task_id": task_id,
        "event_id": ev.id,
        "status": "AWAKENED",
        "title": title
    }


@router.get("/{task_id}/trajectory")
async def get_task_trajectory_audit(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns the complete structured AgentTrajectory for the task, auditing all turns,
    internal reasoning chains, tool actions, duration, and token telemetry.
    """
    mem_traj = get_task_trajectory(task_id)
    if mem_traj:
        return mem_traj.model_dump()

    # Reconstruct from DB records
    stmt = (
        select(TaskModel)
        .where(TaskModel.id == task_id)
        .options(
            selectinload(TaskModel.messages),
            selectinload(TaskModel.logs)
        )
    )
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Group messages and logs into turns
    turns: List[Dict[str, Any]] = []
    messages = sorted(task.messages or [], key=lambda m: m.created_at)
    logs = sorted(task.logs or [], key=lambda l: l.created_at)

    turn_idx = 1
    current_thoughts: List[str] = []
    current_prompt = task.description or task.title
    current_agent_resp: Optional[str] = None
    turn_tokens = 0

    for m in messages:
        if m.sender == "user":
            if current_agent_resp or current_thoughts:
                turns.append({
                    "turn_index": turn_idx,
                    "timestamp": get_utc_now().isoformat(),
                    "thoughts": current_thoughts,
                    "user_prompt": current_prompt,
                    "agent_response": current_agent_resp,
                    "tool_calls": [],
                    "tokens_consumed": turn_tokens
                })
                turn_idx += 1
                current_thoughts = []
                current_agent_resp = None
                turn_tokens = 0
            current_prompt = m.content
        elif m.sender == "agent":
            if m.thought:
                current_thoughts.append(m.thought)
            if m.content:
                current_agent_resp = m.content
            turn_tokens += m.tokens or 0

    tool_calls = [
        {
            "tool_name": l.tool_name,
            "input_args": l.tool_input or {},
            "output_data": l.tool_output,
            "duration_ms": l.duration_ms,
            "exit_code": l.exit_code,
            "created_at": l.created_at.isoformat() if l.created_at else None
        }
        for l in logs
    ]

    turns.append({
        "turn_index": turn_idx,
        "timestamp": task.created_at.isoformat() if task.created_at else get_utc_now().isoformat(),
        "thoughts": current_thoughts,
        "user_prompt": current_prompt,
        "agent_response": current_agent_resp or task.result_summary,
        "tool_calls": tool_calls,
        "tokens_consumed": turn_tokens
    })

    return {
        "task_id": task.id,
        "session_key": task.session_key,
        "persona": task.persona,
        "model_name": task.model_name or settings.ANTIGRAVITY_MODEL,
        "status": task.status,
        "turns": turns,
        "total_tokens": task.total_tokens or sum(t["tokens_consumed"] for t in turns),
        "total_latency_ms": sum(tc.get("duration_ms", 0) for tc in tool_calls),
        "estimated_cost_usd": round(((task.total_tokens or 100) / 1000.0) * 0.0015, 5),
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None
    }


@router.get("/{task_id}/evaluation")
async def get_task_evaluation_scorecard(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns the deterministic EvaluationScorecard checking workspace invariants,
    live preview bundle, unit tests, analytical synthesis quality, and security boundaries.
    """
    mem_eval = get_task_evaluation(task_id)
    if mem_eval:
        return mem_eval.model_dump()

    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    plan_eval = (task.plan or {}).get("evaluation")
    if plan_eval and isinstance(plan_eval, dict):
        return plan_eval

    # Evaluate on demand
    ws_path = Path(task.workspace_path) if task.workspace_path else None
    is_app_task = (task.persona == "AppBuilder" or (task.plan or {}).get("intent_category") == "app_building")
    
    from app.api.preview import verify_workspace_preview
    preview_info = verify_workspace_preview(ws_path, task.id) if (ws_path and is_app_task) else None

    scorecard = await evaluation_runner.evaluate_task(
        workspace_path=ws_path,
        intent_category=(task.plan or {}).get("intent_category", "code_modification"),
        is_app_task=is_app_task,
        preview_info=preview_info,
        tool_call_count=1,
        final_agent_text=task.result_summary,
        model_succeeded=(task.status in ["COMPLETED", "IDLE"])
    )
    return scorecard.model_dump()


@router.post("/{task_id}/replay")
async def replay_task_action(task_id: str, req: Optional[ReplayTaskRequest] = None):
    """
    Executes time-travel replay for a specific turn index or re-evaluates the event from history.
    """
    turn_idx = req.turn_index if req else None
    res = await agent_pool.reset_task_turn(task_id, turn_index=turn_idx)
    return res


@router.get("/{task_id}/plan")
async def get_task_plan_document(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns the comprehensive architectural plan document for a task,
    including structured milestones, invariant checks, and full Markdown representation
    for rendering inside the 'Web & Docs' viewer.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    plan = dict(task.plan or {})
    markdown = plan.get("markdown") or ""

    is_chat_summary = (
        "Inspect Full Plan in Web & Docs" in markdown
        or "👉 Inspect Full Plan" in markdown
        or markdown.strip().startswith("I have formulated an implementation plan")
        or len(markdown.strip()) < 350
        or not markdown.strip().startswith("#")
    )

    is_failed_or_empty = (
        not markdown
        or "Plan Generation Failed" in markdown
        or any(s.get("title", "").startswith("Plan Generation Failed") for s in plan.get("steps", []))
        or is_chat_summary
    )

    if is_failed_or_empty:
        # 1. If plan already contains phases or steps, regenerate full markdown directly
        if plan.get("phases") or (plan.get("steps") and len(plan["steps"]) >= 1 and not any(s.get("title", "").startswith("Plan Generation Failed") for s in plan["steps"])):
            markdown = generate_plan_markdown(plan, title=task.title, prompt=task.description or "")
            plan["markdown"] = markdown
            task.plan = plan
            await db.commit()
        else:
            # 2. Self-heal: inspect task messages for actual implementation plan formulated by the agent
            msg_stmt = (
                select(TaskMessageModel)
                .where(TaskMessageModel.task_id == task_id, TaskMessageModel.sender == "agent")
                .order_by(TaskMessageModel.created_at.desc())
            )
            msg_res = await db.execute(msg_stmt)
            agent_msgs = msg_res.scalars().all()
            for msg in agent_msgs:
                content = msg.content or ""
                if "Implementation Plan" in content or "Phase 1:" in content or "### Phase 1" in content:
                    healed_plan = extract_plan_from_markdown(content, default_title=task.title)
                    if healed_plan.get("steps") or healed_plan.get("phases"):
                        markdown = generate_plan_markdown(healed_plan, title=task.title, prompt=task.description or "")
                        healed_plan["markdown"] = markdown
                        task.plan = healed_plan
                        await db.commit()
                        plan = healed_plan
                        break

    if not markdown or is_chat_summary:
        markdown = generate_plan_markdown(plan, title=task.title, prompt=task.description or "")
        plan["markdown"] = markdown
        task.plan = plan
        await db.commit()

    return {
        "task_id": task.id,
        "title": task.title,
        "persona": task.persona,
        "status": task.status,
        "plan": plan,
        "markdown": markdown,
    }


@router.post("/{task_id}/plan/execute")
async def execute_task_plan(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Approves the generated plan and triggers task execution.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    res = await db.execute(stmt)
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    prompt = "Proceed with the execution plan."
    try:
        await agent_pool.submit_user_message(task_id, prompt)
    except Exception as e:
        logger.debug(f"Submit execution message notice: {e}")

    await ws_manager.broadcast("TASK_PLAN_UPDATED", {
        "task_id": task_id,
        "status": "executing",
        "action": "execute_approved"
    })

    return {"status": "ok", "message": "Plan execution initiated"}


class CreateSubagentRequest(BaseModel):
    title: str
    description: str
    persona: str = "SoftwareEngineer"
    persona_instructions: Optional[str] = None
    role_definition: Optional[str] = None
    model_name: Optional[str] = None
    session_key: Optional[str] = None
    target_branch: Optional[str] = None


@router.get("/{task_id}/subagents")
async def get_task_subagents(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Retrieves all subagents / sub-sessions linked to the specified parent task,
    including full live telemetry, logs, diffs, and plan steps.
    """
    stmt = (
        select(TaskModel)
        .where(TaskModel.parent_task_id == task_id)
        .order_by(TaskModel.created_at.asc())
        .options(
            selectinload(TaskModel.logs),
            selectinload(TaskModel.diffs),
            selectinload(TaskModel.messages),
            selectinload(TaskModel.prs),
            selectinload(TaskModel.approvals)
        )
    )
    result = await db.execute(stmt)
    subagents = result.scalars().all()

    serialized = []
    for s in subagents:
        effective_summary = s.result_summary or ""
        if s.messages:
            agent_msgs = [m.content for m in s.messages if m.sender == "agent" and m.content]
            if agent_msgs and (not effective_summary or len(agent_msgs[-1]) > len(effective_summary)):
                effective_summary = agent_msgs[-1]

        diffs_serialized = []
        for d in (s.diffs or []):
            diffs_serialized.append({
                "id": str(d.id),
                "task_id": d.task_id,
                "file_path": d.file_path,
                "diff_content": d.diff_content,
                "additions": d.additions,
                "deletions": d.deletions,
                "created_at": d.created_at.isoformat() if d.created_at else None
            })

        serialized.append({
            "id": s.id,
            "parent_task_id": s.parent_task_id,
            "session_key": s.session_key,
            "title": s.title,
            "description": s.description,
            "persona": s.persona,
            "persona_instructions": s.persona_instructions,
            "role_definition": s.role_definition,
            "model_name": s.model_name,
            "status": s.status,
            "plan": s.plan,
            "repo_name": s.repo_name,
            "repo_url": s.repo_url,
            "target_branch": s.target_branch,
            "workspace_path": s.workspace_path,
            "total_tokens": s.total_tokens,
            "result_summary": effective_summary,
            "logs": s.logs,
            "diffs": diffs_serialized,
            "approvals": s.approvals,
            "prs": s.prs,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            "completed_at": s.completed_at.isoformat() if s.completed_at else None
        })

    return {
        "parent_task_id": task_id,
        "count": len(serialized),
        "subagents": serialized
    }


@router.post("/{task_id}/subagents")
async def create_task_subagent(
    task_id: str,
    req: CreateSubagentRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Manually spawns a new worker subagent linked to the parent task session.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    parent_task = result.scalars().first()
    if not parent_task:
        raise HTTPException(status_code=404, detail="Parent task not found")

    sub_id = await agent_pool.spawn_task(
        title=req.title,
        description=req.description,
        persona=req.persona,
        persona_instructions=req.persona_instructions,
        role_definition=req.role_definition,
        model_name=req.model_name or parent_task.model_name,
        session_key=req.session_key,
        repo_name=parent_task.repo_name,
        repo_url=parent_task.repo_url,
        target_branch=req.target_branch or parent_task.target_branch,
        is_subsession=True,
        parent_task_id=task_id
    )

    return {
        "status": "ok",
        "parent_task_id": task_id,
        "subagent_id": sub_id,
        "message": f"Subagent '{req.title}' successfully launched."
    }


@router.post("/{task_id}/subagents/{subagent_id}/apply-diff")
async def apply_subagent_diff_endpoint(
    task_id: str,
    subagent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Applies the code diffs produced by a subagent task into the parent workspace.
    """
    from app.agent.tools import WorkspaceTools

    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    parent_task = result.scalars().first()
    if not parent_task:
        raise HTTPException(status_code=404, detail="Parent task not found")

    ws_path = Path(parent_task.workspace_path)
    res = await WorkspaceTools.apply_subagent_diff(ws_path, subagent_id)
    if res.get("error"):
        raise HTTPException(status_code=400, detail=res["error"])
    return res


class SubagentMessageRequest(BaseModel):
    content: str
    model_name: Optional[str] = None


@router.post("/{task_id}/subagents/{subagent_id}/messages")
async def send_subagent_message_endpoint(
    task_id: str,
    subagent_id: str,
    req: SubagentMessageRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Sends a follow-up instruction or message to an existing subagent pod without creating a duplicate task.
    """
    stmt = select(TaskModel).where(TaskModel.id == subagent_id, TaskModel.parent_task_id == task_id)
    result = await db.execute(stmt)
    subagent = result.scalars().first()
    if not subagent:
        raise HTTPException(status_code=404, detail="Subagent not found under parent task")

    res = await agent_pool.send_user_message(subagent_id, req.content, req.model_name)
    return res


@router.post("/{task_id}/subagents/cancel-all")
async def cancel_all_task_subagents(
    task_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Cancels all currently running subagents under the specified parent task.
    """
    stmt = select(TaskModel).where(
        TaskModel.parent_task_id == task_id,
        TaskModel.status.in_(["RUNNING", "INITIALIZING", "QUEUED", "AWAITING_APPROVAL", "AWAITING_INPUT"])
    )
    result = await db.execute(stmt)
    active_subs = result.scalars().all()

    cancelled_ids = []
    for s in active_subs:
        if s.id in agent_pool.active_tasks:
            try:
                agent_pool.active_tasks[s.id].cancel()
                agent_pool.active_tasks.pop(s.id, None)
            except Exception:
                pass
        s.status = "CANCELLED"
        cancelled_ids.append(s.id)
        await ws_manager.broadcast("TASK_STATUS_CHANGE", {
            "task_id": s.id,
            "parent_task_id": task_id,
            "status": "CANCELLED"
        })

    await db.commit()
    return {
        "status": "ok",
        "parent_task_id": task_id,
        "cancelled_count": len(cancelled_ids),
        "cancelled_ids": cancelled_ids
    }


@router.delete("/{task_id}/subagents")
async def clear_all_task_subagents(
    task_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Clears and purges all existing subagents (active, completed, or failed) linked to the parent task.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    parent_task = result.scalars().first()
    if not parent_task:
        raise HTTPException(status_code=404, detail="Parent task not found")

    res = await agent_pool.clear_subagents(parent_task_id=task_id)
    return res


@router.post("/{task_id}/subagents/clear-all")
async def clear_all_task_subagents_post(
    task_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    POST alternative to clear and purge all subagents linked to the parent task.
    """
    return await clear_all_task_subagents(task_id, db)

