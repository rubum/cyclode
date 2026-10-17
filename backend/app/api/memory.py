import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, desc, or_

from app.db.session import get_db
from app.db.models import KnowledgeEntryModel, get_utc_now
from app.schemas.memory import (
    KnowledgeEntrySchema,
    CreateKnowledgeEntryRequest,
    VoteMemoryRequest,
    MemorySearchResult,
    MemoryRecallRequest,
    MemoryRecallResponse,
    KnowledgeGraphResponse,
)
from app.agent.engine.memory import (
    vote_memory_heuristic,
    upsert_knowledge_entry,
    recall_context_pack,
    build_knowledge_graph,
)

logger = logging.getLogger("cyclode.api.memory")
router = APIRouter(prefix="/api/memories", tags=["memory"])


@router.get("", response_model=MemorySearchResult)
async def list_memories(
    repo_id: Optional[str] = Query(None, description="Filter by repository ID"),
    task_id: Optional[str] = Query(None, description="Filter by task ID"),
    status: Optional[str] = Query(None, description="Filter by status: PROVISIONAL, PROMOTED, INVALIDATED, SUPERSEDED"),
    category: Optional[str] = Query(None, description="Filter by category"),
    epistemic_grade: Optional[str] = Query(None, description="Filter by epistemic grade: verified, self_consistent, asserted"),
    query: Optional[str] = Query(None, description="Search query string"),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """
    Search and list experiential memory heuristics.
    """
    stmt = select(KnowledgeEntryModel)

    conditions = []
    if repo_id:
        conditions.append(or_(KnowledgeEntryModel.repo_id == repo_id, KnowledgeEntryModel.repo_id.is_(None)))
    if task_id:
        conditions.append(KnowledgeEntryModel.source_task_id == task_id)
    if status:
        conditions.append(KnowledgeEntryModel.status == status)
    if category:
        conditions.append(KnowledgeEntryModel.category == category)
    if epistemic_grade:
        conditions.append(KnowledgeEntryModel.epistemic_grade == epistemic_grade)
    if query:
        pattern = f"%{query.strip()}%"
        conditions.append(
            or_(
                KnowledgeEntryModel.insight.ilike(pattern),
                KnowledgeEntryModel.trigger_pattern.ilike(pattern),
                KnowledgeEntryModel.slug.ilike(pattern),
            )
        )

    if conditions:
        stmt = stmt.where(*conditions)

    stmt = stmt.order_by(desc(KnowledgeEntryModel.utility_score), desc(KnowledgeEntryModel.created_at)).limit(limit)
    res = await db.execute(stmt)
    entries = res.scalars().all()

    return MemorySearchResult(
        entries=[KnowledgeEntrySchema.model_validate(e) for e in entries],
        total=len(entries)
    )


@router.get("/graph", response_model=KnowledgeGraphResponse)
async def get_memories_graph(
    repo_id: Optional[str] = Query(None, description="Filter graph by repository ID"),
    task_id: Optional[str] = Query(None, description="Filter graph by task ID"),
):
    """
    Returns the CortexDB-style entity-relation knowledge graph and epistemic contract tally.
    """
    graph_data = await build_knowledge_graph(repo_id=repo_id, task_id=task_id)
    return KnowledgeGraphResponse(**graph_data)


@router.post("/recall", response_model=MemoryRecallResponse)
async def recall_memories(req: MemoryRecallRequest):
    """
    Executes CortexDB 3-lane Reciprocal Rank Fusion (lexical + vector + graph walk)
    and returns a paste-ready context pack with relational graph facts.
    """
    pack = await recall_context_pack(
        query=req.query,
        repo_id=req.repo_id,
        target_files=req.target_files,
        limit=req.limit,
    )
    return MemoryRecallResponse(**pack)


@router.get("/task/{task_id}", response_model=List[KnowledgeEntrySchema])
async def get_task_memories(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    Retrieves all memories associated with a specific task (both provisional and promoted).
    """
    stmt = (
        select(KnowledgeEntryModel)
        .where(KnowledgeEntryModel.source_task_id == task_id)
        .order_by(KnowledgeEntryModel.source_turn_index.asc(), desc(KnowledgeEntryModel.utility_score))
    )
    res = await db.execute(stmt)
    entries = res.scalars().all()
    return [KnowledgeEntrySchema.model_validate(e) for e in entries]


@router.post("", response_model=KnowledgeEntrySchema)
async def create_memory(req: CreateKnowledgeEntryRequest, db: AsyncSession = Depends(get_db)):
    """
    Creates a new knowledge entry manually with CortexDB slug supersession and inline entity/relation extraction.
    """
    entry, _ = await upsert_knowledge_entry(
        db,
        repo_id=req.repo_id,
        source_task_id=req.source_task_id,
        source_turn_index=req.source_turn_index,
        git_commit_sha=req.git_commit_sha,
        category=req.category,
        trigger_pattern=req.trigger_pattern,
        insight=req.insight,
        context_files=req.context_files,
        slug=req.slug,
        epistemic_grade=req.epistemic_grade,
        entities=req.entities,
        relations=req.relations,
        status=req.status,
        utility_score=1.0,
    )
    return KnowledgeEntrySchema.model_validate(entry)


@router.post("/{memory_id}/vote", response_model=KnowledgeEntrySchema)
async def vote_memory(memory_id: str, req: VoteMemoryRequest, db: AsyncSession = Depends(get_db)):
    """
    Reinforces or penalizes a memory heuristic.
    """
    updated = await vote_memory_heuristic(memory_id, req.delta)
    if not updated:
        raise HTTPException(status_code=404, detail="Memory entry not found")

    stmt = select(KnowledgeEntryModel).where(KnowledgeEntryModel.id == memory_id)
    res = await db.execute(stmt)
    entry = res.scalars().first()
    return KnowledgeEntrySchema.model_validate(entry)


@router.delete("/{memory_id}")
async def delete_memory(memory_id: str, db: AsyncSession = Depends(get_db)):
    """
    Permanently deletes a memory heuristic.
    """
    stmt = delete(KnowledgeEntryModel).where(KnowledgeEntryModel.id == memory_id)
    res = await db.execute(stmt)
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Memory entry not found")
    return {"ok": True, "deleted_id": memory_id}
