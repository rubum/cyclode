from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
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
    slug: Optional[str] = None
    superseded_by: Optional[str] = None
    epistemic_grade: str = "asserted"
    entities: List[str] = Field(default_factory=list)
    relations: List[Dict[str, Any]] = Field(default_factory=list)
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
    slug: Optional[str] = None
    epistemic_grade: Optional[str] = None
    entities: Optional[List[str]] = None
    relations: Optional[List[Dict[str, Any]]] = None
    status: str = "PROVISIONAL"


class VoteMemoryRequest(BaseModel):
    delta: float = Field(default=0.5, description="Utility score delta (+0.5 to reinforce, -0.5 to penalize)")


class MemorySearchResult(BaseModel):
    entries: List[KnowledgeEntrySchema]
    total: int


class MemoryRecallRequest(BaseModel):
    query: str
    repo_id: Optional[str] = None
    target_files: Optional[List[str]] = None
    limit: int = Field(default=5, ge=1, le=20)


class MemoryRecallResponse(BaseModel):
    plan: Dict[str, Any]
    entries: List[Dict[str, Any]]
    graph_facts: List[str]
    context_pack: str
    engine_tier: str


class KnowledgeGraphResponse(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    contract_tally: Dict[str, int]
    engine_tier: str
