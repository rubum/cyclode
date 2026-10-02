import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.db.models import TaskModel
from app.core.sandboxes.terminal_manager import terminal_manager

logger = logging.getLogger("cyclode.api.terminals")

router = APIRouter(prefix="/api/tasks/{task_id}/terminals", tags=["Terminals"])


class SpawnTerminalRequest(BaseModel):
    session_id: Optional[str] = None
    cols: int = 80
    rows: int = 24
    shell: Optional[str] = None


class ResizeTerminalRequest(BaseModel):
    cols: int
    rows: int


class WriteTerminalInputRequest(BaseModel):
    data: str


async def _resolve_task_workspace(task_id: str, db: AsyncSession) -> Path:
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.workspace_path and Path(task.workspace_path).exists():
        return Path(task.workspace_path)

    # Fallback to local sandbox directory
    default_dir = Path(f"/tmp/cyclode_sandboxes/{task_id}")
    default_dir.mkdir(parents=True, exist_ok=True)
    return default_dir


@router.get("", response_model=List[Dict[str, Any]])
async def list_terminals(task_id: str, db: AsyncSession = Depends(get_db)):
    """Lists all active interactive terminal sessions for a task."""
    # Ensure task exists
    stmt = select(TaskModel.id).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Task not found")

    return terminal_manager.list_task_sessions(task_id)


@router.post("", response_model=Dict[str, Any])
async def spawn_terminal(
    task_id: str,
    req: SpawnTerminalRequest = SpawnTerminalRequest(),
    db: AsyncSession = Depends(get_db)
):
    """Spawns a new interactive PTY terminal session for the task workspace."""
    workspace_path = await _resolve_task_workspace(task_id, db)
    try:
        session = await terminal_manager.spawn_session(
            task_id=task_id,
            workspace_path=workspace_path,
            session_id=req.session_id,
            cols=req.cols,
            rows=req.rows,
            custom_shell=req.shell,
        )
        return session.to_dict()
    except Exception as e:
        logger.error(f"Error creating terminal session for task {task_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to spawn terminal: {str(e)}")


@router.get("/{session_id}/scrollback")
async def get_terminal_scrollback(task_id: str, session_id: str):
    """Retrieves scrollback history buffer for an active or recent terminal session."""
    session = terminal_manager.get_session(session_id)
    if not session or session.task_id != task_id:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    return {
        "session_id": session_id,
        "task_id": task_id,
        "scrollback": session.get_scrollback(),
        "is_alive": session.is_alive,
        "exit_code": session.exit_code,
    }


@router.post("/{session_id}/resize")
async def resize_terminal(task_id: str, session_id: str, req: ResizeTerminalRequest):
    """Resizes the terminal window dimensions."""
    session = terminal_manager.get_session(session_id)
    if not session or session.task_id != task_id:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    ok = terminal_manager.resize_session(session_id, req.cols, req.rows)
    return {"ok": ok, "cols": req.cols, "rows": req.rows}


@router.post("/{session_id}/input")
async def write_terminal_input(task_id: str, session_id: str, req: WriteTerminalInputRequest):
    """Writes keystroke data to the terminal session."""
    session = terminal_manager.get_session(session_id)
    if not session or session.task_id != task_id:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    ok = await terminal_manager.write_input(session_id, req.data)
    return {"ok": ok}


@router.delete("/{session_id}")
async def kill_terminal(task_id: str, session_id: str):
    """Kills a terminal session and frees associated system resources."""
    session = terminal_manager.get_session(session_id)
    if not session or session.task_id != task_id:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    ok = await terminal_manager.kill_session(session_id)
    return {"ok": ok, "session_id": session_id}
