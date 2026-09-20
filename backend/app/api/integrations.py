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
    anthropic_model: Optional[str] = None
    openai_model: Optional[str] = None
    openai_base_url: Optional[str] = None


@router.post("/model-settings")
async def update_model_settings(req: ModelSettingsUpdateRequest):
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    return integration_manager.update_model_settings(updates)


class GuardrailSettingsUpdateRequest(BaseModel):
    guardrail_enabled: Optional[bool] = None
    fastpath_enabled: Optional[bool] = None
    safety_threshold: Optional[float] = None
    system_two_threshold: Optional[float] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class TestGuardrailRequest(BaseModel):
    prompt: str
    context: Optional[Dict[str, Any]] = None


class BenchmarkRunRequest(BaseModel):
    prompt: str
    category: Optional[str] = "custom"
    context: Optional[Dict[str, Any]] = None
    llm_model: Optional[str] = None


class BenchmarkSuiteRequest(BaseModel):
    suite_id: Optional[str] = "standard"


@router.get("/guardrail-settings")
async def get_guardrail_settings():
    return integration_manager.get_guardrail_settings()


@router.post("/guardrail-settings")
async def update_guardrail_settings(req: GuardrailSettingsUpdateRequest):
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    return integration_manager.update_guardrail_settings(updates)


@router.post("/guardrail-test")
async def test_guardrail(req: TestGuardrailRequest):
    from app.agent.guardrail import preflight_guardrail
    eval_res = await preflight_guardrail.evaluate_preflight(req.prompt, req.context)
    return eval_res.model_dump()


@router.post("/benchmark-run")
async def run_benchmark(req: BenchmarkRunRequest):
    from app.agent.benchmark import benchmark_runner
    res = await benchmark_runner.run_comparison(
        prompt=req.prompt,
        category=req.category or "custom",
        context=req.context,
        llm_model=req.llm_model
    )
    return res.model_dump()


@router.post("/benchmark-suite")
async def run_benchmark_suite(req: Optional[BenchmarkSuiteRequest] = None):
    from app.agent.benchmark import benchmark_runner
    suite_id = req.suite_id if req else "standard"
    res = await benchmark_runner.run_suite(suite_id=suite_id)
    return res.model_dump()

