import os
import sys
import time
import threading
import webbrowser
from typing import Optional
from pathlib import Path
import uvicorn
import httpx

from cyclode.config import (
    ensure_cyclode_home,
    sync_builtin_skills,
    resolve_database_url,
    resolve_workspace_root,
    load_user_config,
)


def _wait_and_open_browser(url: str, check_url: str, timeout: float = 12.0):
    start = time.time()
    while time.time() - start < timeout:
        try:
            r = httpx.get(check_url, timeout=1.0)
            if r.status_code == 200:
                time.sleep(0.3)
                webbrowser.open(url)
                return
        except Exception:
            pass
        time.sleep(0.5)


def start_cyclode(
    host: str = "127.0.0.1",
    port: int = 8080,
    workspace: Optional[str] = None,
    reload: bool = False,
    open_browser: bool = True,
    model: Optional[str] = None,
):
    """Initializes environment and boots the Uvicorn ASGI server."""
    # 1. Ensure ~/.cyclode directories & skills
    ensure_cyclode_home()
    sync_builtin_skills()

    # 2. Resolve configuration & environment variables
    user_cfg = load_user_config()
    db_url = resolve_database_url()
    ws_root = resolve_workspace_root(workspace)

    os.environ["DATABASE_URL"] = db_url
    os.environ["WORKSPACE_ROOT"] = ws_root
    os.environ["PORT"] = str(port)
    os.environ["HOST"] = host

    if model:
        os.environ["ANTIGRAVITY_MODEL"] = model
    elif "model" in user_cfg and not os.environ.get("ANTIGRAVITY_MODEL"):
        os.environ["ANTIGRAVITY_MODEL"] = user_cfg["model"]

    if "gemini_api_key" in user_cfg and not os.environ.get("GEMINI_API_KEY"):
        os.environ["GEMINI_API_KEY"] = user_cfg["gemini_api_key"]

    if "deepseek_api_key" in user_cfg and not os.environ.get("DEEPSEEK_API_KEY"):
        os.environ["DEEPSEEK_API_KEY"] = user_cfg["deepseek_api_key"]

    if "deepseek_base_url" in user_cfg and not os.environ.get("DEEPSEEK_BASE_URL"):
        os.environ["DEEPSEEK_BASE_URL"] = user_cfg["deepseek_base_url"]

    if "anthropic_api_key" in user_cfg and not os.environ.get("ANTHROPIC_API_KEY"):
        os.environ["ANTHROPIC_API_KEY"] = user_cfg["anthropic_api_key"]

    if "openai_api_key" in user_cfg and not os.environ.get("OPENAI_API_KEY"):
        os.environ["OPENAI_API_KEY"] = user_cfg["openai_api_key"]

    if "openai_base_url" in user_cfg and not os.environ.get("OPENAI_BASE_URL"):
        os.environ["OPENAI_BASE_URL"] = user_cfg["openai_base_url"]

    if "linear_api_key" in user_cfg and not os.environ.get("LINEAR_API_KEY"):
        os.environ["LINEAR_API_KEY"] = user_cfg["linear_api_key"]

    # 3. Add backend directory to sys.path so app is always importable
    backend_dir = Path(__file__).parent.parent.resolve()
    if str(backend_dir) not in sys.path:
        sys.path.insert(0, str(backend_dir))

    # 4. Schedule browser opening
    display_host = "localhost" if host in ("0.0.0.0", "127.0.0.1") else host
    app_url = f"http://{display_host}:{port}"
    health_url = f"{app_url}/api/health"

    if open_browser and not reload:
        t = threading.Thread(target=_wait_and_open_browser, args=(app_url, health_url), daemon=True)
        t.start()

    # 5. Boot Uvicorn
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info",
    )
