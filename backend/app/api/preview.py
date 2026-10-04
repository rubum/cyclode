import os
import re
import mimetypes
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List, Set, Tuple
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
        "  window.addEventListener('load', function() {\n"
        "    try {\n"
        "      var canvases = document.querySelectorAll('canvas');\n"
        "      for (var i = 0; i < canvases.length; i++) {\n"
        "        var cvs = canvases[i];\n"
        "        var parent = cvs.parentElement;\n"
        "        if (cvs.clientWidth === 0 || cvs.clientHeight === 0 || (parent && parent.clientHeight === 0 && parent.tagName !== 'BODY')) {\n"
        "          var targetId = cvs.id || (parent ? parent.id : '') || ('canvas-' + i);\n"
        "          send('error', ['[CYCLODE_PREVIEW_ERROR] Canvas or mount container #' + targetId + ' has 0px computed dimensions. Ensure width and height are defined in CSS (e.g. width: 100%; height: 100%; position: absolute;).']);\n"
        "        }\n"
        "      }\n"
        "      var hiddens = document.querySelectorAll('.hidden');\n"
        "      for (var j = 0; j < hiddens.length; j++) {\n"
        "        var el = hiddens[j];\n"
        "        var compDisplay = window.getComputedStyle(el).display;\n"
        "        if (compDisplay !== 'none') {\n"
        "          var elDesc = el.id ? ('#' + el.id) : (el.tagName.toLowerCase() + '.' + (el.className.split(' ').join('.')));\n"
        "          send('warn', ['[CYCLODE_PREVIEW_WARNING] Element ' + elDesc + ' has class=\"hidden\" but computed display is \"' + compDisplay + '\". Missing global .hidden { display: none !important; } in CSS.']);\n"
        "        }\n"
        "      }\n"
        "    } catch (e) {}\n"
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


inject_preview_telemetry = _inject_html_telemetry_and_base


def _extract_declared_html_ids(html_text: str) -> Set[str]:
    """
    Extracts all declared element IDs from HTML markup.
    """
    ids: Set[str] = set()
    for m in re.finditer(r'\bid=["\']([a-zA-Z0-9_\-]+)["\']', html_text, re.IGNORECASE):
        ids.add(m.group(1))
    return ids


def _extract_js_queried_ids(js_text: str) -> Set[str]:
    """
    Extracts all element IDs queried by JavaScript via getElementById, querySelector('#...'), etc.
    """
    queried: Set[str] = set()
    # document.getElementById('id') or container.getElementById("id")
    for m in re.finditer(r'\b(?:document|window|el|container|parent|root)\.getElementById\s*\(\s*["\'`]([a-zA-Z0-9_\-]+)["\'`]\s*\)', js_text):
        queried.add(m.group(1))
    # querySelector('#id') or querySelectorAll('#id')
    for m in re.finditer(r'\.querySelector(?:All)?\s*\(\s*["\'`]#([a-zA-Z0-9_\-]+)["\'`]\s*\)', js_text):
        queried.add(m.group(1))
    # $('#id') or jQuery('#id')
    for m in re.finditer(r'\b(?:\$|jQuery)\s*\(\s*["\'`]#([a-zA-Z0-9_\-]+)["\'`]\s*\)', js_text):
        queried.add(m.group(1))
    return queried


def _validate_dom_js_contract(html_text: str, combined_js: str, primary_entry: str) -> List[str]:
    """
    Cross-validates element IDs queried in JavaScript against element IDs declared in HTML.
    Detects selector drift and missing DOM nodes that cause null pointer crashes at runtime.
    """
    issues: List[str] = []
    if not html_text or not combined_js:
        return issues

    declared_ids = _extract_declared_html_ids(html_text)

    # Include IDs created inside JS string/template literals (e.g. innerHTML = `<div id="xyz">`)
    for m in re.finditer(r'\bid=["\']([a-zA-Z0-9_\-]+)["\']', combined_js):
        declared_ids.add(m.group(1))
    for m in re.finditer(r'\.id\s*=\s*["\'`]([a-zA-Z0-9_\-]+)["\'`]', combined_js):
        declared_ids.add(m.group(1))
    for m in re.finditer(r'setAttribute\s*\(\s*["\'`]id["\'`]\s*,\s*["\'`]([a-zA-Z0-9_\-]+)["\'`]\s*\)', combined_js):
        declared_ids.add(m.group(1))

    queried_ids = _extract_js_queried_ids(combined_js)

    # Standard browser / framework synthetic root IDs that might be dynamically generated
    whitelisted_ids = {"app", "root", "container", "main", "canvas", "game", "viewport"}

    for q_id in sorted(queried_ids):
        if q_id not in declared_ids and q_id not in whitelisted_ids:
            issues.append(
                f"DOM Contract Violation: JavaScript references element ID '#{q_id}' via getElementById/querySelector, but no element with id='{q_id}' exists in '{primary_entry}'."
            )

    return issues


def _validate_interactive_buttons(html_text: str, combined_js: str, primary_entry: str) -> List[str]:
    """
    Checks whether interactive button and form elements in HTML have corresponding event listeners or handlers wired in JavaScript.
    Flags dead/unresponsive UI buttons.
    """
    issues: List[str] = []
    if not html_text:
        return issues

    # If framework detected (Vue, React, Alpine, Svelte), bindings are handled by components
    has_framework = bool(re.search(r'createApp|createRoot|React|ReactDOM|Alpine|Vue|svelte', combined_js, re.IGNORECASE))
    if has_framework:
        return issues

    # Global delegation listener in JS (e.g. document.addEventListener('click', ...)) covers all buttons
    has_global_click_delegation = bool(re.search(r'\b(?:document|window)\.addEventListener\s*\(\s*["\'`]click["\'`]', combined_js, re.IGNORECASE))
    if has_global_click_delegation:
        return issues

    # Extract all button tags
    button_matches = re.finditer(r'<button\b([^>]*)>(.*?)</button>', html_text, re.IGNORECASE | re.DOTALL)
    for m in button_matches:
        attrs = m.group(1)
        inner = m.group(2)
        btn_text = re.sub(r'<[^>]+>', '', inner).strip() or "Action"

        # Check inline handlers
        has_inline_handler = bool(re.search(r'\b(?:onclick|@click|v-on:click|onClick|data-action)\s*=', attrs, re.IGNORECASE))
        if has_inline_handler:
            continue

        # Check if type="submit" or type="reset" inside a form
        btn_type = re.search(r'\btype=["\']([^"\']+)["\']', attrs, re.IGNORECASE)
        if btn_type and btn_type.group(1).lower() in ("submit", "reset"):
            has_form_submit = bool(re.search(r'addEventListener\s*\(\s*["\'`]submit["\'`]|onsubmit\s*=', combined_js, re.IGNORECASE))
            if has_form_submit:
                continue

        # Extract ID
        btn_id_match = re.search(r'\bid=["\']([^"\']+)["\']', attrs, re.IGNORECASE)
        btn_id = btn_id_match.group(1) if btn_id_match else None

        # Extract classes
        btn_class_match = re.search(r'\bclass=["\']([^"\']+)["\']', attrs, re.IGNORECASE)
        btn_classes = btn_class_match.group(1).split() if btn_class_match else []

        # Check if button ID is referenced in JS
        is_id_handled = False
        if btn_id and combined_js:
            is_id_handled = bool(re.search(rf'\b{re.escape(btn_id)}\b', combined_js))

        # Check if button class is queried in JS
        is_class_handled = False
        if combined_js:
            for c in btn_classes:
                if len(c) > 2 and not c.startswith(("px-", "py-", "bg-", "text-", "font-", "rounded", "flex", "grid", "border", "hover:", "active:", "focus:")):
                    if re.search(rf'\.{re.escape(c)}\b|getElementsByClassName\s*\(\s*["\'`]{re.escape(c)}["\'`]', combined_js):
                        is_class_handled = True
                        break

        if not is_id_handled and not is_class_handled:
            btn_desc = f"#{btn_id}" if btn_id else f"'{btn_text[:25]}'"
            issues.append(
                f"Dead UI Button Detected: Button {btn_desc} in '{primary_entry}' has no event listeners or click handlers wired in JavaScript."
            )

    return issues


def _validate_canvas_and_state(html_text: str, combined_js: str, primary_entry: str) -> List[str]:
    """
    Validates that canvas elements have 2D/WebGL context initialization, animation loops,
    and semantic scene completeness (detecting empty/minimal 'Hello World' stubs).
    """
    issues: List[str] = []
    if "<canvas" in html_text.lower():
        has_canvas_ctx = bool(re.search(r'\.getContext\s*\(\s*["\'`](2d|webgl|webgl2|bitmaprenderer)["\'`]\s*\)|THREE\.|PIXI\.|createCanvas|new\s+p5\b', combined_js, re.IGNORECASE))
        has_loop = bool(re.search(r'requestAnimationFrame|setInterval|render\s*\(|animate\s*\(', combined_js, re.IGNORECASE))

        if not has_canvas_ctx:
            issues.append(
                f"Canvas Context Issue: '<canvas>' element is declared in '{primary_entry}', but no 2D/WebGL rendering context (.getContext('2d')) is initialized in JavaScript."
            )
        elif not has_loop:
            issues.append(
                f"Canvas Animation Loop Issue: '<canvas>' rendering context initialized in JavaScript, but no render/animation loop (requestAnimationFrame) is started."
            )

        # Semantic Anti-Stub Verification for 3D / WebGL Scenes
        is_three_js = bool(re.search(r'\bTHREE\b', combined_js))
        if is_three_js:
            has_lights = bool(re.search(r'THREE\.(AmbientLight|DirectionalLight|PointLight|SpotLight|HemisphereLight|RectAreaLight)', combined_js))
            has_controls = bool(re.search(r'OrbitControls|PointerLockControls|TrackballControls|FlyControls|addEventListener\s*\(\s*["\'](?:mousemove|mousedown|pointerdown|pointermove|keydown|wheel)["\']', combined_js, re.IGNORECASE))
            geometries = re.findall(r'THREE\.(?:[A-Z][a-zA-Z0-9]+Geometry)\b', combined_js)
            has_instancing = bool(re.search(r'InstancedMesh|Group\b|Object3D\b', combined_js))
            has_ui_overlay = bool(re.search(r'<(?:button|input|select|textarea|form|nav|header|aside)\b|class=["\'][^"\']*(?:hud|dashboard|controls|overlay|panel|stats|toolbar)[^"\']*["\']', html_text, re.IGNORECASE))

            # Detect solitary BoxGeometry or single primitive with no lights, no controls, and no UI
            if len(geometries) <= 1 and not has_lights and not has_controls and not has_ui_overlay and not has_instancing:
                issues.append(
                    f"Canvas Semantic Incompleteness: 3D scene in '{primary_entry}' contains only a solitary primitive mesh with no scene lighting, camera controls (OrbitControls), or interactive UI overlay. Implement complete domain-specific scene elements, lighting, camera navigation, and interactive controls."
                )
    return issues


def _validate_script_syntax_balance(combined_js: str, primary_entry: str) -> List[str]:
    """
    Validates bracket and parenthesis balance in JavaScript to catch truncation and syntax breaks.
    """
    issues: List[str] = []
    if not combined_js:
        return issues

    # Strip string literals and comments to count structural braces
    sanitized = re.sub(r'//.*', '', combined_js)
    sanitized = re.sub(r'/\*[\s\S]*?\*/', '', sanitized)
    sanitized = re.sub(r'"(?:[^"\\]|\\.)*"', '""', sanitized)
    sanitized = re.sub(r"'(?:[^'\\]|\\.)*'", "''", sanitized)
    sanitized = re.sub(r'`(?:[^`\\]|\\.)*`', '``', sanitized)

    open_curly = sanitized.count('{')
    close_curly = sanitized.count('}')
    open_paren = sanitized.count('(')
    close_paren = sanitized.count(')')

    if abs(open_curly - close_curly) >= 2:
        issues.append(
            f"JavaScript Syntax Warning: Unmatched curly braces in '{primary_entry}' scripts (opened {open_curly}, closed {close_curly}). Verify complete function closures."
        )
    if abs(open_paren - close_paren) >= 2:
        issues.append(
            f"JavaScript Syntax Warning: Unmatched parentheses in '{primary_entry}' scripts (opened {open_paren}, closed {close_paren}). Verify complete function calls."
        )

    return issues


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
        "build/web/index.html",
        "build/dist/wasmJs/productionExecutable/index.html",
        "build/dist/wasmJs/developmentExecutable/index.html",
        "Bundle/index.html",
        ".build/carton/index.html",
        ".build/wasm32-unknown-wasi/release/Bundle/index.html",
        "public/index.html",
        "app/dist/index.html",
        "web/index.html",
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
    has_flutter = (ws_path / "pubspec.yaml").exists() or (ws_path / "build" / "web" / "index.html").exists()
    has_gradle_kts = (ws_path / "build.gradle.kts").exists() or (ws_path / "settings.gradle.kts").exists()
    has_swift_pkg = (ws_path / "Package.swift").exists() or (ws_path / "Bundle" / "index.html").exists()

    has_dist = (
        (ws_path / "dist" / "index.html").exists()
        or (ws_path / "client" / "dist" / "index.html").exists()
        or (ws_path / "build" / "index.html").exists()
        or (ws_path / "build" / "web" / "index.html").exists()
        or (ws_path / "build" / "dist" / "wasmJs" / "productionExecutable" / "index.html").exists()
        or (ws_path / "Bundle" / "index.html").exists()
    )

    # Find dist entry path and mtime if dist exists
    dist_entry_path: Optional[Path] = None
    dist_mtime: Optional[float] = None
    for cand in [
        "dist/index.html",
        "client/dist/index.html",
        "build/index.html",
        "client/build/index.html",
        "build/web/index.html",
        "build/dist/wasmJs/productionExecutable/index.html",
        "Bundle/index.html"
    ]:
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
            if ext in {".jsx", ".tsx", ".js", ".ts", ".mjs", ".css", ".html", ".htm", ".json", ".vue", ".svelte", ".dart", ".swift", ".kt", ".kts"}:
                fp = Path(root) / f
                try:
                    if f in ("package-lock.json", "yarn.lock", "pnpm-lock.yaml", "pubspec.lock"):
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
    if has_flutter:
        framework = "Flutter Web"
    elif has_gradle_kts:
        framework = "Compose Multiplatform (Kotlin/Wasm)"
    elif has_swift_pkg:
        framework = "SwiftWasm"
    elif has_vite or (has_package_json and has_jsx_tsx):
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

    # Check for empty DOM shell where JS does not mount any UI
    clean_body = re.sub(r'<script[\s\S]*?</script>', '', html_text, flags=re.IGNORECASE)
    clean_body = re.sub(r'<style[\s\S]*?</style>', '', clean_body, flags=re.IGNORECASE)
    stripped_dom = re.sub(r'<[^>]+>', '', clean_body).strip()
    has_interactive_dom = bool(re.search(r'<(button|input|select|textarea|canvas|form|table|ul|ol|h[1-6]|p|a|svg|main|section|article|nav|header|footer)\b', clean_body, re.IGNORECASE))

    has_dom_mounting = False
    root_mount_patterns = [
        r"createApp\b",
        r"createRoot\b",
        r"ReactDOM\.render\b",
        r"Alpine\.start\b",
        r"document\.(?:getElementById|querySelector)\s*\(\s*['\"](?:#?app|#?root|#?container|#?main)['\"]\s*\)\s*\.(?:innerHTML|replaceChildren|appendChild)",
        r"document\.body\.(?:innerHTML|appendChild|replaceChildren)",
        r"function\s+render\b",
        r"const\s+render\s*=",
        r"let\s+render\s*=",
        r"\brenderApp\b",
        r"\bmountApp\b"
    ]
    for js_ref in js_scripts:
        clean_js = js_ref.split('?')[0].lstrip('./').lstrip('/')
        js_path = entry_file.parent / clean_js
        if not js_path.exists():
            js_path = ws_path / clean_js
        if js_path.exists() and js_path.is_file():
            try:
                js_txt = js_path.read_text(encoding="utf-8", errors="ignore")
                if any(re.search(p, js_txt, re.IGNORECASE) for p in root_mount_patterns):
                    has_dom_mounting = True
                    break
            except Exception:
                pass

    inline_scripts = re.findall(r'<script\b[^>]*>([\s\S]*?)</script>', html_text, re.IGNORECASE)
    for scr in inline_scripts:
        if any(re.search(p, scr, re.IGNORECASE) for p in root_mount_patterns):
            has_dom_mounting = True
            break

    if not has_interactive_dom and not has_dom_mounting and len(stripped_dom) < 20 and not has_dist:
        issues.append("HTML entry point contains an empty container (<div id=\"app\">) with no interactive DOM elements, and linked scripts do not mount any UI.")
        recommendation = "Implement the UI components, interactive DOM buttons, displays, or JavaScript mounting logic to render the application interface."
        return {
            "status": "empty_ui",
            "has_preview": True,
            "entry_point": primary_entry,
            "available_entry_points": available_entry_points,
            "assets_count": assets_count,
            "title": extracted_title or "App Preview",
            "framework": framework,
            "build_status": "empty_ui",
            "is_stale": True,
            "build_timestamp": build_timestamp,
            "issues": issues,
            "recommendation": recommendation
        }

    # Gather combined CSS text from linked stylesheets and inline <style> blocks
    all_css_chunks = []
    for inline_style in re.findall(r'<style\b[^>]*>([\s\S]*?)</style>', html_text, re.IGNORECASE):
        all_css_chunks.append(inline_style)

    for css_ref in css_links:
        clean_ref = css_ref.split('?')[0].lstrip('./').lstrip('/')
        css_path = entry_file.parent / clean_ref
        if not css_path.exists():
            css_path = ws_path / clean_ref
        if css_path.exists() and css_path.is_file():
            try:
                all_css_chunks.append(css_path.read_text(encoding="utf-8", errors="ignore"))
            except Exception:
                pass
    combined_css = "\n".join(all_css_chunks)

    # 1. Global .hidden rule validation
    uses_hidden_class = bool(re.search(r'\bclass=["\'][^"\']*\bhidden\b[^"\']*["\']', html_text, re.IGNORECASE))
    if uses_hidden_class:
        has_global_hidden = bool(re.search(r'(?<![a-zA-Z0-9_\-\.#])\.hidden\s*\{[^}]*display\s*:\s*none', combined_css, re.IGNORECASE))
        has_css_utility_framework = bool(re.search(r'tailwindcss|bootstrap|uno\.css', html_text, re.IGNORECASE))
        if not has_global_hidden and not has_css_utility_framework and not has_dist:
            issues.append("HTML elements use class='hidden' but no global '.hidden { display: none !important; }' rule exists in CSS.")

    # 2. Canvas mount container dimension & selector check
    canvas_container_matches = re.findall(r'<div\s+[^>]*id=["\']([^"\']*(?:game|canvas|scene|render|webgl|viewport|stage|world)[^"\']*)["\']', html_text, re.IGNORECASE)
    for cont_id in canvas_container_matches:
        has_container_css = bool(re.search(rf'#{re.escape(cont_id)}\s*\{{[^}}]*\b(width|height|position|inset|top|bottom|left|right)\s*:', combined_css, re.IGNORECASE))
        other_container_in_css = re.findall(r'#([a-zA-Z0-9_\-]+(?:container|viewport|canvas|game|stage))\s*\{', combined_css, re.IGNORECASE)
        mismatched_css_selectors = [c for c in other_container_in_css if c != cont_id and not re.search(rf'id=["\']{re.escape(c)}["\']', html_text, re.IGNORECASE)]
        
        if not has_container_css and mismatched_css_selectors and not has_dist:
            issues.append(f"Canvas container ID mismatch: HTML declares '<div id=\"{cont_id}\">' but CSS styles '#{mismatched_css_selectors[0]}'. The viewport will collapse to 0x0.")
        elif not has_container_css and not has_dist:
            has_inline_style = bool(re.search(rf'<div\s+[^>]*id=["\']{re.escape(cont_id)}["\'][^>]*style=["\'][^"\']*\b(width|height|position)\b', html_text, re.IGNORECASE))
    # 3. Unstyled DOM / Missing CSS Engine Check
    has_css_engine = (
        bool(combined_css.strip())
        or bool(re.search(r'tailwindcss|bootstrap|uno\.css|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com', html_text, re.IGNORECASE))
        or bool(re.search(r'<style\b', html_text, re.IGNORECASE))
        or len(css_links) > 0
        or has_dist
    )
    if not has_css_engine and len(stripped_dom) > 60:
        issues.append("HTML document contains DOM layout elements but no CSS stylesheets, <style> tags, or Tailwind CSS CDN scripts (<script src='https://cdn.tailwindcss.com'></script>) are linked. The page will render unstyled default browser HTML.")

    # Gather combined JavaScript text from inline <script> tags, linked scripts, and workspace JS files
    all_js_chunks = []
    for inline_scr in re.findall(r'<script\b[^>]*>([\s\S]*?)</script>', html_text, re.IGNORECASE):
        if inline_scr.strip():
            all_js_chunks.append(inline_scr)

    for js_ref in js_scripts:
        clean_ref = js_ref.split('?')[0].lstrip('./').lstrip('/')
        js_path = entry_file.parent / clean_ref
        if not js_path.exists():
            js_path = ws_path / clean_ref
        if js_path.exists() and js_path.is_file():
            try:
                all_js_chunks.append(js_path.read_text(encoding="utf-8", errors="ignore"))
            except Exception:
                pass

    if not has_dist:
        js_folder = ws_path / "js"
        if js_folder.exists() and js_folder.is_dir():
            for f in js_folder.glob("*.js"):
                try:
                    all_js_chunks.append(f.read_text(encoding="utf-8", errors="ignore"))
                except Exception:
                    pass
        for f in ws_path.glob("*.js"):
            if f.name not in ("vite.config.js", "tailwind.config.js", "postcss.config.js"):
                try:
                    all_js_chunks.append(f.read_text(encoding="utf-8", errors="ignore"))
                except Exception:
                    pass

    combined_js = "\n".join(all_js_chunks)

    # 4. DOM-to-JS Element Contract Cross-Validation
    if not has_dist and combined_js:
        dom_contract_issues = _validate_dom_js_contract(html_text, combined_js, primary_entry)
        issues.extend(dom_contract_issues)

        # 5. Interactive Button & Event Wiring Validation
        dead_button_issues = _validate_interactive_buttons(html_text, combined_js, primary_entry)
        issues.extend(dead_button_issues)

        # 6. Canvas Mount & Animation Loop Validation
        canvas_issues = _validate_canvas_and_state(html_text, combined_js, primary_entry)
        issues.extend(canvas_issues)

        # 7. Script Syntax Balance Check
        syntax_issues = _validate_script_syntax_balance(combined_js, primary_entry)
        issues.extend(syntax_issues)

    has_dom_css_issues = any("Canvas container" in iss or "HTML elements use class='hidden'" in iss or "Canvas mount container" in iss for iss in issues)
    has_uncompiled_css = any("no CSS stylesheets" in iss or "uncompiled '@tailwind'" in iss for iss in issues)
    has_js_dom_mismatch = any("DOM Contract Violation" in iss for iss in issues)
    has_dead_buttons = any("Dead UI Button" in iss for iss in issues)
    has_semantic_stub = any("Canvas Semantic Incompleteness" in iss for iss in issues)
    has_canvas_issues = any("Canvas Context Issue" in iss or "Canvas Animation Loop" in iss for iss in issues)
    has_syntax_issues = any("JavaScript Syntax" in iss for iss in issues)

    if has_uncompiled_css:
        status_code = "uncompiled_css"
        recommendation = "Link Tailwind CSS (<script src='https://cdn.tailwindcss.com'></script>) or embed comprehensive modern dark theme CSS tokens in <style> to render a styled, professional page."
    elif has_js_dom_mismatch:
        status_code = "js_dom_mismatch"
        recommendation = "Harmonize DOM element IDs between HTML and JavaScript: add missing IDs to HTML elements or update querySelector/getElementById calls in JavaScript."
    elif has_dead_buttons:
        status_code = "dead_buttons"
        recommendation = "Wire up active click event listeners (addEventListener('click', ...)) or inline onclick handlers for all interactive buttons in the application."
    elif has_semantic_stub:
        status_code = "minimal_canvas_stub"
        recommendation = "Develop the full 3D domain environment with concrete geometries, lighting (e.g. AmbientLight/DirectionalLight), camera controls (e.g. OrbitControls), and interactive UI overlays."
    elif has_dom_css_issues or has_canvas_issues:
        status_code = "dom_css_mismatch"
        recommendation = "Harmonize DOM element IDs and CSS selectors between index.html and stylesheets, add missing '.hidden { display: none !important; }' utility, and ensure canvas containers are styled with width: 100%; height: 100%; position: absolute;."
    elif has_syntax_issues:
        status_code = "runtime_exception"
        recommendation = "Fix unclosed brackets or syntax errors in JavaScript files and inline script blocks."
    elif issues:
        status_code = "issues_found"
        recommendation = "Resolve the detected workspace preview issues to ensure a fully functional application."
    else:
        status_code = "ready"

    if has_dist:
        build_status = "compiled"
    elif status_code != "ready":
        build_status = status_code
    else:
        build_status = "static"

    return {
        "status": status_code,
        "has_preview": True,
        "entry_point": primary_entry,
        "available_entry_points": available_entry_points,
        "assets_count": assets_count,
        "title": extracted_title or "App Preview",
        "framework": framework,
        "build_status": build_status,
        "is_stale": is_stale,
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


@router.api_route("/{task_id}/preview/proxy/{port}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
@router.api_route("/{task_id}/preview/proxy/{port}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_preview_dev_server(task_id: str, port: int, path: str = "", request: Request = None, db: AsyncSession = Depends(get_db)):
    """
    Reverse proxies HTTP requests to a development server running inside the task container or host port.
    Resolves the container's private bridge IP if container isolation is active.
    """
    import httpx
    from app.core.sandboxes.container.lifecycle import container_lifecycle

    container_ip = await container_lifecycle.get_container_ip(task_id)
    host_target = container_ip if container_ip else "127.0.0.1"
    clean_path = path.lstrip("/") if path else ""
    target_url = f"http://{host_target}:{port}/{clean_path}" if clean_path else f"http://{host_target}:{port}/"
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
            detail=f"Unable to connect to development server on {host_target}:{port}. Please ensure the server is running."
        )
    except Exception as e:
        logger.error(f"Dev server proxy error on port {port}: {e}")
        raise HTTPException(status_code=500, detail=f"Dev server proxy error: {str(e)}")
