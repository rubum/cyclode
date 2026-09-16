import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import settings
from app.db.session import init_db, async_session_factory
from app.api.websocket import ws_manager
from app.api.webhooks import router as webhooks_router
from app.api.tasks import router as tasks_router
from app.api.events import router as events_router
from app.api.policies import router as policies_router
from app.api.integrations import router as integrations_router
from app.api.automations import router as automations_router, ensure_default_rules
from app.api.repositories import router as repositories_router
from app.api.health import router as health_router
from app.api.reader import router as reader_router
from app.api.linear import router as linear_router
from app.api.preview import router as preview_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize database tables and seed default rules
    await init_db()
    async with async_session_factory() as session:
        await ensure_default_rules(session)
    yield
    # Shutdown: cleanup


app = FastAPI(
    title="Cyclode Platform API",
    description="Event-Driven Autonomous Multi-Agent Orchestrator powered by Antigravity Harness",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API Routers
app.include_router(health_router)
app.include_router(webhooks_router)
app.include_router(tasks_router)
app.include_router(events_router)
app.include_router(policies_router)
app.include_router(integrations_router)
app.include_router(automations_router)
app.include_router(repositories_router)
app.include_router(reader_router)
app.include_router(linear_router)
app.include_router(preview_router)


# WebSocket Gateway
@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle client heartbeats/messages
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


# Mount Static Files in Packaged Wheel, Docker, or Local Monorepo
def _resolve_static_dir() -> Optional[Path]:
    env_dir = os.environ.get("STATIC_DIR") or settings.STATIC_DIR
    if env_dir and Path(env_dir).exists():
        return Path(env_dir)
    candidates = [
        Path(__file__).parent / "static",
        Path(__file__).parent.parent / "cyclode" / "static",
        Path(__file__).parent.parent.parent / "frontend" / "dist",
    ]
    for c in candidates:
        if c.exists() and (c / "index.html").exists():
            return c
    return None


static_dir_path = _resolve_static_dir()
if static_dir_path and static_dir_path.exists():
    assets_dir = static_dir_path / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not Found")

        # Security: Prevent directory traversal outside static directory
        try:
            target_path = (static_dir_path / full_path).resolve()
            if not str(target_path).startswith(str(static_dir_path.resolve())):
                from fastapi import HTTPException
                raise HTTPException(status_code=403, detail="Forbidden")
        except Exception:
            from fastapi import HTTPException
            raise HTTPException(status_code=403, detail="Forbidden")

        if target_path.exists() and target_path.is_file():
            return FileResponse(target_path)

        # Reject common system directory paths or path traversal artifacts
        first_segment = Path(full_path).parts[0] if Path(full_path).parts else ""
        if first_segment in ("etc", "var", "tmp", "usr", "bin", "sbin", "dev", "proc", "sys", "home", "root"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not Found")

        # If a specific static asset with extension was requested but missing on disk, return 404
        if "." in Path(full_path).name and not full_path.endswith(".html"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Asset not found")

        return FileResponse(static_dir_path / "index.html")

