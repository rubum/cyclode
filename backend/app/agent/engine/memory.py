import re
import os
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy import select, delete, update, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_factory
from app.db.models import KnowledgeEntryModel, TaskModel, get_utc_now

logger = logging.getLogger("cyclode.memory")


def _extract_causal_insight(error_snippet: str, resolution_snippet: str, files: List[str]) -> Optional[Dict[str, Any]]:
    """
    Extracts an actionable, condensed heuristic from an error-recovery pair.
    """
    if not error_snippet or not resolution_snippet:
        return None

    # Clean and extract error signature
    lines = [line.strip() for line in error_snippet.split("\n") if line.strip()]
    key_error = ""
    for line in reversed(lines):
        if any(err in line for err in ["Error", "Exception", "failed", "Fatal", "cannot import"]):
            key_error = line[:120]
            break
    if not key_error and lines:
        key_error = lines[-1][:120]

    # Format actionable takeaway
    res_clean = resolution_snippet.strip().replace("\n", " ")[:200]
    insight = f"When encountering '{key_error}': Resolved by {res_clean}"

    return {
        "trigger_pattern": key_error or "runtime_error",
        "insight": insight,
        "context_files": [os.path.basename(f) for f in files if f],
        "category": "failure_recovery"
    }


async def extract_turn_heuristics(
    task_id: str,
    turn_index: int,
    tool_logs: List[Dict[str, Any]],
    diff_files: Optional[List[str]] = None,
    repo_id: Optional[str] = None,
    git_commit_sha: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Analyzes turn tool execution logs for error-recovery patterns and records
    provisional heuristics tied to the specific task and turn provenance.
    """
    if not tool_logs or len(tool_logs) < 2:
        return []

    created_entries = []
    # Identify failing tool followed by a succeeding tool or file edit
    for i in range(len(tool_logs) - 1):
        prev_log = tool_logs[i]
        curr_log = tool_logs[i + 1]

        prev_exit = prev_log.get("exit_code", 0)
        prev_out = prev_log.get("tool_output", "") or ""
        curr_exit = curr_log.get("exit_code", 0)
        curr_out = curr_log.get("tool_output", "") or ""

        has_error = prev_exit != 0 or any(err in prev_out for err in ["Traceback", "OperationalError", "SyntaxError", "ImportError", "failed", "Error:"])
        recovered = curr_exit == 0 and not any(err in curr_out for err in ["Traceback", "Error:"])

        if has_error and recovered:
            target_files = list(diff_files or [])
            # Also capture file from tool input if present
            inp = curr_log.get("tool_input") or {}
            target_f = inp.get("TargetFile") or inp.get("file_path") or inp.get("path")
            if target_f and target_f not in target_files:
                target_files.append(target_f)

            res_desc = f"executing {curr_log.get('tool_name', 'tool')} successfully"
            if "edit" in curr_log.get("tool_name", "").lower() or "replace" in curr_log.get("tool_name", "").lower():
                res_desc = f"modifying {os.path.basename(target_f) if target_f else 'relevant file'}"

            extracted = _extract_causal_insight(prev_out, res_desc, target_files)
            if extracted:
                async with async_session_factory() as session:
                    entry = KnowledgeEntryModel(
                        repo_id=repo_id,
                        source_task_id=task_id,
                        source_turn_index=turn_index,
                        git_commit_sha=git_commit_sha,
                        category=extracted["category"],
                        trigger_pattern=extracted["trigger_pattern"],
                        insight=extracted["insight"],
                        context_files=extracted["context_files"],
                        status="PROVISIONAL",
                        utility_score=1.0
                    )
                    session.add(entry)
                    await session.commit()
                    await session.refresh(entry)
                    created_entries.append({
                        "id": entry.id,
                        "category": entry.category,
                        "trigger_pattern": entry.trigger_pattern,
                        "insight": entry.insight,
                        "status": entry.status
                    })
                    logger.info(f"Recorded provisional heuristic from Turn {turn_index} in Task {task_id}: {entry.insight[:80]}...")

    return created_entries


async def promote_task_memories(task_id: str, session: Optional[AsyncSession] = None) -> int:
    """
    Promotes all PROVISIONAL memories for a task to PROMOTED upon successful task completion.
    """
    from app.api.websocket import ws_manager

    promoted_count = 0
    stmt = (
        update(KnowledgeEntryModel)
        .where(
            KnowledgeEntryModel.source_task_id == task_id,
            KnowledgeEntryModel.status == "PROVISIONAL"
        )
        .values(status="PROMOTED", updated_at=get_utc_now())
        .returning(KnowledgeEntryModel.id)
    )

    if session is not None:
        res = await session.execute(stmt)
        promoted_ids = res.scalars().all()
        promoted_count = len(promoted_ids)
    else:
        async with async_session_factory() as sess:
            res = await sess.execute(stmt)
            promoted_ids = res.scalars().all()
            promoted_count = len(promoted_ids)
            await sess.commit()

    if promoted_count > 0:
        logger.info(f"Promoted {promoted_count} provisional memories to PROMOTED for Task {task_id}")
        try:
            await ws_manager.broadcast("MEMORY_PROMOTED", {
                "task_id": task_id,
                "promoted_count": promoted_count
            })
        except Exception as e:
            logger.warning(f"Failed to broadcast MEMORY_PROMOTED: {e}")

    return promoted_count


async def rollback_turn_memories(
    task_id: str,
    from_turn_index: int,
    session: Optional[AsyncSession] = None
) -> int:
    """
    Deletes all PROVISIONAL memories created at or after from_turn_index when a turn is rewound.
    """
    from app.api.websocket import ws_manager

    deleted_count = 0
    stmt = (
        delete(KnowledgeEntryModel)
        .where(
            KnowledgeEntryModel.source_task_id == task_id,
            KnowledgeEntryModel.source_turn_index >= from_turn_index,
            KnowledgeEntryModel.status == "PROVISIONAL"
        )
        .returning(KnowledgeEntryModel.id)
    )

    if session is not None:
        res = await session.execute(stmt)
        deleted_ids = res.scalars().all()
        deleted_count = len(deleted_ids)
    else:
        async with async_session_factory() as sess:
            res = await sess.execute(stmt)
            deleted_ids = res.scalars().all()
            deleted_count = len(deleted_ids)
            await sess.commit()

    if deleted_count > 0:
        logger.info(f"Purged {deleted_count} provisional memories for Task {task_id} from Turn >= {from_turn_index}")
        try:
            await ws_manager.broadcast("MEMORY_INVALIDATED", {
                "task_id": task_id,
                "from_turn_index": from_turn_index,
                "purged_count": deleted_count
            })
        except Exception as e:
            logger.warning(f"Failed to broadcast MEMORY_INVALIDATED: {e}")

    return deleted_count


async def retrieve_relevant_heuristics(
    repo_id: Optional[str] = None,
    prompt: str = "",
    target_files: Optional[List[str]] = None,
    limit: int = 3
) -> List[Dict[str, Any]]:
    """
    Retrieves the top-k highest utility PROMOTED heuristics relevant to the active context.
    Matches repository ID, trigger keywords, and target files.
    """
    heuristics: List[Dict[str, Any]] = []
    target_basenames = [os.path.basename(f) for f in (target_files or []) if f]
    prompt_tokens = set(re.findall(r'[a-zA-Z0-9_-]{3,}', prompt.lower())) if prompt else set()

    async with async_session_factory() as session:
        # Match repo-specific OR global (repo_id IS NULL) promoted memories
        stmt = (
            select(KnowledgeEntryModel)
            .where(
                KnowledgeEntryModel.status == "PROMOTED",
                or_(
                    KnowledgeEntryModel.repo_id == repo_id,
                    KnowledgeEntryModel.repo_id.is_(None)
                ) if repo_id else KnowledgeEntryModel.status == "PROMOTED"
            )
            .order_by(KnowledgeEntryModel.utility_score.desc(), KnowledgeEntryModel.usage_count.desc())
            .limit(20)
        )
        res = await session.execute(stmt)
        candidates = res.scalars().all()

        for c in candidates:
            # Score relevance
            score = c.utility_score
            matched = False

            # Check trigger pattern match
            c_tokens = set(re.findall(r'[a-zA-Z0-9_-]{3,}', c.trigger_pattern.lower()))
            overlap = prompt_tokens.intersection(c_tokens)
            if overlap:
                score += len(overlap) * 0.5
                matched = True

            # Check context files match
            c_files = c.context_files or []
            if any(tf in c_files for tf in target_basenames):
                score += 1.5
                matched = True

            # Always consider high-utility global rules if no specific match
            if matched or c.utility_score >= 1.5:
                heuristics.append({
                    "id": c.id,
                    "category": c.category,
                    "trigger_pattern": c.trigger_pattern,
                    "insight": c.insight,
                    "context_files": c.context_files,
                    "utility_score": round(score, 2),
                    "usage_count": c.usage_count
                })

    # Sort by calculated score and take top-limit
    heuristics.sort(key=lambda x: x["utility_score"], reverse=True)
    return heuristics[:limit]


def format_working_memory_block(heuristics: List[Dict[str, Any]]) -> str:
    """
    Formats a concise, high-priority prompt section strictly capped at 400 tokens (~1600 characters).
    """
    if not heuristics:
        return ""

    lines = ["[System Experiential Memory - Verified Lessons]:"]
    total_len = len(lines[0])

    for h in heuristics:
        entry_text = f"- {h['insight']}"
        if total_len + len(entry_text) > 1500:
            break
        lines.append(entry_text)
        total_len += len(entry_text) + 1

    return "\n".join(lines)


async def vote_memory_heuristic(memory_id: str, delta: float) -> Optional[Dict[str, Any]]:
    """
    Adjusts the utility score of a heuristic. If score drops below 0.3, marks INVALIDATED.
    """
    async with async_session_factory() as session:
        stmt = select(KnowledgeEntryModel).where(KnowledgeEntryModel.id == memory_id)
        res = await session.execute(stmt)
        entry = res.scalars().first()
        if not entry:
            return None

        entry.utility_score = max(0.1, min(10.0, round(entry.utility_score + delta, 2)))
        entry.usage_count += 1
        if entry.utility_score < 0.3:
            entry.status = "INVALIDATED"
            logger.info(f"Knowledge entry {memory_id} invalidated due to low utility score ({entry.utility_score})")

        entry.updated_at = get_utc_now()
        await session.commit()
        await session.refresh(entry)

        return {
            "id": entry.id,
            "utility_score": entry.utility_score,
            "status": entry.status,
            "usage_count": entry.usage_count
        }


async def cascade_delete_task_memories(task_id: str, session: Optional[AsyncSession] = None) -> None:
    """
    Handles memory cleanup when a task is deleted:
    - Provisional or unreinforced memories are pruned.
    - Verified, multi-task promoted memories have source_task_id detached so global repository knowledge survives.
    """
    async def _do_cleanup(sess: AsyncSession):
        # 1. Prune provisional memories
        await sess.execute(
            delete(KnowledgeEntryModel).where(
                KnowledgeEntryModel.source_task_id == task_id,
                KnowledgeEntryModel.status == "PROVISIONAL"
            )
        )
        # 2. Detach provenance for promoted memories with high utility
        await sess.execute(
            update(KnowledgeEntryModel)
            .where(
                KnowledgeEntryModel.source_task_id == task_id,
                KnowledgeEntryModel.status == "PROMOTED",
                KnowledgeEntryModel.utility_score >= 1.0
            )
            .values(source_task_id=None, updated_at=get_utc_now())
        )
        # 3. Delete any remaining low-utility promoted memories tied only to this deleted task
        await sess.execute(
            delete(KnowledgeEntryModel).where(
                KnowledgeEntryModel.source_task_id == task_id
            )
        )

    if session is not None:
        await _do_cleanup(session)
    else:
        async with async_session_factory() as sess:
            await _do_cleanup(sess)
            await sess.commit()
