import asyncio
import json
import logging
from typing import List, Dict, Any, Set
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("cyclode.websocket")


class WebSocketManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"WebSocket client connected. Total active: {len(self.active_connections)}")
        
        # Send initial welcome & connection confirmation
        await self.send_personal_message({
            "type": "CONNECTION_ESTABLISHED",
            "message": "Connected to Cyclode Real-Time Telemetry Hub",
            "active_clients": len(self.active_connections)
        }, websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        logger.info(f"WebSocket client disconnected. Total active: {len(self.active_connections)}")

    async def send_personal_message(self, message: Dict[str, Any], websocket: WebSocket):
        try:
            await websocket.send_text(json.dumps(message, default=str))
        except Exception as e:
            logger.error(f"Error sending personal message: {e}")

    async def broadcast(self, event_type: str, data: Dict[str, Any]):
        """
        Broadcasts a typed event payload to all connected frontend clients concurrently.
        """
        if not self.active_connections:
            return

        payload = {
            "type": event_type,
            "data": data
        }
        message_str = json.dumps(payload, default=str)
        connections = list(self.active_connections)

        async def _safe_send(ws: WebSocket) -> Optional[WebSocket]:
            try:
                await ws.send_text(message_str)
                return None
            except Exception:
                return ws

        results = await asyncio.gather(*[_safe_send(c) for c in connections], return_exceptions=False)
        for dead in results:
            if dead is not None:
                self.active_connections.discard(dead)


    async def broadcast_task_event(self, task_id: str, event_type: str, data: Dict[str, Any]):
        """
        Broadcasts a task-specific event to all connected frontend clients.
        """
        payload_data = dict(data)
        payload_data["task_id"] = task_id
        await self.broadcast(event_type, payload_data)


ws_manager = WebSocketManager()
