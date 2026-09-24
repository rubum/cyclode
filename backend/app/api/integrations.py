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
        "active_skills": integration_registry.get_active_skills(),
        "skills_catalog": integration_registry.get_skills_catalog(),
        "webhook_endpoints": integration_registry.get_webhook_endpoints()
    }



@router.post("/credentials")
async def update_credentials(req: CredentialUpdateRequest):
    res = await integration_manager.update_credentials(req.provider, req.credentials)
    return res


@router.post("/test-repo")
async def test_repo(req: TestRepoRequest):
    res = await integration_manager.test_remote_repo(req.repo_url, req.token)
    return res


@router.get("/model-settings")
async def get_model_settings():
    return integration_manager.get_model_settings()


class ModelSettingsUpdateRequest(BaseModel):
    routing_mode: Optional[str] = None
    major_model: Optional[str] = None
    minor_model: Optional[str] = None
    default_model: Optional[str] = None
    gemini_model: Optional[str] = None
    deepseek_model: Optional[str] = None
    deepseek_base_url: Optional[str] = None
    anthropic_model: Optional[str] = None
    openai_model: Optional[str] = None
    openai_base_url: Optional[str] = None


@router.post("/model-settings")
async def update_model_settings(req: ModelSettingsUpdateRequest):
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    return integration_manager.update_model_settings(updates)

