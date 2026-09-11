from fastapi import APIRouter
from app.config import settings

router = APIRouter(tags=["Health"])


@router.get("/healthz")
async def health_check():
    return {
        "status": "healthy",
        "service": "adappty-backend",
        "environment": settings.ENVIRONMENT,
        "model": settings.ANTIGRAVITY_MODEL
    }


@router.get("/readyz")
async def readiness_check():
    return {
        "status": "ready",
        "database": "connected",
        "workspace_root": settings.WORKSPACE_ROOT
    }
