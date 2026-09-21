from typing import Optional, Dict, Any, List
from datetime import datetime
from pydantic import BaseModel, Field
from app.db.models import get_utc_now


class ToolInvocationRecord(BaseModel):
    id: Optional[str] = None
    tool_name: str
    input_args: Dict[str, Any] = Field(default_factory=dict)
    output_data: Optional[str] = None
    error: Optional[str] = None
    duration_ms: Optional[int] = None
    exit_code: Optional[int] = 0
    created_at: datetime = Field(default_factory=get_utc_now)


class TrajectoryTurn(BaseModel):
    turn_index: int
    timestamp: datetime = Field(default_factory=get_utc_now)
    thoughts: List[str] = Field(default_factory=list)
    user_prompt: Optional[str] = None
    agent_response: Optional[str] = None
    tool_calls: List[ToolInvocationRecord] = Field(default_factory=list)
    diff_snapshot_sha: Optional[str] = None
    tokens_consumed: int = 0


class AgentTrajectory(BaseModel):
    task_id: str
    session_key: Optional[str] = None
    persona: str
    model_name: str
    status: str
    turns: List[TrajectoryTurn] = Field(default_factory=list)
    total_tokens: int = 0
    total_latency_ms: int = 0
    estimated_cost_usd: float = 0.0
    created_at: datetime = Field(default_factory=get_utc_now)
    updated_at: datetime = Field(default_factory=get_utc_now)
