import pytest
import pytest_asyncio
from sqlalchemy import select
from app.db.session import async_session_factory
from app.db.models import TaskModel, KnowledgeEntryModel
from app.agent.engine.memory import (
    extract_turn_heuristics,
    promote_task_memories,
    rollback_turn_memories,
    retrieve_relevant_heuristics,
    format_working_memory_block,
    vote_memory_heuristic,
    cascade_delete_task_memories,
    plan_memory_query,
    upsert_knowledge_entry,
    get_file_memory_hints,
    recall_context_pack,
    build_knowledge_graph,
)


@pytest.mark.asyncio
async def test_extract_turn_heuristics_and_two_phase_lifecycle():
    task_id = "test-task-mem-1"
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Fix Database Connection Leak",
            description="Resolve SQLite WAL lock timeout",
            persona="IssueResolver"
        )
        session.add(task)
        await session.commit()

    # Simulate failing log followed by successful fix
    tool_logs = [
        {
            "tool_name": "run_command",
            "tool_input": {"CommandLine": "pytest backend/tests/test_db.py"},
            "tool_output": "Traceback (most recent call last):\nsqlite3.OperationalError: database is locked",
            "exit_code": 1
        },
        {
            "tool_name": "replace_file_content",
            "tool_input": {"TargetFile": "backend/app/db/session.py"},
            "tool_output": "Successfully replaced pragma timeout to 60000ms",
            "exit_code": 0
        }
    ]

    # 1. Extraction: staged as PROVISIONAL with CortexDB slug, entities, and relations
    entries = await extract_turn_heuristics(
        task_id=task_id,
        turn_index=2,
        tool_logs=tool_logs,
        diff_files=["backend/app/db/session.py"]
    )
    assert len(entries) == 1
    assert entries[0]["status"] == "PROVISIONAL"
    assert "database is locked" in entries[0]["trigger_pattern"]
    assert "session.py" in entries[0]["insight"]
    assert entries[0]["epistemic_grade"] == "self_consistent"
    assert entries[0]["slug"].startswith("auto:failure-recovery:session-py:")
    assert "session.py" in entries[0]["entities"]
    assert any(r["predicate"] == "resolves" for r in entries[0]["relations"])

    # 2. Retrieval before promotion (PROVISIONAL must NOT be retrieved)
    retrieved_pre = await retrieve_relevant_heuristics(prompt="database is locked in sqlite")
    assert not any(h["id"] == entries[0]["id"] for h in retrieved_pre)

    # 3. Promotion upon task completion
    promoted_count = await promote_task_memories(task_id)
    assert promoted_count >= 1

    # 4. Retrieval after promotion (PROMOTED can be retrieved via 3-lane RRF)
    retrieved_post = await retrieve_relevant_heuristics(
        prompt="database is locked in sqlite",
        target_files=["session.py"]
    )
    matching = [h for h in retrieved_post if h["id"] == entries[0]["id"]]
    assert len(matching) == 1
    assert matching[0]["utility_score"] >= 1.0
    assert len(matching[0]["graph_facts"]) >= 1

    # 5. Format working memory block (includes lessons + Knowledge Graph Facts)
    mem_block = format_working_memory_block(matching)
    assert "[System Experiential Memory - Verified Lessons]:" in mem_block
    assert "database is locked" in mem_block
    assert "[Knowledge Graph Facts]:" in mem_block


@pytest.mark.asyncio
async def test_planned_recall_skips_trivial_prompts():
    for trivial in ("ok", "go ahead", "thanks", "yes", "proceed", ""):
        plan = plan_memory_query(trivial)
        assert plan["should_recall"] is False
        assert plan["retrieval_mode"] == "skip"

    tech_plan = plan_memory_query(
        "Fix OperationalError in session.py when running asyncpg",
        target_files=["backend/app/db/session.py"]
    )
    assert tech_plan["should_recall"] is True
    assert "graph" in tech_plan["lanes"]
    assert "session.py" in tech_plan["target_files"]


@pytest.mark.asyncio
async def test_slug_supersession_and_file_memory_hints():
    task_id = "test-task-supersede"
    async with async_session_factory() as session:
        task = TaskModel(id=task_id, title="Supersession Test")
        session.add(task)
        await session.commit()

        # First entry under slug
        e1, sup1 = await upsert_knowledge_entry(
            session,
            source_task_id=task_id,
            category="architecture_rule",
            trigger_pattern="SQLite busy_timeout config",
            insight="Set busy_timeout to 5000ms in session.py",
            context_files=["session.py"],
            slug="auto:arch:session-py:busy-timeout",
            status="PROMOTED",
        )
        assert sup1 == []

        # Newer entry with same slug supersedes e1
        e2, sup2 = await upsert_knowledge_entry(
            session,
            source_task_id=task_id,
            category="architecture_rule",
            trigger_pattern="SQLite busy_timeout config",
            insight="Set busy_timeout to 60000ms in session.py for WAL concurrency",
            context_files=["session.py"],
            slug="auto:arch:session-py:busy-timeout",
            status="PROMOTED",
        )
        assert e1.id in sup2

        # Verify e1 is now marked SUPERSEDED and points to e2.id
        res = await session.execute(select(KnowledgeEntryModel).where(KnowledgeEntryModel.id == e1.id))
        old_row = res.scalar_one()
        assert old_row.status == "SUPERSEDED"
        assert old_row.superseded_by == e2.id

    # Verify retrieve_relevant_heuristics only returns e2, never the superseded e1
    hits = await retrieve_relevant_heuristics(prompt="SQLite busy_timeout config", target_files=["session.py"], limit=10)
    hit_ids = [h["id"] for h in hits]
    assert e2.id in hit_ids
    assert e1.id not in hit_ids

    # Verify pre-file-open contextual recall hook (`get_file_memory_hints`)
    file_hints = await get_file_memory_hints("backend/app/db/session.py", limit=5)
    assert any(h["id"] == e2.id for h in file_hints)
    assert not any(h["id"] == e1.id for h in file_hints)


@pytest.mark.asyncio
async def test_turn_rollback_purges_provisional_memories():
    task_id = "test-task-mem-rollback"
    async with async_session_factory() as session:
        task = TaskModel(id=task_id, title="Refactor Test Suite")
        m1 = KnowledgeEntryModel(
            source_task_id=task_id,
            source_turn_index=1,
            trigger_pattern="turn 1 pattern",
            insight="Turn 1 permanent heuristic",
            status="PROMOTED"
        )
        m2 = KnowledgeEntryModel(
            source_task_id=task_id,
            source_turn_index=2,
            trigger_pattern="turn 2 pattern",
            insight="Turn 2 provisional heuristic",
            status="PROVISIONAL"
        )
        m3 = KnowledgeEntryModel(
            source_task_id=task_id,
            source_turn_index=3,
            trigger_pattern="turn 3 pattern",
            insight="Turn 3 provisional heuristic",
            status="PROVISIONAL"
        )
        session.add_all([task, m1, m2, m3])
        await session.commit()

    # Rewind to Turn 2 -> Purges Turn 2 and 3 provisional memories
    purged = await rollback_turn_memories(task_id=task_id, from_turn_index=2)
    assert purged == 2

    # Verify Turn 1 promoted memory remains, but Turn 2 and 3 are gone
    async with async_session_factory() as session:
        stmt = select(KnowledgeEntryModel).where(KnowledgeEntryModel.source_task_id == task_id)
        res = await session.execute(stmt)
        remaining = res.scalars().all()
        assert len(remaining) == 1
        assert remaining[0].source_turn_index == 1


@pytest.mark.asyncio
async def test_voting_upgrades_epistemic_grade_and_invalidation():
    async with async_session_factory() as session:
        entry = KnowledgeEntryModel(
            trigger_pattern="deprecated library",
            insight="Use legacy import",
            status="PROMOTED",
            epistemic_grade="asserted",
            utility_score=1.0
        )
        session.add(entry)
        await session.commit()
        await session.refresh(entry)
        entry_id = entry.id

    # Upvote -> upgrades epistemic_grade to 'verified'
    up = await vote_memory_heuristic(entry_id, 0.5)
    assert up["utility_score"] == 1.5
    assert up["epistemic_grade"] == "verified"

    # Penalize below 0.3 -> INVALIDATED & epistemic_grade 'refused'
    down = await vote_memory_heuristic(entry_id, -1.3)
    assert down["status"] == "INVALIDATED"
    assert down["epistemic_grade"] == "refused"


@pytest.mark.asyncio
async def test_cascade_delete_task_memories():
    task_id = "test-task-cascade"
    async with async_session_factory() as session:
        task = TaskModel(id=task_id, title="Test Task Cascade")
        # Provisional memory (should be hard deleted)
        provisional = KnowledgeEntryModel(
            source_task_id=task_id,
            source_turn_index=1,
            trigger_pattern="provisional err",
            insight="provisional insight",
            status="PROVISIONAL",
            utility_score=1.0,
            usage_count=0
        )
        # Promoted memory with verified usage (should be detached, not deleted)
        promoted = KnowledgeEntryModel(
            source_task_id=task_id,
            source_turn_index=1,
            trigger_pattern="promoted rule",
            insight="global repository rule",
            status="PROMOTED",
            utility_score=2.0,
            usage_count=3
        )
        session.add_all([task, provisional, promoted])
        await session.commit()

    # Cascade delete task
    await cascade_delete_task_memories(task_id)

    async with async_session_factory() as session:
        # Check provisional was deleted
        res_prov = await session.execute(
            select(KnowledgeEntryModel).where(KnowledgeEntryModel.trigger_pattern == "provisional err")
        )
        assert res_prov.scalars().first() is None

        # Check promoted survived with source_task_id detached (None)
        res_prom = await session.execute(
            select(KnowledgeEntryModel).where(KnowledgeEntryModel.trigger_pattern == "promoted rule")
        )
        survived = res_prom.scalars().first()
        assert survived is not None
        assert survived.source_task_id is None
