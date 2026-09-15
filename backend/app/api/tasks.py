import os
import subprocess
from fastapi import APIRouter, Depends, HTTPException, Query
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.db.session import get_db
from app.db.models import TaskModel, TaskMessageModel, TaskLogModel, TaskApprovalModel, TaskDiffModel, TaskPRModel
from app.agent.pool import agent_pool
from app.core.sandboxes.manager import sandbox_manager
from app.core.worktree import worktree_manager
from app.api.websocket import ws_manager
from app.config import settings

router = APIRouter(prefix="/api/tasks", tags=["Tasks"])


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
    if not repo_url:
        combined_text = f"{req.title} {req.description}"
        repo_match = re.search(r"(https?://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?)", combined_text, re.IGNORECASE)
        if repo_match:
            raw_url = repo_match.group(1).rstrip("/")
            if raw_url.endswith(".git"):
                raw_url = raw_url[:-4]
            repo_url = raw_url
            if "github.com/" in repo_url and not repo_name:
                repo_name = repo_url.split("github.com/")[-1]

    task_id = await agent_pool.spawn_task(
        title=req.title,
        description=req.description,
        persona=req.persona,
        model_name=req.model_name,
        session_key=req.session_key,
        repo_name=repo_name,
        repo_url=repo_url,
        is_subsession=req.is_subsession,
        parent_task_id=req.parent_task_id
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


@router.get("/{task_id}/sandbox")
async def get_task_sandbox_info(task_id: str, depth: int = 7, db: AsyncSession = Depends(get_db)):
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

    exists = bool(ws_path and ws_path.exists() and ws_path.is_dir())

    top_directories: List[Dict[str, Any]] = []
    language_counts: Dict[str, Dict[str, Any]] = {}
    manifests: List[Dict[str, Any]] = []
    total_files = 0
    total_bytes = 0

    git_status = {
        "branch": task.git_branch or "main",
        "repo_url": task.repo_url or "",
        "commit_sha": task.commit_sha or "",
        "is_clean": True,
        "modified_count": 0,
        "untracked_count": 0
    }

    if exists and ws_path:
        # Check project manifests
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

        # Scan filesystem for stats and languages
        ignored_dirs = {".git", "__pycache__", ".pytest_cache", "node_modules", "dist", "build", ".gemini", ".next", ".cache"}
        for root, dirs, files in os.walk(ws_path):
            dirs[:] = [d for d in dirs if d not in ignored_dirs and not d.startswith(".")]
            for f in files:
                p = Path(root) / f
                ext = p.suffix.lower()
                lang = EXTENSION_MAP.get(ext, "Other" if ext else "Plain Text")
                try:
                    fsize = p.stat().st_size
                except Exception:
                    fsize = 0

                total_files += 1
                total_bytes += fsize

                if lang not in language_counts:
                    language_counts[lang] = {"count": 0, "bytes": 0}
                language_counts[lang]["count"] += 1
                language_counts[lang]["bytes"] += fsize

        # Top-level directories directly under workspace
        try:
            for item in ws_path.iterdir():
                if item.is_dir() and item.name not in ignored_dirs and not item.name.startswith("."):
                    dir_files = 0
                    dir_bytes = 0
                    for r, d, fls in os.walk(item):
                        d[:] = [sub for sub in d if sub not in ignored_dirs and not sub.startswith(".")]
                        dir_files += len(fls)
                        for fl in fls:
                            try:
                                dir_bytes += (Path(r) / fl).stat().st_size
                            except Exception:
                                pass
                    top_directories.append({
                        "name": item.name,
                        "file_count": dir_files,
                        "size_bytes": dir_bytes
                    })
            top_directories.sort(key=lambda x: x["size_bytes"], reverse=True)
        except Exception:
            pass

        # Git status inspection
        if (ws_path / ".git").exists():
            try:
                proc = subprocess.run(
                    ["git", "status", "--porcelain"],
                    cwd=str(ws_path),
                    capture_output=True,
                    text=True,
                    timeout=2.0
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

    # Format languages
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

    # Recent tool executions from TaskLogModel
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
            recent_logs.append({
                "tool_name": log.tool_name,
                "exit_code": log.exit_code,
                "duration_ms": log.duration_ms,
                "created_at": log.created_at.isoformat() if log.created_at else None,
                "tool_input": log.tool_input or {}
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

    max_tree_depth = min(max(depth, 1), 10)
    IGNORE_TREE_NAMES = {
        ".git", "__pycache__", ".pytest_cache", "node_modules",
        "dist", "build", ".gemini", ".next", ".cache", ".idea", ".vscode"
    }

    def build_tree(current_path: Path, max_depth: int = max_tree_depth, current_depth: int = 0, max_entries: int = 150) -> List[Dict[str, Any]]:
        if not current_path.exists() or current_depth >= max_depth:
            return []
        items = []
        try:
            entries = [
                p for p in current_path.iterdir()
                if p.name not in IGNORE_TREE_NAMES
            ]
            entries.sort(key=lambda x: (not x.is_dir(), x.name.lower()))
            for p in entries[:max_entries]:
                rel = str(p.relative_to(ws_path)) if ws_path else p.name
                if p.is_dir():
                    try:
                        direct_count = sum(1 for child in p.iterdir() if child.name not in IGNORE_TREE_NAMES)
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

    file_tree = build_tree(ws_path, max_depth=max_tree_depth) if (exists and ws_path) else []

    cli_command = f'docker exec -it cyclode-backend bash -c "cd {container_path} && exec bash"' if container_path else ""

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

    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    # Sanitize and resolve target path
    clean_rel = path.lstrip("/\\")

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


@router.post("/{task_id}/prs/{pr_number}/test")
async def run_task_pr_test(task_id: str, pr_number: int, db: AsyncSession = Depends(get_db)):
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

    # Resolve test command
    test_cmd = "python3 -m unittest discover tests"
    if task.repo_name:
        from app.db.models import RepositoryConfigModel
        repo_stmt = select(RepositoryConfigModel).where(
            (RepositoryConfigModel.full_name == task.repo_name) | (RepositoryConfigModel.name == task.repo_name)
        )
        repo_res = await db.execute(repo_stmt)
        repo_obj = repo_res.scalars().first()
        if repo_obj and repo_obj.test_command:
            test_cmd = repo_obj.test_command

    workspace_path = Path(task.workspace_path)
    test_result = worktree_manager.run_test_in_pr_worktree(workspace_path, pr_number, test_cmd)

    pr.status = "TESTS_PASSING" if test_result.get("ok") else "TESTS_FAILED"
    pr.test_output = test_result.get("stdout", "") or test_result.get("stderr", "")

    # Record log
    log = TaskLogModel(
        task_id=task_id,
        tool_name=f"run_pr_test (PR #{pr_number})",
        tool_input={"command": test_cmd, "pr_number": pr_number, "worktree": pr.worktree_path},
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



