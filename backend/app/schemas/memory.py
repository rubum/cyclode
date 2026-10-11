from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import datetime


class KnowledgeEntrySchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    repo_id: Optional[str] = None
    source_task_id: Optional[str] = None
    source_turn_index: Optional[int] = None
    git_commit_sha: Optional[str] = None
    category: str = "failure_recovery"
    trigger_pattern: str
    insight: str
    context_files: List[str] = Field(default_factory=list)
    status: str = "PROVISIONAL"
    utility_score: float = 1.0
    usage_count: int = 0
    created_at: datetime
    updated_at: datetime


class CreateKnowledgeEntryRequest(BaseModel):
    repo_id: Optional[str] = None
    source_task_id: Optional[str] = None
    source_turn_index: Optional[int] = None
    git_commit_sha: Optional[str] = None
    category: str = "failure_recovery"
    trigger_pattern: str
    insight: str
    context_files: List[str] = Field(default_factory=list)
    status: str = "PROVISIONAL"


class VoteMemoryRequest(BaseModel):
    delta: float = Field(default=0.5, description="Utility score delta (+0.5 to reinforce, -0.5 to penalize)")


class MemorySearchResult(BaseModel):
    entries: List[KnowledgeEntrySchema]
    total: int
