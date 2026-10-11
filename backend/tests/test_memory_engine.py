import pytest
import pytest_asyncio
from app.db.session import async_session_factory
from app.db.models import TaskModel, KnowledgeEntryModel
from app.agent.engine.memory import (
    extract_turn_heuristics,
    promote_task_memories,
    rollback_turn_memories,
    retrieve_relevant_heuristics,
    format_working_memory_block,
    vote_memory_heuristic,
    cascade_delete_task_memories
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

    # 1. Extraction: staged as PROVISIONAL
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

    # 2. Retrieval before promotion (PROVISIONAL must NOT be retrieved)
    retrieved_pre = await retrieve_relevant_heuristics(prompt="database is locked in sqlite")
    assert not any(h["id"] == entries[0]["id"] for h in retrieved_pre)

    # 3. Promotion upon task completion
    promoted_count = await promote_task_memories(task_id)
    assert promoted_count >= 1

    # 4. Retrieval after promotion (PROMOTED can be retrieved)
    retrieved_post = await retrieve_relevant_heuristics(prompt="database is locked in sqlite", target_files=["session.py"])
    matching = [h for h in retrieved_post if h["id"] == entries[0]["id"]]
    assert len(matching) == 1
    assert matching[0]["utility_score"] >= 1.0

    # 5. Format working memory block
    mem_block = format_working_memory_block(matching)
    assert "[System Experiential Memory - Verified Lessons]:" in mem_block
    assert "database is locked" in mem_block


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
    from sqlalchemy import select
    async with async_session_factory() as session:
        stmt = select(KnowledgeEntryModel).where(KnowledgeEntryModel.source_task_id == task_id)
        res = await session.execute(stmt)
        remaining = res.scalars().all()
        assert len(remaining) == 1
        assert remaining[0].source_turn_index == 1


@pytest.mark.asyncio
async def test_voting_and_invalidation():
    async with async_session_factory() as session:
        entry = KnowledgeEntryModel(
            trigger_pattern="deprecated library",
            insight="Use legacy import",
            status="PROMOTED",
            utility_score=1.0
        )
        session.add(entry)
        await session.commit()
        await session.refresh(entry)
        entry_id = entry.id

    # Upvote
    up = await vote_memory_heuristic(entry_id, 0.5)
    assert up["utility_score"] == 1.5

    # Penalize below 0.3 -> INVALIDATED
    down = await vote_memory_heuristic(entry_id, -1.3)
    assert down["status"] == "INVALIDATED"


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

    from sqlalchemy import select
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
