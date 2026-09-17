from fastapi import APIRouter, Depends
from typing import Optional, List, Dict, Any
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.db.models import EventModel
from app.core.router import event_router

router = APIRouter(prefix="/api/events", tags=["Events"])


@router.get("")
async def list_events(limit: int = 50, db: AsyncSession = Depends(get_db)):
    stmt = select(EventModel).order_by(desc(EventModel.created_at)).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/simulate")
async def simulate_event(data: Dict[str, Any]):
    """
    Simulator endpoint to trigger test webhooks for GitHub, AppSignal, Slack, etc.
    """
    source = data.get("source", "github")
    event_type = data.get("event_type", "issues.opened")
    payload = data.get("payload", {})

    result = await event_router.route_and_dispatch(
        source=source,
        event_type=event_type,
        payload=payload,
        signature_valid=True
    )
    return result
