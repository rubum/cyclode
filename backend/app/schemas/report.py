from typing import Optional, Dict, Any, List
from datetime import datetime
from pydantic import BaseModel, Field
from app.db.models import get_utc_now


class CompileReportRequest(BaseModel):
    title: Optional[str] = None
    format: str = "markdown"  # "markdown", "html", "docx"
    save_to_workspace: bool = False
    custom_instructions: Optional[str] = None


class SessionCitation(BaseModel):
    title: str
    url: str
    snippet: Optional[str] = None
    domain: Optional[str] = None


class SessionDecision(BaseModel):
    title: str
    rationale: Optional[str] = None
    outcome: Optional[str] = None


class SessionFileChange(BaseModel):
    path: str
    action: str  # created, modified, deleted
    summary: Optional[str] = None


class SessionReportSchema(BaseModel):
    task_id: str
    title: str
    executive_summary: str
    markdown: str
    html: Optional[str] = None
    citations: List[SessionCitation] = Field(default_factory=list)
    decisions: List[SessionDecision] = Field(default_factory=list)
    file_changes: List[SessionFileChange] = Field(default_factory=list)
    metrics: Dict[str, Any] = Field(default_factory=dict)
    workspace_file_path: Optional[str] = None
    created_at: datetime = Field(default_factory=get_utc_now)
