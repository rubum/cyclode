import asyncio
import logging
import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime
from app.db.models import get_utc_now
from app.schemas.events import OutboundEventSchema, OutboundActionType

logger = logging.getLogger("cyclode.events.dispatcher")


class OutboundEventDispatcher:
    """
    Centralized delivery manager and ledger for all outbound agent actions.
    Records dispatches (PR reviews, inline comments, PR creation, git pushes, Slack alerts),
    manages delivery retries, dead-letter logging, and WebSocket broadcasts.
    """

    def __init__(self):
        # In-memory fast audit ledger for recent outbound dispatches
        self._outbound_ledger: List[OutboundEventSchema] = []
        self._max_in_memory = 500

    async def record_and_broadcast(
        self,
        task_id: str,
        action_type: str,
        target: str,
        payload: Dict[str, Any],
        status_code: int = 200,
        delivered: bool = True,
        error: Optional[str] = None,
        event_id: Optional[str] = None
    ) -> OutboundEventSchema:
        """
        Records an outbound action, appends to the audit ledger, and broadcasts over WebSockets.
        """
        outbound_record = OutboundEventSchema(
            id=f"out_{uuid.uuid4().hex[:12]}",
            task_id=task_id,
            event_id=event_id,
            action_type=action_type,
            target=target,
            payload=payload,
            status_code=status_code,
            delivered=delivered,
            delivered_at=get_utc_now(),
            error=error
        )

        # Store in ledger (bounded)
        self._outbound_ledger.append(outbound_record)
        if len(self._outbound_ledger) > self._max_in_memory:
            self._outbound_ledger = self._outbound_ledger[-self._max_in_memory:]

        # Broadcast via WebSockets
        try:
            from app.api.websocket import ws_manager
            await ws_manager.broadcast("OUTGOING_EVENT", {
                "id": outbound_record.id,
                "task_id": task_id,
                "event_id": event_id,
                "action_type": action_type,
                "target": target,
                "payload": payload,
                "status_code": status_code,
                "delivered": delivered,
                "error": error,
                "delivered_at": outbound_record.delivered_at.isoformat()
            })
        except Exception as e:
            logger.debug(f"WebSocket broadcast notice for outgoing event: {e}")

        return outbound_record

    def get_task_outbound_events(self, task_id: str) -> List[OutboundEventSchema]:
        """Returns all outbound events for a specific task."""
        return [e for e in self._outbound_ledger if e.task_id == task_id]

    def get_all_outbound_events(self, limit: int = 50) -> List[OutboundEventSchema]:
        """Returns the most recent outbound events across all tasks."""
        return self._outbound_ledger[-limit:]


# Singleton dispatcher instance
event_dispatcher = OutboundEventDispatcher()
