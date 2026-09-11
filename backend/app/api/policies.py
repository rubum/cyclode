from fastapi import APIRouter
from typing import Dict
from pydantic import BaseModel
from app.config import PolicyLevel
from app.core.policies import policy_engine

router = APIRouter(prefix="/api/policies", tags=["Policies"])


class PolicyUpdateRequest(BaseModel):
    policies: Dict[str, str]


@router.get("")
async def get_policies():
    return policy_engine.get_all_policies()


@router.put("")
async def update_policies(req: PolicyUpdateRequest):
    for action, level_str in req.policies.items():
        try:
            level = PolicyLevel(level_str)
            policy_engine.set_policy(action, level)
        except ValueError:
            pass
    return policy_engine.get_all_policies()
