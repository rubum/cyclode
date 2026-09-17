import json
from fastapi import APIRouter, Request, Header, HTTPException, Query, BackgroundTasks
from typing import Optional, Dict, Any
from app.config import settings
from app.core.security import verify_github_signature, verify_slack_signature, verify_appsignal_token
from app.core.router import event_router

router = APIRouter(prefix="/api/webhooks", tags=["Webhooks"])


@router.post("/github")
async def handle_github_webhook(
    request: Request,
    x_hub_signature_256: Optional[str] = Header(None),
    x_github_event: Optional[str] = Header("ping")
):
    raw_body = await request.body()
    is_valid = verify_github_signature(raw_body, x_hub_signature_256, settings.GITHUB_WEBHOOK_SECRET)
    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid GitHub webhook signature")

    if x_github_event == "ping":
        return {"ok": True, "message": "Pong! Webhook verified successfully."}

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        payload = {}

    result = await event_router.route_and_dispatch(
        source="github",
        event_type=x_github_event or "unknown",
        payload=payload,
        signature_valid=is_valid
    )
    return result


@router.post("/slack")
async def handle_slack_webhook(
    request: Request,
    x_slack_signature: Optional[str] = Header(None),
    x_slack_request_timestamp: Optional[str] = Header(None)
):
    raw_body = await request.body()
    is_valid = verify_slack_signature(
        raw_body,
        x_slack_signature,
        x_slack_request_timestamp,
        settings.SLACK_SIGNING_SECRET
    )
    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid Slack signature")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        # Check form data
        form = await request.form()
        payload = dict(form)

    # Handle Slack URL verification challenge
    if payload.get("type") == "url_verification":
        return {"challenge": payload.get("challenge")}

    result = await event_router.route_and_dispatch(
        source="slack",
        event_type=payload.get("type", "slash_command"),
        payload=payload,
        signature_valid=is_valid
    )
    return result


@router.post("/appsignal")
async def handle_appsignal_webhook(
    request: Request,
    token: Optional[str] = Query(None)
):
    raw_body = await request.body()
    is_valid = verify_appsignal_token(token, settings.APPSIGNAL_WEBHOOK_TOKEN)
    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid AppSignal token")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        payload = {}

    result = await event_router.route_and_dispatch(
        source="appsignal",
        event_type="exception_alert",
        payload=payload,
        signature_valid=is_valid
    )
    return result


@router.post("/generic")
async def handle_generic_webhook(payload: Dict[str, Any]):
    """
    Standard webhook ingress for custom services, Sentry, Jira, or CI/CD pipelines.
    """
    result = await event_router.route_and_dispatch(
        source=payload.get("source", "api"),
        event_type=payload.get("event_type", "custom_trigger"),
        payload=payload,
        signature_valid=True
    )
    return result
