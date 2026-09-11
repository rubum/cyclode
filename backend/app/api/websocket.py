import asyncio
import json
import logging
from typing import List, Dict, Any, Set
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("adappty.websocket")


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
            "message": "Connected to Adappty Real-Time Telemetry Hub",
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
        Broadcasts a typed event payload to all connected frontend clients.
        """
        if not self.active_connections:
            return

        payload = {
            "type": event_type,
            "data": data
        }
        message_str = json.dumps(payload, default=str)
        dead_sockets = set()

        for connection in list(self.active_connections):
            try:
                await connection.send_text(message_str)
            except Exception:
                dead_sockets.add(connection)

        for dead in dead_sockets:
            self.active_connections.discard(dead)


ws_manager = WebSocketManager()
