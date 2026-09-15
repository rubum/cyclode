import os
import re
import mimetypes
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_db
from app.db.models import TaskModel

logger = logging.getLogger("cyclode.api.preview")
router = APIRouter(prefix="/api/tasks", tags=["App Preview"])

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".cjs": "application/javascript; charset=utf-8",
    ".ts": "application/javascript; charset=utf-8",
    ".tsx": "application/javascript; charset=utf-8",
    ".jsx": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".wasm": "application/wasm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
}


def _get_workspace_path(task: TaskModel) -> Optional[Path]:
    """Resolves and validates the workspace path for a task."""
    ws_path = Path(task.workspace_path).resolve() if task.workspace_path else None
    if ws_path and ws_path.name != f"sandbox-{task.id}":
        specific_sb = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if specific_sb.exists() and specific_sb.is_dir():
            ws_path = specific_sb

    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        candidate = Path(settings.WORKSPACE_ROOT) / f"sandbox-{task.id}"
        if candidate.exists() and candidate.is_dir():
            return candidate
        return None
    return ws_path


def _extract_html_title(html_file: Path) -> Optional[str]:
    """Extracts the <title> text from an HTML file."""
    try:
        content = html_file.read_text(encoding="utf-8", errors="ignore")[:4096]
        match = re.search(r"<title[^>]*>(.*?)</title>", content, re.IGNORECASE | re.DOTALL)
        if match:
            return match.group(1).strip()
    except Exception as e:
        logger.debug(f"Failed to extract title from {html_file}: {e}")
    return None


@router.get("/{task_id}/preview/inspect")
async def inspect_preview(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Inspects the task workspace for previewable web assets (HTML/CSS/JS or dev servers).
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = _get_workspace_path(task)
    if not ws_path:
        return {
            "has_preview": False,
            "type": None,
            "entry_point": None,
            "title": None,
            "assets_count": 0,
            "available_entry_points": [],
            "preview_url": None,
        }

    entry_candidates = [
        "index.html",
        "public/index.html",
        "dist/index.html",
        "build/index.html",
        "src/index.html",
        "app/index.html",
        "main.html",
    ]

    available_entry_points: List[str] = []
    primary_entry: Optional[str] = None
    extracted_title: Optional[str] = None

    for candidate in entry_candidates:
        candidate_file = (ws_path / candidate).resolve()
        try:
            candidate_file.relative_to(ws_path)
            if candidate_file.exists() and candidate_file.is_file():
                available_entry_points.append(candidate)
                if not primary_entry:
                    primary_entry = candidate
                    extracted_title = _extract_html_title(candidate_file)
        except ValueError:
            continue

    if not primary_entry:
        for root, dirs, files in os.walk(ws_path):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "venv", "__pycache__", ".git")]
            for f in files:
                if f.lower().endswith((".html", ".htm")):
                    full_p = Path(root) / f
                    try:
                        rel = str(full_p.relative_to(ws_path))
                        available_entry_points.append(rel)
                        if not primary_entry:
                            primary_entry = rel
                            extracted_title = _extract_html_title(full_p)
                    except ValueError:
                        continue

    asset_extensions = {".html", ".htm", ".css", ".js", ".mjs", ".jsx", ".ts", ".tsx", ".svg", ".png", ".jpg", ".jpeg", ".json", ".wasm"}
    assets_count = 0
    for root, dirs, files in os.walk(ws_path):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "venv", "__pycache__", ".git")]
        for f in files:
            if Path(f).suffix.lower() in asset_extensions:
                assets_count += 1

    pkg_json_file = ws_path / "package.json"
    has_package_json = pkg_json_file.exists() and pkg_json_file.is_file()

    if primary_entry:
        return {
            "has_preview": True,
            "type": "static",
            "entry_point": primary_entry,
            "title": extracted_title or "App Preview",
            "assets_count": assets_count,
            "available_entry_points": available_entry_points,
            "preview_url": f"/api/tasks/{task_id}/preview/{primary_entry}",
        }
    elif has_package_json:
        return {
            "has_preview": True,
            "type": "dev_server",
            "entry_point": "package.json",
            "title": task.title or "Dev Server App",
            "assets_count": assets_count,
            "available_entry_points": [],
            "preview_url": None,
        }

    return {
        "has_preview": False,
        "type": None,
        "entry_point": None,
        "title": None,
        "assets_count": assets_count,
        "available_entry_points": [],
        "preview_url": None,
    }


@router.get("/{task_id}/preview/{file_path:path}")
async def serve_preview_file(task_id: str, file_path: str = "", db: AsyncSession = Depends(get_db)):
    """
    Safely serves workspace static assets with strict path confinement, MIME detection, and sandboxing headers.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = _get_workspace_path(task)
    if not ws_path:
        raise HTTPException(status_code=404, detail="Sandbox workspace does not exist on disk")

    clean_rel = file_path.strip().lstrip("/\\")
    if not clean_rel:
        clean_rel = "index.html"

    if clean_rel.startswith(ws_path.name + "/"):
        clean_rel = clean_rel[len(ws_path.name) + 1:]
    elif clean_rel.startswith(ws_path.name + "\\"):
        clean_rel = clean_rel[len(ws_path.name) + 1:]

    target_file = (ws_path / clean_rel).resolve()

    try:
        target_file.relative_to(ws_path)
    except ValueError:
        logger.warning(f"Path traversal attempt blocked: {clean_rel} outside {ws_path}")
        raise HTTPException(status_code=403, detail="Access denied: Path outside workspace sandbox")

    if target_file.exists() and target_file.is_dir():
        index_candidate = target_file / "index.html"
        if index_candidate.exists() and index_candidate.is_file():
            target_file = index_candidate
        else:
            raise HTTPException(status_code=404, detail=f"Directory '{clean_rel}' has no index.html")

    if not target_file.exists() or not target_file.is_file():
        raise HTTPException(status_code=404, detail=f"File '{clean_rel}' not found")

    ext = target_file.suffix.lower()
    media_type = MIME_TYPES.get(ext)
    if not media_type:
        guessed_type, _ = mimetypes.guess_type(str(target_file))
        media_type = guessed_type or "application/octet-stream"

    headers = {
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": "frame-ancestors 'self' *",
        "Cache-Control": "no-cache, must-revalidate",
        "Cross-Origin-Resource-Policy": "cross-origin",
    }

    return FileResponse(
        path=str(target_file),
        media_type=media_type,
        headers=headers
    )


@router.api_route("/{task_id}/preview/proxy/{port}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_preview_dev_server(task_id: str, port: int, path: str = "", request: Request = None, db: AsyncSession = Depends(get_db)):
    """
    Reverse proxies HTTP requests to a development server running inside the task container or host port.
    """
    import httpx
    target_url = f"http://127.0.0.1:{port}/{path}"
    if request and request.url.query:
        target_url = f"{target_url}?{request.url.query}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            req_body = await request.body() if request else None
            headers = dict(request.headers) if request else {}
            headers.pop("host", None)
            headers["X-Forwarded-Host"] = request.headers.get("host", "")

            resp = await client.request(
                method=request.method if request else "GET",
                url=target_url,
                content=req_body,
                headers=headers,
            )

            excluded_headers = {"content-encoding", "content-length", "transfer-encoding", "connection"}
            forward_headers = {
                k: v for k, v in resp.headers.items()
                if k.lower() not in excluded_headers
            }
            forward_headers["X-Frame-Options"] = "SAMEORIGIN"

            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=forward_headers,
                media_type=resp.headers.get("content-type")
            )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to connect to development server on port {port}. Please ensure the server is running."
        )
    except Exception as e:
        logger.error(f"Dev server proxy error on port {port}: {e}")
        raise HTTPException(status_code=500, detail=f"Dev server proxy error: {str(e)}")
