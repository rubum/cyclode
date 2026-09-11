from fastapi import APIRouter, Depends, HTTPException, Query
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.db.session import get_db
from app.db.models import TaskModel, TaskMessageModel, TaskLogModel, TaskApprovalModel, TaskDiffModel
from app.agent.pool import agent_pool
from app.core.sandboxes.manager import sandbox_manager

router = APIRouter(prefix="/api/tasks", tags=["Tasks"])


class CreateTaskRequest(BaseModel):
    title: str
    description: str = ""
    persona: str = "IssueResolver"
    model_name: Optional[str] = None


class UserMessageRequest(BaseModel):
    content: str


class EditMessageRequest(BaseModel):
    content: str


class RetryTaskRequest(BaseModel):
    from_message_id: Optional[str] = None


class ApprovalActionRequest(BaseModel):
    feedback: Optional[str] = None


@router.get("")
async def list_tasks(
    status: Optional[str] = None,
    persona: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    stmt = select(TaskModel).order_by(desc(TaskModel.created_at)).limit(limit)
    if status:
        stmt = stmt.where(TaskModel.status == status)
    if persona:
        stmt = stmt.where(TaskModel.persona == persona)

    result = await db.execute(stmt)
    tasks = result.scalars().all()
    return tasks


@router.post("")
async def create_task(req: CreateTaskRequest):
    task_id = await agent_pool.spawn_task(
        title=req.title,
        description=req.description,
        persona=req.persona,
        model_name=req.model_name
    )
    return {"ok": True, "task_id": task_id}


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
        "description": task.description,
        "persona": task.persona,
        "model_name": task.model_name,
        "status": task.status,
        "repo_name": task.repo_name,
        "repo_url": task.repo_url,
        "target_branch": task.target_branch,
        "commit_sha": task.commit_sha,
        "sandbox_status": task.sandbox_status,
        "workspace_path": task.workspace_path,
        "git_branch": task.git_branch,
        "total_tokens": task.total_tokens,
        "result_summary": task.result_summary,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "completed_at": task.completed_at,
        "event": task.event,
        "messages": task.messages,
        "logs": task.logs,
        "approvals": task.approvals,
        "diffs": task.diffs
    }


@router.post("/{task_id}/message")
async def send_message_to_task(task_id: str, req: UserMessageRequest):
    res = await agent_pool.send_user_message(task_id, req.content)
    return res


@router.post("/{task_id}/retry")
async def retry_task_action(task_id: str, req: Optional[RetryTaskRequest] = None):
    from_msg_id = req.from_message_id if req else None
    res = await agent_pool.retry_task(task_id, from_msg_id)
    return res


@router.post("/{task_id}/messages/{message_id}/edit")
async def edit_task_message(task_id: str, message_id: str, req: EditMessageRequest):
    res = await agent_pool.edit_and_resubmit_message(task_id, message_id, req.content)
    return res


@router.put("/{task_id}/description")
async def edit_task_description(task_id: str, req: EditMessageRequest):
    res = await agent_pool.edit_and_resubmit_message(task_id, "initial", req.content)
    return res


@router.post("/{task_id}/approve")
async def approve_task_action(task_id: str, req: ApprovalActionRequest):
    res = await agent_pool.approve_task(task_id, req.feedback)
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


@router.delete("")
@router.delete("/")
async def clear_all_tasks(db: AsyncSession = Depends(get_db)):
    stmt = select(TaskModel)
    result = await db.execute(stmt)
    tasks = result.scalars().all()
    for task in tasks:
        if task.id in agent_pool.active_tasks:
            agent_pool.active_tasks[task.id].cancel()
            agent_pool.active_tasks.pop(task.id, None)
        await sandbox_manager.destroy_by_task_id(task.id, task.workspace_path)
        await db.delete(task)
    await db.commit()
    return {"ok": True, "count": len(tasks), "message": "All sessions cleared"}


@router.delete("/{task_id}")
async def delete_task(task_id: str, db: AsyncSession = Depends(get_db)):
    if not task_id or task_id.strip() == "":
        return await clear_all_tasks(db)
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.id in agent_pool.active_tasks:
        agent_pool.active_tasks[task.id].cancel()
        agent_pool.active_tasks.pop(task.id, None)

    await sandbox_manager.destroy_by_task_id(task.id, task.workspace_path)

    await db.delete(task)
    await db.commit()
    return {"ok": True, "deleted_task_id": task_id}



@router.get("/{task_id}/sandbox")
async def get_task_sandbox_info(task_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = Path(task.workspace_path) if task.workspace_path else None
    exists = bool(ws_path and ws_path.exists() and ws_path.is_dir())

    def build_tree(current_path: Path, max_depth: int = 4, current_depth: int = 0) -> List[Dict[str, Any]]:
        if not current_path.exists() or current_depth >= max_depth:
            return []
        items = []
        try:
            for p in sorted(current_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if p.name in (".git", "__pycache__", ".pytest_cache", "node_modules"):
                    continue
                rel = str(p.relative_to(ws_path)) if ws_path else p.name
                if p.is_dir():
                    children = build_tree(p, max_depth, current_depth + 1)
                    items.append({
                        "name": p.name,
                        "path": rel,
                        "is_dir": True,
                        "type": "directory",
                        "children": children
                    })
                else:
                    items.append({
                        "name": p.name,
                        "path": rel,
                        "is_dir": False,
                        "type": "file",
                        "size": p.stat().st_size
                    })
        except Exception:
            pass
        return items

    file_tree = build_tree(ws_path) if (exists and ws_path) else []

    def count_and_size(tree: List[Dict[str, Any]]) -> Tuple[int, int]:
        f_count = 0
        tot_size = 0
        for item in tree:
            if item.get("is_dir"):
                c, s = count_and_size(item.get("children", []))
                f_count += c
                tot_size += s
            else:
                f_count += 1
                tot_size += item.get("size", 0)
        return f_count, tot_size

    total_files, total_bytes = count_and_size(file_tree)

    return {
        "task_id": task.id,
        "sandbox_status": task.sandbox_status or ("PROVISIONING" if task.status == "INITIALIZING" else "ACTIVE"),
        "workspace_path": str(ws_path) if ws_path else "",
        "exists_on_disk": exists,
        "git_branch": task.git_branch,
        "repo_url": task.repo_url,
        "target_branch": task.target_branch,
        "commit_sha": task.commit_sha,
        "file_tree": file_tree,
        "file_count": total_files,
        "total_size_bytes": total_bytes,
        "runtime": {
            "mode": "ephemeral_sandbox",
            "isolation": "filesystem_confinement",
            "lifecycle": "disposable_on_completion" if task.sandbox_status != "ACTIVE" else "active_execution",
            "timeout_seconds": 60
        }
    }


@router.get("/{task_id}/files/content")
async def get_sandbox_file_content(task_id: str, path: str, db: AsyncSession = Depends(get_db)):
    """
    Safely retrieves the content and metadata of a file located within the task sandbox workspace.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task.workspace_path:
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    ws_path = Path(task.workspace_path).resolve()
    if not ws_path.exists() or not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    # Sanitize and resolve target path
    clean_rel = path.lstrip("/\\")
    target_file = (ws_path / clean_rel).resolve()

    # Security check: must reside inside workspace
    try:
        target_file.relative_to(ws_path)
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: Path outside sandbox workspace")

    if not target_file.exists() or not target_file.is_file():
        raise HTTPException(status_code=404, detail=f"File '{clean_rel}' not found")

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
        ".toml": "toml",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".md": "markdown",
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
        content = target_file.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {str(e)}")

    return {
        "path": clean_rel,
        "name": target_file.name,
        "content": content,
        "size": target_file.stat().st_size,
        "lines": len(content.splitlines()),
        "language": language
    }


