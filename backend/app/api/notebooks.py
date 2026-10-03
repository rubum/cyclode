import os
import re
from pathlib import Path
from urllib.parse import unquote
from typing import Optional, Dict, Any, List, Tuple
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_db
from app.db.models import TaskModel
from app.core.sandboxes.notebook_runner import notebook_runner

router = APIRouter(prefix="/api/tasks", tags=["notebooks"])


class ExecuteCellRequest(BaseModel):
    path: str = Field(..., description="Relative path to .ipynb file in task workspace")
    cell_index: int = Field(..., ge=0, description="0-indexed cell position")
    source: Optional[str] = Field(None, description="Optional modified source code to execute and persist")


class ExecuteAllRequest(BaseModel):
    path: str = Field(..., description="Relative path to .ipynb file in task workspace")


class InterruptRequest(BaseModel):
    path: str = Field(..., description="Relative path to .ipynb file in task workspace")


class RestartKernelRequest(BaseModel):
    path: str = Field(..., description="Relative path to .ipynb file in task workspace")
    clear_outputs: bool = Field(False, description="Whether to clear existing cell outputs on restart")


class SaveNotebookRequest(BaseModel):
    path: str = Field(..., description="Relative path to .ipynb file in task workspace")
    notebook: Dict[str, Any] = Field(..., description="Full updated Jupyter notebook JSON structure")


async def _resolve_task_workspace(task_id: str, db: AsyncSession) -> Tuple[TaskModel, Path]:
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
        raise HTTPException(status_code=404, detail="Sandbox workspace directory does not exist on disk")

    return task, ws_path


def _clean_relative_path(raw_path: str, ws_path: Path) -> str:
    clean_rel = unquote(raw_path).lstrip("/\\")
    if clean_rel.startswith(ws_path.name + "/"):
        clean_rel = clean_rel[len(ws_path.name) + 1:]
    elif clean_rel.startswith(ws_path.name + "\\"):
        clean_rel = clean_rel[len(ws_path.name) + 1:]
    elif clean_rel.startswith("sandbox-"):
        parts = re.split(r"[/\\]", clean_rel, 1)
        if len(parts) > 1 and parts[0].startswith("sandbox-"):
            clean_rel = parts[1]
    return clean_rel


@router.post("/{task_id}/notebooks/execute-cell")
async def execute_notebook_cell(
    task_id: str,
    req: ExecuteCellRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Executes a specific code cell inside the task's sandbox Python environment,
    streaming real-time output and persisting updated results to the .ipynb file.
    """
    task, ws_path = await _resolve_task_workspace(task_id, db)
    clean_path = _clean_relative_path(req.path, ws_path)

    res = await notebook_runner.execute_cell(
        task_id=task_id,
        file_path=clean_path,
        workspace_path=ws_path,
        cell_index=req.cell_index,
        source_code=req.source
    )
    return res


@router.post("/{task_id}/notebooks/execute-all")
async def execute_all_notebook_cells(
    task_id: str,
    req: ExecuteAllRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Executes all code cells in the notebook sequentially from top to bottom.
    """
    task, ws_path = await _resolve_task_workspace(task_id, db)
    clean_path = _clean_relative_path(req.path, ws_path)

    res = await notebook_runner.execute_all_cells(
        task_id=task_id,
        file_path=clean_path,
        workspace_path=ws_path
    )
    return res


@router.post("/{task_id}/notebooks/interrupt")
async def interrupt_notebook_kernel(
    task_id: str,
    req: InterruptRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Sends SIGINT to interrupt active cell computation.
    """
    task, ws_path = await _resolve_task_workspace(task_id, db)
    clean_path = _clean_relative_path(req.path, ws_path)

    ok = await notebook_runner.interrupt(task_id, clean_path)
    return {"ok": ok}


@router.post("/{task_id}/notebooks/restart")
async def restart_notebook_kernel(
    task_id: str,
    req: RestartKernelRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Restarts the Python kernel session and optionally resets cell outputs on disk.
    """
    task, ws_path = await _resolve_task_workspace(task_id, db)
    clean_path = _clean_relative_path(req.path, ws_path)

    ok = await notebook_runner.restart(task_id, clean_path, ws_path, clear_outputs=req.clear_outputs)
    return {"ok": ok}


@router.put("/{task_id}/notebooks/save")
async def save_notebook_structure(
    task_id: str,
    req: SaveNotebookRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Saves an updated notebook structure (reordered cells, edits, new cells) to disk.
    """
    task, ws_path = await _resolve_task_workspace(task_id, db)
    clean_path = _clean_relative_path(req.path, ws_path)

    ok = await notebook_runner.save_notebook(task_id, clean_path, ws_path, req.notebook)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to save notebook to disk")
    return {"ok": True}
