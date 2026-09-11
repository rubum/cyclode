from fastapi import APIRouter, HTTPException
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from app.integrations.registry import integration_registry
from app.integrations.manager import integration_manager

router = APIRouter(prefix="/api/integrations", tags=["Integrations"])


class CredentialUpdateRequest(BaseModel):
    provider: str
    credentials: Dict[str, Any]


class TestRepoRequest(BaseModel):
    repo_url: str
    token: Optional[str] = None


@router.get("")
async def get_integrations_status():
    return {
        "integrations": integration_registry.get_status(),
        "active_skills": integration_registry.get_active_skills()
    }


@router.post("/credentials")
async def update_credentials(req: CredentialUpdateRequest):
    res = await integration_manager.update_credentials(req.provider, req.credentials)
    return res


@router.post("/test-repo")
async def test_repo(req: TestRepoRequest):
    res = await integration_manager.test_remote_repo(req.repo_url, req.token)
    return res

