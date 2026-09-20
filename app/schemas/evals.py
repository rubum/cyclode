from enum import Enum
from typing import Optional, Dict, Any, List
from datetime import datetime
from pydantic import BaseModel, Field
from app.db.models import get_utc_now


class EvaluationCategory(str, Enum):
    WORKSPACE_STATE = "workspace_state"
    UNIT_TESTS = "unit_tests"
    PREVIEW_BUNDLE = "preview_bundle"
    SECURITY_JAIL = "security_jail"
    SYNTHESIS = "synthesis"
    PR_QUALITY = "pr_quality"


class EvaluationCheck(BaseModel):
    name: str
    category: EvaluationCategory = EvaluationCategory.WORKSPACE_STATE
    passed: bool = True
    diagnostics: Optional[str] = None
    duration_ms: Optional[int] = None


class EvaluationScorecard(BaseModel):
    status: str = Field(default="in_progress", description="'accomplished', 'needs_revision', or 'in_progress'")
    summary: str = "Evaluation initialized."
    score: float = Field(default=1.0, ge=0.0, le=1.0)
    checks: List[EvaluationCheck] = Field(default_factory=list)
    evaluated_at: datetime = Field(default_factory=get_utc_now)
