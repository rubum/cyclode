from enum import Enum
from typing import Optional, Dict, Any, List, Union
from datetime import datetime
from pydantic import BaseModel, Field
from app.db.models import get_utc_now


class EventSource(str, Enum):
    GITHUB = "github"
    SENTRY = "sentry"
    APPSIGNAL = "appsignal"
    SLACK = "slack"
    CI = "ci"
    GENERIC = "generic"
    MANUAL = "manual"


class InboundEventSchema(BaseModel):
    id: Optional[str] = None
    source: str
    event_type: str
    payload: Dict[str, Any] = Field(default_factory=dict)
    signature_valid: bool = True
    session_key: Optional[str] = None
    matched_rule_id: Optional[str] = None
    status: str = "PROCESSED"
    created_at: datetime = Field(default_factory=get_utc_now)


class OutboundActionType(str, Enum):
    POST_PR_REVIEW = "post_pull_request_review"
    POST_LINE_COMMENT = "post_pull_request_line_comment"
    CREATE_PR = "create_pull_request"
    GIT_PUSH = "git_push"
    SLACK_NOTIFY = "slack_notify"
    GENERIC_DISPATCH = "generic_dispatch"


class OutboundEventSchema(BaseModel):
    id: str
    task_id: str
    event_id: Optional[str] = None
    action_type: str
    target: str
    payload: Dict[str, Any] = Field(default_factory=dict)
    status_code: Optional[int] = 200
    delivered: bool = True
    delivered_at: datetime = Field(default_factory=get_utc_now)
    error: Optional[str] = None


class EventTimelineItem(BaseModel):
    id: str
    kind: str = Field(..., description="'inbound' or 'outbound'")
    source: str
    event_type: str
    title: str
    summary: Optional[str] = None
    session_key: Optional[str] = None
    task_id: Optional[str] = None
    signature_valid: bool = True
    status: str = "SUCCESS"
    status_code: Optional[int] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=get_utc_now)
