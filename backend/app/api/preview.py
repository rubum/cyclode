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


def _rewrite_asset_paths_for_preview(html_text: str) -> str:
    """
    Rewrites root-relative asset URLs (e.g. src="/assets/..." or href="/assets/...") to relative "./assets/..."
    so that browser asset loading works reliably inside the scoped preview sub-path.
    """
    # Rewrite /assets/... -> ./assets/...
    html_text = re.sub(r'(src|href)=["\']/(assets/[^"\']*)["\']', r'\1="./\2"', html_text, flags=re.IGNORECASE)
    # Rewrite /favicon... -> ./favicon...
    html_text = re.sub(r'(src|href)=["\']/(favicon[^"\']*)["\']', r'\1="./\2"', html_text, flags=re.IGNORECASE)
    return html_text


def _inject_html_telemetry_and_base(html_text: str, base_href: str) -> str:
    """
    Injects `<base href="...">` and an iframe telemetry/console capture script into HTML content.
    """
    html_text = _rewrite_asset_paths_for_preview(html_text)

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
        "    if (e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK' || e.target.tagName === 'IMG')) {\n"
        "      var resUrl = e.target.src || e.target.href || 'resource';\n"
        "      send('error', ['Failed to load resource (404/Network Error): ' + resUrl]);\n"
        "      return;\n"
        "    }\n"
        "    var loc = (e.filename || '') + (e.lineno ? ':' + e.lineno : '') + (e.colno ? ':' + e.colno : '');\n"
        "    var stack = e.error && e.error.stack ? '\\n' + e.error.stack : '';\n"
        "    send('error', [(e.message || 'Uncaught Error') + (loc ? ' (' + loc + ')' : '') + stack]);\n"
        "  }, true);\n"
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


def verify_workspace_preview(ws_path: Optional[Path], task_id: str = "") -> Dict[str, Any]:
    """
    Evaluates workspace files to verify preview completeness, build status, and asset integrity.
    Used by both the Preview API and the agent harness `verify_app_preview` tool.
    """
    if not ws_path or not ws_path.exists() or not ws_path.is_dir():
        return {
            "status": "missing_workspace",
            "has_preview": False,
            "entry_point": None,
            "framework": "None",
            "build_status": "none",
            "issues": ["Workspace directory does not exist on disk."],
            "recommendation": "Initialize the workspace files and create a web application entry point."
        }

    # Priority-ordered entry point search (built bundles prioritized over raw templates)
    entry_candidates = [
        "dist/index.html",
        "client/dist/index.html",
        "build/index.html",
        "client/build/index.html",
        "public/index.html",
        "app/dist/index.html",
        "index.html",
        "client/index.html",
        "src/index.html",
        "app/index.html",
        "main.html",
    ]

    available_entry_points: List[str] = []
    primary_entry: Optional[str] = None
    extracted_title: Optional[str] = None

    for candidate in entry_candidates:
        cand_path = (ws_path / candidate).resolve()
        try:
            cand_path.relative_to(ws_path)
            if cand_path.exists() and cand_path.is_file():
                available_entry_points.append(candidate)
                if not primary_entry:
                    primary_entry = candidate
                    extracted_title = _extract_html_title(cand_path)
        except ValueError:
            continue

    # Fallback search for any html file
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

    # Framework & source discovery
    has_package_json = (ws_path / "package.json").exists() or (ws_path / "client" / "package.json").exists()
    has_vite = (ws_path / "vite.config.js").exists() or (ws_path / "client" / "vite.config.js").exists() or (ws_path / "vite.config.ts").exists() or (ws_path / "client" / "vite.config.ts").exists()
    has_dist = (ws_path / "dist" / "index.html").exists() or (ws_path / "client" / "dist" / "index.html").exists() or (ws_path / "build" / "index.html").exists()

    # Find dist entry path and mtime if dist exists
    dist_entry_path: Optional[Path] = None
    dist_mtime: Optional[float] = None
    for cand in ["dist/index.html", "client/dist/index.html", "build/index.html", "client/build/index.html"]:
        p = ws_path / cand
        if p.exists() and p.is_file():
            dist_entry_path = p
            dist_mtime = p.stat().st_mtime
            break

    # Scan for latest modification timestamp across source files
    max_src_mtime = 0.0
    ignored_subdirs = {".git", "node_modules", "dist", "build", ".next", "venv", "__pycache__", ".pytest_cache"}
    for root, dirs, files in os.walk(ws_path):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ignored_subdirs]
        for f in files:
            if f.startswith("."):
                continue
            ext = Path(f).suffix.lower()
            if ext in {".jsx", ".tsx", ".js", ".ts", ".mjs", ".css", ".html", ".htm", ".json", ".vue", ".svelte"}:
                fp = Path(root) / f
                try:
                    if f in ("package-lock.json", "yarn.lock", "pnpm-lock.yaml"):
                        continue
                    m = fp.stat().st_mtime
                    if m > max_src_mtime:
                        max_src_mtime = m
                except Exception:
                    pass

    is_stale = False
    if dist_mtime and max_src_mtime > 0 and (max_src_mtime > dist_mtime + 1.0):
        is_stale = True

    build_timestamp = int(dist_mtime * 1000) if dist_mtime else (int(max_src_mtime * 1000) if max_src_mtime > 0 else None)
    
    has_jsx_tsx = False
    for root, dirs, files in os.walk(ws_path):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "venv", "__pycache__", ".git")]
        if any(f.endswith((".jsx", ".tsx")) for f in files):
            has_jsx_tsx = True
            break

    framework = "Static Web"
    if has_vite or (has_package_json and has_jsx_tsx):
        framework = "React (Vite)" if has_vite else "React / Single Page App"
    elif (ws_path / "requirements.txt").exists() or (ws_path / "pyproject.toml").exists():
        framework = "Python Backend API"

    asset_extensions = {".html", ".htm", ".css", ".js", ".mjs", ".jsx", ".ts", ".tsx", ".svg", ".png", ".jpg", ".jpeg", ".json", ".wasm"}
    assets_count = 0
    for root, dirs, files in os.walk(ws_path):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "venv", "__pycache__", ".git")]
        for f in files:
            if Path(f).suffix.lower() in asset_extensions:
                assets_count += 1

    issues: List[str] = []
    recommendation = "Preview is verified and ready to render."
    build_status = "static"

    if not primary_entry:
        if has_package_json and has_jsx_tsx:
            return {
                "status": "needs_build",
                "has_preview": False,
                "entry_point": None,
                "available_entry_points": [],
                "assets_count": assets_count,
                "framework": framework,
                "build_status": "needs_build",
                "is_stale": True,
                "build_timestamp": build_timestamp,
                "issues": ["Frontend source code found (React/Vite) but no built index.html or dist bundle exists."],
                "recommendation": "Execute 'npm run build' (or 'cd client && npm run build') to compile production dist/index.html bundle."
            }

        # Check if unlinked standalone CSS/JS assets exist
        has_unlinked_assets = False
        for root, dirs, files in os.walk(ws_path):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "venv", "__pycache__", ".git")]
            if any(f.endswith((".js", ".mjs", ".css")) for f in files):
                has_unlinked_assets = True
                break

        if has_unlinked_assets:
            return {
                "status": "unlinked_assets",
                "has_preview": False,
                "entry_point": None,
                "available_entry_points": [],
                "assets_count": assets_count,
                "framework": "Standalone Web Assets",
                "build_status": "missing_host_html",
                "is_stale": True,
                "build_timestamp": build_timestamp,
                "issues": ["CSS and JavaScript assets exist on disk but no host index.html entry point links them."],
                "recommendation": "Create a root index.html linking the discovered stylesheet and script files."
            }

        return {
            "status": "missing_entry_point",
            "has_preview": False,
            "entry_point": None,
            "available_entry_points": [],
            "assets_count": assets_count,
            "framework": framework,
            "build_status": "none",
            "is_stale": False,
            "build_timestamp": build_timestamp,
            "issues": ["No index.html file found in workspace."],
            "recommendation": "Create a root index.html or compile frontend client."
        }

    # Inspect the entry point
    entry_file = ws_path / primary_entry
    html_text = ""
    try:
        html_text = entry_file.read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        issues.append(f"Could not read entry point '{primary_entry}': {e}")

    # Detect uncompiled development template (e.g. <script type="module" src="/src/main.jsx"> when no dist exists)
    is_uncompiled_template = bool(re.search(r'<script[^>]+src=["\']/?src/main\.(jsx|tsx|ts)["\']', html_text, re.IGNORECASE))

    if is_uncompiled_template and not has_dist:
        issues.append(f"Entry point '{primary_entry}' is an uncompiled development template referencing raw '/src/main.jsx' without a production build.")
        recommendation = "Execute 'npm run build' (or 'cd client && npm run build') to generate compiled bundle, or write a self-contained single-page application."
        build_status = "needs_build"
        return {
            "status": "needs_build",
            "has_preview": True,
            "entry_point": primary_entry,
            "available_entry_points": available_entry_points,
            "assets_count": assets_count,
            "title": extracted_title or "App Preview",
            "framework": framework,
            "build_status": build_status,
            "is_stale": True,
            "build_timestamp": build_timestamp,
            "issues": issues,
            "recommendation": recommendation
        }

    # Inspect linked stylesheets and script assets for bundle integrity
    css_links = re.findall(r'<link[^>]+href=["\']([^"\']+\.css(?:\?[^"\']*)?)["\']', html_text, re.IGNORECASE)
    js_scripts = re.findall(r'<script[^>]+src=["\']([^"\']+\.(?:js|mjs)(?:\?[^"\']*)?)["\']', html_text, re.IGNORECASE)

    uncompiled_styling = False
    for css_ref in css_links:
        clean_ref = css_ref.split('?')[0].lstrip('./').lstrip('/')
        # Look relative to entry_file dir and workspace root
        css_path = entry_file.parent / clean_ref
        if not css_path.exists():
            css_path = ws_path / clean_ref
        
        if css_path.exists() and css_path.is_file():
            try:
                css_content = css_path.read_text(encoding="utf-8", errors="ignore")
                # Detect uncompiled directives like raw @tailwind or @apply that browsers cannot interpret natively
                if re.search(r'@tailwind\s+(base|components|utilities)', css_content) or re.search(r'@apply\s+[\w\-]+', css_content):
                    uncompiled_styling = True
                    issues.append(f"Stylesheet '{clean_ref}' contains uncompiled styling directives (@tailwind / @apply).")
            except Exception as e:
                logger.debug(f"Could not read stylesheet {css_path}: {e}")
        else:
            issues.append(f"Linked stylesheet '{css_ref}' was not found on disk.")

    # Also check any generated CSS in dist/assets or client/dist/assets
    assets_dirs = [ws_path / "dist" / "assets", ws_path / "client" / "dist" / "assets", ws_path / "build" / "assets"]
    for a_dir in assets_dirs:
        if a_dir.exists() and a_dir.is_dir():
            for f in a_dir.glob("*.css"):
                try:
                    css_c = f.read_text(encoding="utf-8", errors="ignore")
                    if re.search(r'@tailwind\s+(base|components|utilities)', css_c):
                        uncompiled_styling = True
                        issues.append(f"Compiled asset '{f.name}' contains uncompiled '@tailwind' directives.")
                except Exception:
                    pass

    if uncompiled_styling:
        recommendation = "Verify CSS bundler plugins (e.g. Vite Tailwind/PostCSS configuration) and rebuild with 'npm run build' so styling directives are compiled into standard CSS."
        return {
            "status": "uncompiled_css",
            "has_preview": True,
            "entry_point": primary_entry,
            "available_entry_points": available_entry_points,
            "assets_count": assets_count,
            "title": extracted_title or "App Preview",
            "framework": framework,
            "build_status": "uncompiled_css",
            "is_stale": is_stale,
            "build_timestamp": build_timestamp,
            "issues": issues,
            "recommendation": recommendation
        }

    # Stale build check: If source files were edited after dist was built
    if is_stale:
        issues.append("Source files were modified after the last production build (stale dist bundle).")
        recommendation = "Execute 'npm run build' (or 'cd client && npm run build') to compile the latest source changes into the live preview bundle."
        return {
            "status": "needs_rebuild",
            "has_preview": True,
            "entry_point": primary_entry,
            "available_entry_points": available_entry_points,
            "assets_count": assets_count,
            "title": extracted_title or "App Preview",
            "framework": framework,
            "build_status": "stale",
            "is_stale": True,
            "build_timestamp": build_timestamp,
            "issues": issues,
            "recommendation": recommendation
        }

    if has_dist:
        build_status = "compiled"

    return {
        "status": "ready" if not issues else "issues_found",
        "has_preview": True,
        "entry_point": primary_entry,
        "available_entry_points": available_entry_points,
        "assets_count": assets_count,
        "title": extracted_title or "App Preview",
        "framework": framework,
        "build_status": build_status,
        "is_stale": False,
        "build_timestamp": build_timestamp,
        "issues": issues,
        "recommendation": recommendation
    }


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
    verification = verify_workspace_preview(ws_path, task_id)

    if not ws_path or not verification.get("has_preview"):
        pkg_json_file = (ws_path / "package.json") if ws_path else None
        has_package_json = pkg_json_file and pkg_json_file.exists() and pkg_json_file.is_file()
        if has_package_json:
            return {
                "has_preview": True,
                "type": "dev_server",
                "entry_point": "package.json",
                "title": task.title or "Dev Server App",
                "framework": verification.get("framework", "Node.js"),
                "build_status": "needs_build",
                "assets_count": 0,
                "available_entry_points": [],
                "preview_url": None,
                "issues": verification.get("issues", []),
                "recommendation": verification.get("recommendation", "")
            }
        return {
            "has_preview": False,
            "type": None,
            "entry_point": None,
            "title": None,
            "framework": None,
            "build_status": "none",
            "assets_count": 0,
            "available_entry_points": [],
            "preview_url": None,
            "issues": verification.get("issues", []),
            "recommendation": verification.get("recommendation", "")
        }

    entry = verification.get("entry_point")
    available_entries = verification.get("available_entry_points", [])

    return {
        "has_preview": True,
        "type": "static",
        "entry_point": entry,
        "title": verification.get("title") or task.title or "App Preview",
        "framework": verification.get("framework"),
        "build_status": verification.get("build_status", "static"),
        "is_stale": verification.get("is_stale", False),
        "build_timestamp": verification.get("build_timestamp"),
        "assets_count": verification.get("assets_count", len(available_entries)),
        "available_entry_points": available_entries,
        "preview_url": f"/api/tasks/{task_id}/preview/{entry}" if entry else None,
        "issues": verification.get("issues", []),
        "recommendation": verification.get("recommendation", "")
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
            "build_status": "none",
            "files": [],
            "suggestions": ["Task workspace has not been created on disk yet."]
        }

    verification = verify_workspace_preview(ws_path, task_id)

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
                    "is_entry": rel in ["index.html", "public/index.html", "dist/index.html", "client/dist/index.html"]
                })
            except Exception:
                continue

    framework = verification.get("framework", "Static Web")
    suggestions = list(verification.get("issues", []))
    if verification.get("recommendation"):
        suggestions.append(verification["recommendation"])

    return {
        "task_id": task_id,
        "workspace_exists": True,
        "framework": framework,
        "build_status": verification.get("build_status", "static"),
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

    # Smart fallback / compiled bundle preference
    # If client/index.html or index.html is requested but a compiled bundle exists at client/dist/index.html or dist/index.html:
    if clean_rel in ["client/index.html", "index.html"]:
        if (ws_path / "client" / "dist" / "index.html").exists() and clean_rel == "client/index.html":
            clean_rel = "client/dist/index.html"
        elif (ws_path / "dist" / "index.html").exists() and clean_rel == "index.html":
            clean_rel = "dist/index.html"

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
        # Check dist/index.html first, then index.html
        if (target_file / "dist" / "index.html").exists():
            target_file = target_file / "dist" / "index.html"
        elif (target_file / "index.html").exists():
            target_file = target_file / "index.html"
        else:
            diag_html = _generate_diagnostic_html(task_id, task.title or "Preview", ws_path)
            return Response(content=diag_html, media_type="text/html; charset=utf-8", headers=headers)

    # If index.html requested but does not exist on disk, render diagnostic landing page!
    if not target_file.exists() or not target_file.is_file():
        if clean_rel in ["index.html", "public/index.html", "client/index.html"]:
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
            parent_rel = str(target_file.parent.relative_to(ws_path)).replace("\\", "/")
            if parent_rel == ".":
                base_href = f"/api/tasks/{task_id}/preview/"
            else:
                base_href = f"/api/tasks/{task_id}/preview/{parent_rel}/"

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
