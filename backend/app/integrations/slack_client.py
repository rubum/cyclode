import httpx
from typing import Optional, Dict, Any, List
from app.config import settings


class SlackClient:
    def __init__(self, token: Optional[str] = None, default_channel: Optional[str] = None):
        self.token = token or settings.SLACK_BOT_TOKEN
        self.default_channel = default_channel or settings.SLACK_DEFAULT_CHANNEL
        self.api_base = "https://slack.com/api"

    def is_configured(self) -> bool:
        return bool(self.token)

    async def post_message(self, text: str, channel: Optional[str] = None, blocks: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """
        Posts a message to Slack. If not configured, safely logs/simulates.
        """
        target_channel = channel or self.default_channel
        if not self.is_configured():
            return {
                "ok": True,
                "channel": target_channel,
                "text": text,
                "simulated": True
            }

        async with httpx.AsyncClient() as client:
            payload: Dict[str, Any] = {
                "channel": target_channel,
                "text": text
            }
            if blocks:
                payload["blocks"] = blocks

            resp = await client.post(
                f"{self.api_base}/chat.postMessage",
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json"
                },
                json=payload,
                timeout=10.0
            )
            return resp.json()

    async def send_approval_request(self, task_id: str, title: str, action_type: str, details: str) -> Dict[str, Any]:
        """
        Sends an interactive Block Kit approval notification with Approve/Reject buttons.
        """
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": "⚡ Cyclode: Human Approval Required",
                    "emoji": True
                }
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Task:*\n{title}"},
                    {"type": "mrkdwn", "text": f"*Action:*\n`{action_type}`"}
                ]
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*Details:*\n{details}"
                }
            },
            {
                "type": "actions",
                "block_id": f"approval_{task_id}",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "✅ Approve & Execute"},
                        "style": "primary",
                        "value": f"approve_{task_id}",
                        "action_id": "btn_approve"
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "🛑 Reject"},
                        "style": "danger",
                        "value": f"reject_{task_id}",
                        "action_id": "btn_reject"
                    }
                ]
            }
        ]
        return await self.post_message(
            text=f"Cyclode Agent requires approval for task: {title}",
            blocks=blocks
        )


slack_client = SlackClient()
