from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db, async_session_factory
from app.db.models import AutomationRuleModel

router = APIRouter(prefix="/api/automations", tags=["Automations"])


class AutomationRuleCreateRequest(BaseModel):
    name: str
    source: str
    event_type: str
    repo_filter: str = "*"
    persona: str = "CodeReviewer"
    action: str = "spawn_task"
    auto_post_comment: bool = True
    require_approval: bool = False
    enabled: bool = True


class AutomationRuleUpdateRequest(BaseModel):
    name: Optional[str] = None
    source: Optional[str] = None
    event_type: Optional[str] = None
    repo_filter: Optional[str] = None
    persona: Optional[str] = None
    action: Optional[str] = None
    auto_post_comment: Optional[bool] = None
    require_approval: Optional[bool] = None
    enabled: Optional[bool] = None


DEFAULT_RULES = [
    {
        "name": "Autonomous PR Code Reviewer",
        "source": "github",
        "event_type": "pull_request.opened",
        "repo_filter": "*",
        "persona": "CodeReviewer",
        "action": "spawn_task",
        "auto_post_comment": True,
        "require_approval": False,
        "enabled": True
    },
    {
        "name": "PR Incremental Review (New Commits)",
        "source": "github",
        "event_type": "pull_request.synchronize",
        "repo_filter": "*",
        "persona": "CodeReviewer",
        "action": "awaken_session",
        "auto_post_comment": True,
        "require_approval": False,
        "enabled": True
    },
    {
        "name": "PR Assistant Chat (@cyclode mention)",
        "source": "github",
        "event_type": "issue_comment.created",
        "repo_filter": "*",
        "persona": "PairProgrammer",
        "action": "awaken_session",
        "auto_post_comment": True,
        "require_approval": True,
        "enabled": True
    },
    {
        "name": "Sentry Production Incident Triage",
        "source": "sentry",
        "event_type": "issue.created",
        "repo_filter": "*",
        "persona": "APMTriage",
        "action": "spawn_task",
        "auto_post_comment": False,
        "require_approval": True,
        "enabled": True
    },
    {
        "name": "AppSignal Exception Auto-Remediation",
        "source": "appsignal",
        "event_type": "exception",
        "repo_filter": "*",
        "persona": "APMTriage",
        "action": "spawn_task",
        "auto_post_comment": False,
        "require_approval": True,
        "enabled": True
    }
]


async def ensure_default_rules(db: AsyncSession):
    stmt = select(AutomationRuleModel)
    res = await db.execute(stmt)
    existing = res.scalars().all()
    if not existing:
        for r in DEFAULT_RULES:
            rule = AutomationRuleModel(**r)
            db.add(rule)
        await db.commit()


@router.get("")
async def list_automations(db: AsyncSession = Depends(get_db)):
    await ensure_default_rules(db)
    stmt = select(AutomationRuleModel).order_by(AutomationRuleModel.created_at)
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("")
async def create_automation(req: AutomationRuleCreateRequest, db: AsyncSession = Depends(get_db)):
    rule = AutomationRuleModel(**req.dict())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/{rule_id}")
async def update_automation(rule_id: str, req: AutomationRuleUpdateRequest, db: AsyncSession = Depends(get_db)):
    stmt = select(AutomationRuleModel).where(AutomationRuleModel.id == rule_id)
    res = await db.execute(stmt)
    rule = res.scalars().first()
    if not rule:
        raise HTTPException(status_code=404, detail="Automation rule not found")

    data = req.dict(exclude_unset=True)
    for k, v in data.items():
        setattr(rule, k, v)

    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/{rule_id}")
async def delete_automation(rule_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(AutomationRuleModel).where(AutomationRuleModel.id == rule_id)
    res = await db.execute(stmt)
    rule = res.scalars().first()
    if not rule:
        raise HTTPException(status_code=404, detail="Automation rule not found")

    await db.delete(rule)
    await db.commit()
    return {"ok": True, "deleted_rule_id": rule_id}
