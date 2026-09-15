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


def _inject_html_telemetry_and_base(html_text: str, base_href: str) -> str:
    """
    Injects `<base href="...">` and an iframe telemetry/console capture script into HTML content.
    """
    telemetry_script = (
        "\n<script id=\"cyclode-preview-telemetry\">\n"
        "(function() {\n"
        "  function serializeArg(arg) {\n"
        "    if (arg === null) return 'null';\n"
        "    if (arg === undefined) return 'undefined';\n"
        "    if (arg instanceof Error) return (arg.name || 'Error') + ': ' + arg.message + (arg.stack ? '\\n' + arg.stack : '');\n"
        "    if (typeof arg === 'object') {\n"
        "      try { return JSON.stringify(arg); } catch (e) { return String(arg); }\n"
        "    }\n"
        "    return String(arg);\n"
        "  }\n"
        "  function send(level, args) {\n"
        "    try {\n"
        "      var strArgs = Array.prototype.slice.call(args).map(serializeArg).join(' ');\n"
        "      window.parent.postMessage({\n"
        "        source: 'cyclode-preview-console',\n"
        "        level: level,\n"
        "        payload: strArgs,\n"
        "        timestamp: new Date().toISOString()\n"
        "      }, '*');\n"
        "    } catch (e) {}\n"
        "  }\n"
        "  var origLog = console.log, origWarn = console.warn, origErr = console.error, origInfo = console.info;\n"
        "  console.log = function() { send('log', arguments); if (origLog) origLog.apply(console, arguments); };\n"
        "  console.warn = function() { send('warn', arguments); if (origWarn) origWarn.apply(console, arguments); };\n"
        "  console.error = function() { send('error', arguments); if (origErr) origErr.apply(console, arguments); };\n"
        "  console.info = function() { send('info', arguments); if (origInfo) origInfo.apply(console, arguments); };\n"
        "  window.addEventListener('error', function(e) {\n"
        "    var loc = (e.filename || '') + (e.lineno ? ':' + e.lineno : '') + (e.colno ? ':' + e.colno : '');\n"
        "    var stack = e.error && e.error.stack ? '\\n' + e.error.stack : '';\n"
        "    send('error', [(e.message || 'Uncaught Error') + (loc ? ' (' + loc + ')' : '') + stack]);\n"
        "  });\n"
        "  window.addEventListener('unhandledrejection', function(e) {\n"
        "    var reason = e.reason;\n"
        "    var msg = reason instanceof Error ? (reason.message + (reason.stack ? '\\n' + reason.stack : '')) : String(reason);\n"
        "    send('error', ['Unhandled Promise Rejection: ' + msg]);\n"
        "  });\n"
        "})();\n"
        "</script>\n"
    )

    base_tag = f'<base href="{base_href}">' if not re.search(r'<base\s+[^>]*href=', html_text, re.IGNORECASE) else ""
    injection = f"{base_tag}\n{telemetry_script}"

    if re.search(r"<head[^>]*>", html_text, re.IGNORECASE):
        return re.sub(r"(<head[^>]*>)", r"\1\n" + injection, html_text, count=1, flags=re.IGNORECASE)
    elif re.search(r"<html[^>]*>", html_text, re.IGNORECASE):
        return re.sub(r"(<html[^>]*>)", r"\1\n<head>" + injection + "</head>", html_text, count=1, flags=re.IGNORECASE)
    else:
        return f"<!DOCTYPE html>\n<html><head>{injection}</head><body>{html_text}</body></html>"


def _generate_diagnostic_html(task_id: str, task_title: str, ws_path: Optional[Path]) -> str:
    """
    Generates a helpful, rich OneDark-themed diagnostic landing page when no static index.html is available.
    """
    discovered_files: List[str] = []
    framework_hint = "Static HTML / Web App"

    if ws_path and ws_path.exists():
        for root, dirs, files in os.walk(ws_path):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "venv", "__pycache__", ".git")]
            for f in files:
                rel = str((Path(root) / f).relative_to(ws_path))
                discovered_files.append(rel)
                if len(discovered_files) >= 30:
                    break
            if len(discovered_files) >= 30:
                break

    if any(f.endswith((".tsx", ".jsx")) for f in discovered_files):
        framework_hint = "React / Vite / TSX Application (Raw source detected without static index.html or build output)"
    elif any(f.endswith(".py") for f in discovered_files):
        framework_hint = "Python Service / Backend Application"
    elif any("package.json" in f for f in discovered_files):
        framework_hint = "Node.js / Web Application"

    file_list_html = "".join(f"<li style='margin-bottom:4px;font-family:monospace;'>📄 {f}</li>" for f in discovered_files[:15])
    if not file_list_html:
        file_list_html = "<li style='color:#7f848e;'>No files found in workspace root yet.</li>"

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Preview Diagnostics - {task_title}</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background: #1e1e24;
      color: #abb2bf;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }}
    .card {{
      background: #21252b;
      border: 1px solid #3b4048;
      border-radius: 14px;
      padding: 28px;
      max-width: 640px;
      width: 100%;
      box-shadow: 0 12px 30px rgba(0,0,0,0.4);
    }}
    .header {{
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }}
    .icon {{
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: rgba(97, 175, 239, 0.15);
      border: 1px solid rgba(97, 175, 239, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #61afef;
      font-size: 18px;
    }}
    h1 {{ font-size: 16px; color: #e5c07b; font-weight: 600; }}
    p {{ font-size: 13px; line-height: 1.6; color: #abb2bf; margin-bottom: 14px; }}
    .badge {{
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(224, 108, 117, 0.15);
      border: 1px solid rgba(224, 108, 117, 0.3);
      color: #e06c75;
      font-size: 11px;
      font-family: monospace;
      margin-bottom: 14px;
    }}
    .file-box {{
      background: #1a1c22;
      border: 1px solid #2c313a;
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 16px;
      font-size: 12px;
      max-height: 160px;
      overflow-y: auto;
    }}
    .tip {{
      background: rgba(97, 175, 239, 0.08);
      border-left: 3px solid #61afef;
      padding: 10px 14px;
      border-radius: 0 6px 6px 0;
      font-size: 12px;
      color: #d19a66;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="icon">⚡</div>
      <div>
        <h1>Cyclode App Preview Diagnostics</h1>
        <div style="font-size: 11px; color: #7f848e;">Workspace: sandbox-{task_id[:8]}</div>
      </div>
    </div>
    <div class="badge">No Static Entry Point (index.html) Detected</div>
    <p>The Cyclode live preview engine serves web applications rendered directly from an <code>index.html</code> entry point or built client bundles.</p>
    
    <div style="font-size: 11px; color: #7f848e; margin-bottom: 6px; font-weight: 600; text-transform: uppercase;">
      Detected Environment: <span style="color: #61afef;">{framework_hint}</span>
    </div>
    
    <div class="file-box">
      <div style="color: #5c6370; margin-bottom: 6px; font-weight: 600;">Discovered Files in Sandbox:</div>
      <ul style="list-style: none;">
        {file_list_html}
      </ul>
    </div>

    <div class="tip">
      💡 <strong>Suggested Remediation</strong>: Tell the Cyclode Agent in chat: <em>"Create an interactive index.html with modern React/Tailwind CDN stack"</em> or build the frontend bundle.
    </div>
  </div>
</body>
</html>"""
    return _inject_html_telemetry_and_base(html_content, f"/api/tasks/{task_id}/preview/")


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
    discovered_files: List[str] = []
    for root, dirs, files in os.walk(ws_path):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "venv", "__pycache__", ".git")]
        for f in files:
            if Path(f).suffix.lower() in asset_extensions:
                assets_count += 1
            rel_f = str((Path(root) / f).relative_to(ws_path))
            discovered_files.append(rel_f)

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
    elif assets_count > 0:
        return {
            "has_preview": True,
            "type": "diagnostic",
            "entry_point": "index.html",
            "title": task.title or "App Preview Diagnostics",
            "assets_count": assets_count,
            "available_entry_points": [],
            "preview_url": f"/api/tasks/{task_id}/preview/index.html",
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


@router.get("/{task_id}/preview/diagnostics")
async def get_preview_diagnostics(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns deep inspection diagnostics of workspace files, framework type, and preview telemetry.
    """
    stmt = select(TaskModel).where(TaskModel.id == task_id)
    result = await db.execute(stmt)
    task = result.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ws_path = _get_workspace_path(task)
    if not ws_path:
        return {
            "task_id": task_id,
            "workspace_exists": False,
            "framework": "None",
            "files": [],
            "suggestions": ["Task workspace has not been created on disk yet."]
        }

    files: List[Dict[str, Any]] = []
    for root, dirs, files_list in os.walk(ws_path):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "venv", "__pycache__", ".git")]
        for f in files_list:
            fp = Path(root) / f
            try:
                rel = str(fp.relative_to(ws_path))
                files.append({
                    "path": rel,
                    "size": fp.stat().st_size,
                    "is_entry": rel in ["index.html", "public/index.html", "dist/index.html"]
                })
            except Exception:
                continue

    framework = "Static Web (HTML/JS)"
    suggestions = []
    file_paths = [f["path"] for f in files]

    if any(p.endswith((".tsx", ".jsx")) for p in file_paths):
        framework = "React / Vite / TSX"
        if not any(p == "index.html" or "dist/index.html" in p for p in file_paths):
            suggestions.append("Found React/TSX source without built bundle. Generate a zero-dependency CDN index.html for instant preview.")
    elif any(p.endswith(".py") for p in file_paths):
        framework = "Python Backend API"
        suggestions.append("FastAPI / Python backend detected. Verify REST endpoints or pair with a frontend index.html.")

    return {
        "task_id": task_id,
        "workspace_exists": True,
        "framework": framework,
        "files_count": len(files),
        "files": files[:50],
        "suggestions": suggestions
    }


@router.get("/{task_id}/preview/{file_path:path}")
async def serve_preview_file(task_id: str, file_path: str = "", db: AsyncSession = Depends(get_db)):
    """
    Safely serves workspace static assets with script injection, MIME detection, and sandboxing headers.
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

    headers = {
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": "frame-ancestors 'self' *",
        "Cache-Control": "no-cache, must-revalidate",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Access-Control-Allow-Origin": "*",
    }

    if target_file.exists() and target_file.is_dir():
        index_candidate = target_file / "index.html"
        if index_candidate.exists() and index_candidate.is_file():
            target_file = index_candidate
        else:
            # Generate diagnostic page for this folder
            diag_html = _generate_diagnostic_html(task_id, task.title or "Preview", ws_path)
            return Response(content=diag_html, media_type="text/html; charset=utf-8", headers=headers)

    # If index.html requested but does not exist on disk, render diagnostic landing page!
    if not target_file.exists() or not target_file.is_file():
        if clean_rel in ["index.html", "public/index.html"]:
            diag_html = _generate_diagnostic_html(task_id, task.title or "Preview", ws_path)
            return Response(content=diag_html, media_type="text/html; charset=utf-8", headers=headers)
        raise HTTPException(status_code=404, detail=f"File '{clean_rel}' not found")

    ext = target_file.suffix.lower()
    media_type = MIME_TYPES.get(ext)
    if not media_type:
        guessed_type, _ = mimetypes.guess_type(str(target_file))
        media_type = guessed_type or "application/octet-stream"

    # For HTML files: inject base URL and console/error capture telemetry script
    if ext in [".html", ".htm"]:
        try:
            raw_html = target_file.read_text(encoding="utf-8", errors="ignore")
            base_href = f"/api/tasks/{task_id}/preview/"
            injected_html = _inject_html_telemetry_and_base(raw_html, base_href)
            return Response(
                content=injected_html,
                media_type="text/html; charset=utf-8",
                headers=headers
            )
        except Exception as e:
            logger.error(f"Failed to inject preview telemetry: {e}")

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
