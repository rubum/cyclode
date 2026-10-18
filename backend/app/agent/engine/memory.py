import re
import os
import json
import math
import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timezone
from sqlalchemy import select, delete, update, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_factory
from app.db.models import KnowledgeEntryModel, TaskModel, RepositoryConfigModel, get_utc_now
from app.agent.semantic_cache import compute_fallback_embedding, cosine_similarity
from app.agent.engine.cortex_bridge import CortexDBBridge

logger = logging.getLogger("cyclode.memory")

# CortexDB Epistemic Knowledge Contract Grades & Retrieval Weights
EPISTEMIC_GRADE_WEIGHTS: Dict[str, float] = {
    "verified": 1.25,         # Human-reviewed / upvoted rule
    "self_consistent": 1.10,  # Deterministically verified from error->recovery or passing test
    "asserted": 1.00,         # Model or user asserted, unchecked default
    "held": 0.70,             # Provisional / awaiting verification
    "refused": 0.00,          # Invalidated / contradicted
}

TRIVIAL_PROMPTS = {
    "ok", "okay", "yes", "yep", "sure", "go", "go ahead", "proceed",
    "continue", "thanks", "thank you", "thx", "done", "lgtm", "cool",
    "great", "nice", "good", "ack", "approved", "ship it"
}

STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "into", "when",
    "where", "what", "which", "who", "whom", "whose", "why", "how", "are",
    "was", "were", "been", "being", "have", "has", "had", "having", "does",
    "did", "doing", "will", "would", "shall", "should", "can", "could",
    "may", "might", "must", "ought", "need", "please", "check", "make",
    "use", "using", "used", "file", "files", "code", "task", "turn"
}


def _slugify_token(text: str, max_len: int = 64) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return cleaned[:max_len].strip("-") or "general"


def compute_memory_slug(
    category: str,
    trigger_pattern: str,
    context_files: Optional[List[str]] = None
) -> str:
    """
    Computes a deterministic CortexDB-style memory slug (`auto:<scope>:<topic>`)
    so repeated captures of the same heuristic update or supersede prior records
    instead of accumulating duplicates.
    """
    cat_slug = _slugify_token(category or "heuristic", max_len=32)
    file_part = ""
    if context_files:
        first_file = os.path.basename(str(context_files[0]).strip())
        if first_file:
            file_part = _slugify_token(first_file, max_len=40)

    # Extract key error class or core trigger tokens
    trigger_clean = (trigger_pattern or "").strip()
    err_match = re.search(r"\b([A-Za-z0-9_]*(?:Error|Exception|Warning|Fault|Failure|Timeout|Conflict))\b", trigger_clean)
    if err_match:
        topic_slug = _slugify_token(err_match.group(1), max_len=48)
        tokens = [t for t in re.findall(r"[a-zA-Z0-9_]{3,}", trigger_clean.lower()) if t not in STOPWORDS]
        extra = "-".join(tokens[:3])
        if extra and extra != topic_slug:
            topic_slug = _slugify_token(f"{topic_slug}-{extra}", max_len=64)
    else:
        tokens = [t for t in re.findall(r"[a-zA-Z0-9_]{3,}", trigger_clean.lower()) if t not in STOPWORDS]
        topic_slug = _slugify_token("-".join(tokens[:5]) or trigger_clean, max_len=64)

    if file_part:
        return f"auto:{cat_slug}:{file_part}:{topic_slug}"[:190]
    return f"auto:{cat_slug}:{topic_slug}"[:190]


def extract_entities_and_relations(
    trigger_pattern: str,
    insight: str,
    context_files: Optional[List[str]] = None,
    category: str = "failure_recovery",
    is_mutation: bool = True,
) -> Tuple[List[str], List[Dict[str, str]]]:
    """
    Deterministically extracts canonical entity names and property-graph relation
    triples (`subject —predicate→ object`) from a memory entry without requiring an LLM.
    Mirrors CortexDB's inline `entities` and `relations` on MemorySaveRequest.
    """
    entities: List[str] = []
    relations: List[Dict[str, str]] = []

    def _add_entity(name: str):
        clean = name.strip()
        if clean and len(clean) >= 2 and clean not in entities:
            entities.append(clean)

    file_entities: List[str] = []
    for f in (context_files or []):
        if f:
            bname = os.path.basename(str(f).strip())
            if bname:
                _add_entity(bname)
                file_entities.append(bname)

    combined_text = f"{trigger_pattern or ''} {insight or ''}"

    # 1. Extract error / exception classes
    error_classes = re.findall(
        r"\b([A-Za-z0-9_.]*(?:Error|Exception|Timeout|Locked|Mismatch|Violation))\b",
        combined_text
    )
    for err_cls in error_classes[:4]:
        _add_entity(err_cls)

    # 2. Extract file references mentioned in text
    text_files = re.findall(
        r"\b([a-zA-Z0-9_-]+\.(?:py|ts|tsx|js|jsx|go|rs|sql|json|yaml|yml|toml|md|proto|sh))\b",
        combined_text
    )
    for tf in text_files[:4]:
        _add_entity(tf)
        if tf not in file_entities:
            file_entities.append(tf)

    # 3. Extract CamelCase or CONSTANT_CASE identifiers
    symbols = re.findall(
        r"\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+|[A-Z]{2,}(?:_[A-Z0-9]+)+)\b",
        combined_text
    )
    for sym in symbols[:5]:
        if sym not in {"When", "Resolved", "Successfully", "Traceback"}:
            _add_entity(sym)

    # Build relational edges
    primary_subject = file_entities[0] if file_entities else (entities[0] if entities else category)
    predicate = "resolves" if category == "failure_recovery" else (
        "governs" if category in {"architecture", "architecture_rule"} else "uses_pattern"
    )

    for err_cls in error_classes[:3]:
        if err_cls != primary_subject:
            relations.append({
                "subject": primary_subject,
                "predicate": predicate,
                "object": err_cls
            })

    for sym in symbols[:3]:
        if sym != primary_subject and sym not in error_classes:
            relations.append({
                "subject": primary_subject,
                "predicate": "references",
                "object": sym
            })

    if len(file_entities) >= 2:
        file_edge_predicate = "co_modified_with" if is_mutation else "related_to"
        for other_file in file_entities[1:3]:
            if other_file != primary_subject:
                relations.append({
                    "subject": primary_subject,
                    "predicate": file_edge_predicate,
                    "object": other_file
                })

    if not relations and len(entities) >= 2:
        relations.append({
            "subject": entities[0],
            "predicate": predicate,
            "object": entities[1]
        })

    return entities[:12], relations[:10]


def plan_memory_query(
    prompt: str,
    target_files: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    CortexDB-style query planner (`memoryflow.QueryPlanner`).
    - Skips recall on bare acknowledgements ("ok", "go ahead", "thanks") when no target files are specified.
    - Extracts high-signal keywords, entity candidates, and file basenames.
    - Selects retrieval lanes (`lexical`, `vector`, `graph`).
    """
    raw = (prompt or "").strip()
    norm_clean = re.sub(r"[^\w\s]", "", raw.lower()).strip()
    file_basenames = [os.path.basename(f) for f in (target_files or []) if f]

    if (not norm_clean or norm_clean in TRIVIAL_PROMPTS or len(norm_clean) <= 2) and not file_basenames:
        return {
            "should_recall": False,
            "reason": "trivial_or_empty_prompt",
            "keywords": [],
            "entities": [],
            "target_files": [],
            "lanes": [],
            "retrieval_mode": "skip",
        }

    tokens = re.findall(r"[a-zA-Z0-9_.-]{3,}", raw)
    keywords: List[str] = []
    entities: List[str] = list(file_basenames)

    for tok in tokens:
        low = tok.lower().strip("._-")
        if len(low) < 3 or low in STOPWORDS:
            continue
        if low not in keywords:
            keywords.append(low)
        # Detect entity-like tokens (file names, CamelCase, error types, snake_case identifiers)
        if (
            "." in tok
            or "_" in tok
            or any(c.isupper() for c in tok[1:])
            or tok.endswith(("Error", "Exception", "Model", "Router", "Service", "Bridge"))
        ):
            if tok not in entities:
                entities.append(tok)

    lanes = ["lexical", "vector"]
    if entities or file_basenames:
        lanes.append("graph")

    return {
        "should_recall": True,
        "reason": "planned_hybrid_recall",
        "keywords": keywords[:15],
        "entities": entities[:10],
        "target_files": file_basenames,
        "lanes": lanes,
        "retrieval_mode": "auto_rrf_graph" if "graph" in lanes else "hybrid_rrf",
    }


def _extract_files_from_command(cmd: str) -> List[str]:
    """Extracts plausible file/path references from a shell command string."""
    if not cmd:
        return []
    found: List[str] = []
    for m in re.finditer(r"\b([a-zA-Z0-9_./-]+\.(?:py|ts|tsx|js|jsx|go|rs|sql|json|yaml|yml|toml|md|proto|sh))\b", cmd):
        raw_path = m.group(1).lstrip("./")
        base = os.path.basename(raw_path)
        if base and base not in found and "*" not in base:
            found.append(base)
    return found[:6]


def _truncate_clean(text: str, max_len: int = 120) -> str:
    """Truncates text on a word/token boundary and closes any open backtick."""
    s = " ".join((text or "").strip().split())
    if len(s) <= max_len:
        return s
    cut = s[:max_len]
    last_space = cut.rfind(" ")
    if last_space > max_len // 2:
        cut = cut[:last_space]
    cut = cut.rstrip(" ,;|&-:")
    if cut.count("`") % 2 == 1:
        cut += "`"
    return cut + "…"


def _is_inline_adhoc_script(cmd: str) -> bool:
    """Detects multiline heredoc or inline -c/-e scratchpad scripts."""
    if not cmd:
        return False
    return bool(
        re.search(
            r"(?:<<\s*['\"]?[A-Za-z_]+['\"]?|\bpython3?\s+-\s*<<|\bpython3?\s+-c\b|\bnode\s+-e\b|\bruby\s+-e\b)",
            cmd,
        )
    )


def _synthesize_known_pitfall(error_snippet: str, failed_cmd: str = "") -> Optional[Dict[str, str]]:
    """
    Maps recurring runtime/sandbox/tooling pitfalls to clean, human-grade reusable rules
    instead of dumping raw command bodies.
    """
    err = error_snippet or ""
    if "f-string expression part cannot include a backslash" in err:
        return {
            "category": "tool_recipe",
            "trigger_pattern": "SyntaxError: f-string expression part cannot include a backslash",
            "insight": (
                "Target Python runtime (<3.12) forbids backslashes inside `{...}` f-string expressions; "
                "pre-compute escaped strings in a variable before formatting or use a heredoc block."
            ),
        }
    if "DAEMON CIRCUIT-BREAKER REJECTED COMMAND" in err:
        pat_match = re.search(r"detected in '([^']+)'", err)
        blocked_pat = pat_match.group(1).rstrip("\\") if pat_match else "foreground server pattern"
        return {
            "category": "tool_recipe",
            "trigger_pattern": f"DAEMON CIRCUIT-BREAKER REJECTED COMMAND (`{blocked_pat}`)",
            "insight": (
                f"Avoid regex patterns matching foreground server daemons (such as `{blocked_pat}`) in `run_command`; "
                f"Cyclode's daemon circuit-breaker rejects them. Use `read_file` or a narrower pattern instead."
            ),
        }
    return None


def _split_clean_subcommands(cmd: str) -> List[str]:
    """
    Splits a compound shell command (`&&`, `;`) into individual subcommands,
    filtering out pure glue (`cd ...`, `echo ...`, `true`, `pwd`) and stripping
    trailing pipe/redirection scaffolding (`2>/dev/null`, `| head ...`).
    """
    if not cmd or _is_inline_adhoc_script(cmd):
        return []
    parts = re.split(r"\s*(?:&&|;|\r?\n)\s*", cmd.strip())
    cleaned: List[str] = []
    for p in parts:
        sub = p.strip()
        if not sub:
            continue
        low = sub.strip("() ").lower()
        if (
            low.startswith(("cd ", "echo ", "echo\t", "export path="))
            or low in {"echo", "pwd", "true"}
        ):
            continue
        sub = re.sub(r"\s+2>(?:/dev/null|&1)\b", "", sub)
        sub = re.sub(r"\s*\|\s*(?:head|tail)(?:\s+-[a-zA-Z0-9]+\s*\d*|\s+\d+)?\s*$", "", sub)
        sub = " ".join(sub.split())
        if sub:
            cleaned.append(sub)
    return cleaned


def _extract_command_target_tokens(subcmd: str) -> set:
    """Extracts meaningful path/identifier tokens from a single subcommand."""
    noise = {
        "grep", "find", "cat", "ls", "head", "tail", "sed", "awk", "wc",
        "python", "python3", "pytest", "npm", "npx", "node", "cargo", "go",
        "git", "docker", "exec", "run", "test", "build", "maxdepth", "type",
        "null", "dev", "true", "false"
    }
    tokens = set()
    for tok in re.findall(r"[a-zA-Z0-9_./-]{3,}", subcmd.lower()):
        stem = tok.strip("./-_")
        if not stem or stem in noise or stem in STOPWORDS or stem.isdigit():
            continue
        tokens.add(stem)
        base = os.path.basename(stem)
        if base and len(base) >= 3 and base not in noise:
            tokens.add(base)
            root_name = os.path.splitext(base)[0]
            if len(root_name) >= 3 and root_name not in noise:
                tokens.add(root_name)
    return tokens


def _find_causal_subcommand_pair(
    prev_cmd: str,
    prev_out: str,
    rec_cmd: str
) -> Optional[Tuple[str, str, List[str]]]:
    """
    Determines whether `rec_cmd` causally resolves the failing subcommand in `prev_cmd`
    rather than merely running an unrelated subsequent command.
    Returns `(failed_subcommand, resolved_subcommand, relevant_files)` if causally linked,
    or `None` if `rec_cmd` abandoned the failing target.
    """
    prev_subs = _split_clean_subcommands(prev_cmd)
    rec_subs = _split_clean_subcommands(rec_cmd)
    if not prev_subs or not rec_subs:
        return None

    # Focus on actual error lines in prev_out rather than stdout from earlier succeeding subcommands
    raw_lines = [ln.strip() for ln in (prev_out or "").splitlines() if ln.strip() and ln.strip() != "stderr:"]
    err_lines = [
        ln for ln in raw_lines
        if any(
            k in ln
            for k in ("Error", "Exception", "failed", "Fatal", "No such file", "not found", "REJECTED", "invalid", "cannot")
        )
    ]
    err_focus = "\n".join(err_lines if err_lines else raw_lines[-2:]).lower()

    failing_sub = prev_subs[-1]
    best_err_overlap = -1
    for sub in prev_subs:
        toks = _extract_command_target_tokens(sub)
        overlap = sum(1 for t in toks if t in err_focus)
        if overlap >= best_err_overlap and overlap > 0:
            best_err_overlap = overlap
            failing_sub = sub

    fail_tokens = _extract_command_target_tokens(failing_sub)
    if not fail_tokens:
        return None

    # Find the subcommand in rec_cmd that shares the strongest target overlap with failing_sub
    best_rec_sub = None
    best_shared: set = set()
    for rsub in rec_subs:
        rtoks = _extract_command_target_tokens(rsub)
        shared = fail_tokens.intersection(rtoks)
        if len(shared) > len(best_shared) and rsub != failing_sub:
            best_shared = shared
            best_rec_sub = rsub

    if not best_rec_sub or not best_shared:
        return None

    rel_files: List[str] = []
    for f in _extract_files_from_command(failing_sub) + _extract_files_from_command(best_rec_sub):
        if f not in rel_files:
            rel_files.append(f)

    return failing_sub, best_rec_sub, rel_files


def _extract_causal_insight(
    error_snippet: str,
    resolution_snippet: str,
    files: List[str],
    failed_cmd: str = "",
    exit_code: int = 0,
    is_mutation: bool = True,
    category: str = "failure_recovery",
) -> Optional[Dict[str, Any]]:
    """
    Extracts an actionable, condensed heuristic from an error-recovery pair.
    Separates `trigger_pattern` (when the heuristic applies) from `insight` (the resolution rule).
    """
    if not (error_snippet or failed_cmd) or not resolution_snippet:
        return None

    known = _synthesize_known_pitfall(error_snippet, failed_cmd)
    if known:
        category = known["category"]
        key_error = known["trigger_pattern"]
        insight = known["insight"]
    else:
        lines = [line.strip() for line in (error_snippet or "").split("\n") if line.strip() and line.strip() != "stderr:"]
        key_error = ""
        for line in reversed(lines):
            if any(
                err in line
                for err in [
                    "Error",
                    "Exception",
                    "failed",
                    "Fatal",
                    "cannot import",
                    "REJECTED",
                    "No such file",
                    "not found",
                    "invalid",
                ]
            ):
                key_error = _truncate_clean(line, 120)
                break

        if not key_error:
            if failed_cmd and exit_code != 0:
                compact_cmd = _truncate_clean(failed_cmd, 90)
                key_error = f"Command exited with code {exit_code}: `{compact_cmd}`"
            elif lines:
                key_error = _truncate_clean(lines[-1], 120)

        res_clean = _truncate_clean(resolution_snippet.replace("\n", " "), 180)
        insight = f"Resolve by {res_clean}." if not res_clean.endswith((".", "`")) else f"Resolve by {res_clean}"

    ctx_files = []
    for f in files:
        if f:
            b = os.path.basename(f)
            if b and b not in ctx_files and "*" not in b:
                ctx_files.append(b)
    slug = compute_memory_slug(category, key_error or "runtime_error", ctx_files)
    entities, relations = extract_entities_and_relations(
        key_error or "runtime_error",
        insight,
        ctx_files,
        category=category,
        is_mutation=is_mutation,
    )

    return {
        "trigger_pattern": key_error or "runtime_error",
        "insight": insight,
        "context_files": ctx_files,
        "category": category,
        "slug": slug,
        "epistemic_grade": "self_consistent",
        "entities": entities,
        "relations": relations,
    }


async def _resolve_valid_repo_id(session: AsyncSession, repo_id_or_name: Optional[str]) -> Optional[str]:
    """
    Ensures `repo_id` satisfies the `repository_configs.id` foreign key before insert.
    Accepts either a UUID (`RepositoryConfigModel.id`) or repo name (`full_name` / `name`).
    Returns `None` if no matching row exists in `repository_configs`.
    """
    if not repo_id_or_name:
        return None
    stmt = select(RepositoryConfigModel.id).where(
        or_(
            RepositoryConfigModel.id == repo_id_or_name,
            RepositoryConfigModel.full_name == repo_id_or_name,
            RepositoryConfigModel.name == repo_id_or_name,
        )
    )
    res = await session.execute(stmt)
    return res.scalars().first()


async def upsert_knowledge_entry(
    session: AsyncSession,
    *,
    trigger_pattern: str,
    insight: str,
    category: str = "failure_recovery",
    context_files: Optional[List[str]] = None,
    repo_id: Optional[str] = None,
    source_task_id: Optional[str] = None,
    source_turn_index: Optional[int] = None,
    git_commit_sha: Optional[str] = None,
    status: str = "PROVISIONAL",
    utility_score: float = 1.0,
    slug: Optional[str] = None,
    epistemic_grade: Optional[str] = None,
    entities: Optional[List[str]] = None,
    relations: Optional[List[Dict[str, Any]]] = None,
    is_mutation: bool = True,
) -> Tuple[KnowledgeEntryModel, List[str]]:
    """
    Creates a knowledge entry and applies CortexDB slug-based supersession:
    - Validates `repo_id` against `RepositoryConfigModel` to prevent FK errors.
    - Computes canonical `slug`, `entities`, `relations`, `epistemic_grade`, and `embedding_json`.
    - Marks any older active entries under the same `(slug, repo_id)` as `SUPERSEDED`
      with `superseded_by = new_entry.id`.
    """
    valid_repo_id = await _resolve_valid_repo_id(session, repo_id)
    ctx_files = [os.path.basename(f) if "/" in f else f for f in (context_files or []) if f and "*" not in f]
    resolved_slug = slug or compute_memory_slug(category, trigger_pattern, ctx_files)
    auto_entities, auto_relations = extract_entities_and_relations(
        trigger_pattern, insight, ctx_files, category=category, is_mutation=is_mutation
    )
    resolved_entities = list(entities) if entities is not None else list(auto_entities)
    if repo_id and not valid_repo_id and repo_id not in resolved_entities:
        resolved_entities.append(repo_id)
    resolved_relations = relations if relations is not None else auto_relations
    resolved_grade = epistemic_grade or (
        "self_consistent" if category == "failure_recovery" else "asserted"
    )
    emb_vec = compute_fallback_embedding(f"{trigger_pattern} {insight} {' '.join(ctx_files)}")
    emb_json = json.dumps(emb_vec)

    # Find prior active memories with the same slug in the same repo scope
    prior_stmt = select(KnowledgeEntryModel).where(
        KnowledgeEntryModel.slug == resolved_slug,
        KnowledgeEntryModel.status.in_(["PROVISIONAL", "PROMOTED"]),
        KnowledgeEntryModel.repo_id == valid_repo_id if valid_repo_id else KnowledgeEntryModel.repo_id.is_(None),
    )
    prior_res = await session.execute(prior_stmt)
    prior_entries = prior_res.scalars().all()

    entry = KnowledgeEntryModel(
        repo_id=valid_repo_id,
        source_task_id=source_task_id,
        source_turn_index=source_turn_index,
        git_commit_sha=git_commit_sha,
        category=category,
        trigger_pattern=trigger_pattern,
        insight=insight,
        context_files=ctx_files,
        slug=resolved_slug,
        epistemic_grade=resolved_grade,
        entities=resolved_entities,
        relations=resolved_relations,
        embedding_json=emb_json,
        status=status,
        utility_score=utility_score,
    )
    session.add(entry)
    await session.flush()

    superseded_ids: List[str] = []
    for old in prior_entries:
        if old.id != entry.id:
            old.status = "SUPERSEDED"
            old.superseded_by = entry.id
            old.updated_at = get_utc_now()
            superseded_ids.append(old.id)

    await session.commit()
    await session.refresh(entry)

    # Best-effort mirror to Tier-1 CortexDB sidecar if active
    CortexDBBridge.remember_BestEffort(
        memory_id=entry.id,
        content=entry.insight,
        scope=valid_repo_id or repo_id or "global",
        entities=resolved_entities,
        relations=resolved_relations,
    )

    return entry, superseded_ids


async def extract_turn_heuristics(
    task_id: str,
    turn_index: int,
    tool_logs: List[Dict[str, Any]],
    diff_files: Optional[List[str]] = None,
    repo_id: Optional[str] = None,
    git_commit_sha: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Analyzes turn tool execution logs for:
    1. Causal error-recovery patterns (requiring target/file overlap for command-to-command pairs,
       summarizing subcommands cleanly, and distinguishing mutating fixes from read-only inspections).
    2. Verified multi-file architectural co-change patterns when >=2 files are modified and verified cleanly.
    """
    if not tool_logs or len(tool_logs) < 2:
        return []

    created_entries: List[Dict[str, Any]] = []
    seen_slugs: set = set()
    read_only_tools = {
        "read_file", "view_file", "list_dir", "list_files", "search_files",
        "grep_search", "extract_outline", "delegate_subagent", "invoke_subagent",
        "web_search", "search_web", "fetch_url", "read_url_content", "think"
    }
    mutating_keywords = ("edit", "replace", "write", "patch", "create_file")

    for i in range(len(tool_logs) - 1):
        prev_log = tool_logs[i]
        prev_exit = prev_log.get("exit_code", 0) or 0
        prev_out = prev_log.get("tool_output", "") or ""
        prev_name = (prev_log.get("tool_name") or "").lower()
        prev_inp = prev_log.get("tool_input") or {}
        prev_cmd = (prev_inp.get("command") or prev_inp.get("CommandLine") or "") if isinstance(prev_inp, dict) else ""

        # Avoid false-positive substring matches on read-only file inspections or subagent summaries that succeeded (exit_code == 0)
        has_error = prev_exit != 0 or (
            prev_name not in read_only_tools
            and any(
                err in prev_out
                for err in ["Traceback", "OperationalError", "SyntaxError", "ImportError", "DAEMON CIRCUIT-BREAKER REJECTED COMMAND", "Error:"]
            )
        )
        if not has_error:
            continue

        known_pitfall = _synthesize_known_pitfall(prev_out, prev_cmd)
        is_circuit_breaker = "DAEMON CIRCUIT-BREAKER REJECTED COMMAND" in prev_out

        # Look ahead up to 3 steps in the same turn so error -> read_file -> edit_file recovery is captured
        recovery_log = None
        causal_sub_pair: Optional[Tuple[str, str, List[str]]] = None

        for j in range(i + 1, min(i + 4, len(tool_logs))):
            cand = tool_logs[j]
            cand_exit = cand.get("exit_code", 0) or 0
            cand_out = cand.get("tool_output", "") or ""
            cand_name = (cand.get("tool_name") or "").lower()
            is_clean = cand_exit == 0 and (
                cand_name in read_only_tools
                or not any(err in cand_out for err in ["Traceback", "Error:", "REJECTED COMMAND"])
            )
            if not is_clean:
                continue

            is_cand_mutating = any(k in cand_name for k in mutating_keywords)
            if is_cand_mutating:
                recovery_log = cand
                break

            if "run_command" in cand_name or "command" in cand_name:
                cand_inp = cand.get("tool_input") or {}
                cand_cmd = (cand_inp.get("command") or cand_inp.get("CommandLine") or "") if isinstance(cand_inp, dict) else ""
                if known_pitfall is not None and j == i + 1:
                    recovery_log = cand
                    break
                # Skip throwaway inline heredoc/-c scratchpad scripts unless they matched a known pitfall
                if _is_inline_adhoc_script(prev_cmd) or _is_inline_adhoc_script(cand_cmd):
                    break
                if prev_cmd and cand_cmd:
                    pair = _find_causal_subcommand_pair(prev_cmd, prev_out, cand_cmd)
                    if pair is not None:
                        causal_sub_pair = pair
                        recovery_log = cand
                        break
                    # Unrelated command ran next -> agent moved on; do not look ahead past it
                    break
                elif not prev_cmd and j == i + 1:
                    recovery_log = cand
                    break

        if recovery_log is not None:
            t_name = recovery_log.get("tool_name", "tool")
            is_mut = any(k in t_name.lower() for k in mutating_keywords) or bool(diff_files)
            inp = recovery_log.get("tool_input") or {}
            target_f = (inp.get("TargetFile") or inp.get("file_path") or inp.get("path")) if isinstance(inp, dict) else None
            rec_cmd = (inp.get("command") or inp.get("CommandLine") or "") if isinstance(inp, dict) else ""
            entry_category = "failure_recovery"

            if known_pitfall is not None:
                entry_category = known_pitfall["category"]
                target_files = []
                res_desc = known_pitfall["insight"]
                effective_failed_cmd = prev_cmd
            elif causal_sub_pair is not None:
                failed_sub, resolved_sub, sub_files = causal_sub_pair
                target_files = list(diff_files or [])
                for sf in sub_files:
                    if sf not in target_files:
                        target_files.append(sf)
                res_desc = f"running `{_truncate_clean(resolved_sub, 130)}`"
                effective_failed_cmd = failed_sub
            else:
                target_files = list(diff_files or [])
                if target_f and target_f not in target_files:
                    target_files.append(target_f)
                res_desc = f"executing `{t_name}` successfully"
                if is_mut:
                    res_desc = f"modifying `{os.path.basename(target_f)}`" if target_f else "modifying the target file"
                elif rec_cmd:
                    subs = _split_clean_subcommands(rec_cmd)
                    clean_rec = subs[0] if subs else " ".join(rec_cmd.strip().split())
                    res_desc = f"running `{_truncate_clean(clean_rec, 130)}`"
                effective_failed_cmd = prev_cmd

            extracted = _extract_causal_insight(
                prev_out,
                res_desc,
                target_files,
                failed_cmd=effective_failed_cmd,
                exit_code=prev_exit,
                is_mutation=is_mut,
                category=entry_category,
            )
            if extracted and extracted["slug"] not in seen_slugs:
                seen_slugs.add(extracted["slug"])
                async with async_session_factory() as session:
                    entry, superseded_ids = await upsert_knowledge_entry(
                        session,
                        repo_id=repo_id,
                        source_task_id=task_id,
                        source_turn_index=turn_index,
                        git_commit_sha=git_commit_sha,
                        category=extracted["category"],
                        trigger_pattern=extracted["trigger_pattern"],
                        insight=extracted["insight"],
                        context_files=extracted["context_files"],
                        slug=extracted["slug"],
                        epistemic_grade=extracted["epistemic_grade"],
                        entities=extracted["entities"],
                        relations=extracted["relations"],
                        status="PROVISIONAL",
                        utility_score=1.0,
                        is_mutation=is_mut,
                    )
                    created_entries.append({
                        "id": entry.id,
                        "category": entry.category,
                        "trigger_pattern": entry.trigger_pattern,
                        "insight": entry.insight,
                        "context_files": entry.context_files,
                        "status": entry.status,
                        "slug": entry.slug,
                        "epistemic_grade": entry.epistemic_grade,
                        "entities": entry.entities,
                        "relations": entry.relations,
                        "superseded_ids": superseded_ids,
                    })
                    logger.info(
                        f"Recorded provisional heuristic [{entry.slug}] from Turn {turn_index} "
                        f"in Task {task_id}: {entry.insight[:80]}..."
                    )

    # 2. Clean-turn architectural co-change & verification extraction:
    # If >=2 files were modified and verified by a passing test/build command in the turn,
    # record a self-consistent `architecture_rule` heuristic.
    modified_files: List[str] = [os.path.basename(f) for f in (diff_files or []) if f]
    verification_cmd: Optional[str] = None
    verify_runners = ("pytest", "npm test", "npm run build", "cargo test", "go test", "tsc", "vitest", "jest")
    for log in tool_logs:
        t_name = (log.get("tool_name") or "").lower()
        t_inp = log.get("tool_input") or {}
        t_exit = log.get("exit_code", 0) or 0
        if t_exit != 0 or not isinstance(t_inp, dict):
            continue
        if any(k in t_name for k in mutating_keywords):
            tf = t_inp.get("TargetFile") or t_inp.get("file_path") or t_inp.get("path")
            if tf:
                b = os.path.basename(str(tf))
                if b and b not in modified_files:
                    modified_files.append(b)
        elif "command" in t_name:
            cmd_str = t_inp.get("command") or t_inp.get("CommandLine") or ""
            if any(v in cmd_str.lower() for v in verify_runners):
                subs = _split_clean_subcommands(cmd_str)
                matching_subs = [s for s in subs if any(v in s.lower() for v in verify_runners)]
                if matching_subs:
                    verification_cmd = matching_subs[-1]
                elif subs:
                    verification_cmd = subs[-1]
                else:
                    verification_cmd = _truncate_clean(cmd_str, 120)

    if len(modified_files) >= 2 and verification_cmd:
        primary_f = modified_files[0]
        co_files = ", ".join(modified_files[1:4])
        trigger = f"Co-modifying {primary_f} with {co_files}"
        insight = (
            f"Changes spanning {', '.join(modified_files[:4])} should be kept in sync "
            f"and verified via `{verification_cmd}`."
        )
        arch_slug = compute_memory_slug("architecture_rule", trigger, modified_files[:4])
        if arch_slug not in seen_slugs:
            seen_slugs.add(arch_slug)
            async with async_session_factory() as session:
                entry, superseded_ids = await upsert_knowledge_entry(
                    session,
                    repo_id=repo_id,
                    source_task_id=task_id,
                    source_turn_index=turn_index,
                    git_commit_sha=git_commit_sha,
                    category="architecture_rule",
                    trigger_pattern=trigger,
                    insight=insight,
                    context_files=modified_files[:4],
                    slug=arch_slug,
                    epistemic_grade="self_consistent",
                    status="PROVISIONAL",
                    utility_score=1.0,
                    is_mutation=True,
                )
                created_entries.append({
                    "id": entry.id,
                    "category": entry.category,
                    "trigger_pattern": entry.trigger_pattern,
                    "insight": entry.insight,
                    "context_files": entry.context_files,
                    "status": entry.status,
                    "slug": entry.slug,
                    "epistemic_grade": entry.epistemic_grade,
                    "entities": entry.entities,
                    "relations": entry.relations,
                    "superseded_ids": superseded_ids,
                })

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


def _format_entry_graph_facts(entry: KnowledgeEntryModel) -> List[str]:
    facts: List[str] = []
    for rel in (entry.relations or []):
        if isinstance(rel, dict):
            s = rel.get("subject")
            p = rel.get("predicate")
            o = rel.get("object")
            if s and p and o:
                facts.append(f"{s} —{p}→ {o}")
    return facts


async def retrieve_relevant_heuristics(
    repo_id: Optional[str] = None,
    prompt: str = "",
    target_files: Optional[List[str]] = None,
    limit: int = 3
) -> List[Dict[str, Any]]:
    """
    Retrieves the top-k highest utility PROMOTED heuristics relevant to the active context
    using CortexDB's 3-Lane Composable Retrieval:
      - Lane 1: Lexical / Trigger & Keyword overlap
      - Lane 2: Dense/N-Gram Vector Cosine Similarity
      - Lane 3: Property-Graph Entity, Relation & Context-File Walk (1-2 hops)
    Fused via Reciprocal Rank Fusion (RRF) weighted by utility_score, epistemic_grade,
    and exponential time decay.
    """
    plan = plan_memory_query(prompt, target_files=target_files)
    if not plan["should_recall"] and prompt.strip():
        return []

    target_basenames = set(plan["target_files"])
    prompt_keywords = set(plan["keywords"])
    prompt_entities = {e.lower() for e in plan["entities"]}
    query_vec = compute_fallback_embedding(prompt) if prompt.strip() else []
    now = get_utc_now()

    async with async_session_factory() as session:
        scope_cond = (
            or_(
                KnowledgeEntryModel.repo_id == repo_id,
                KnowledgeEntryModel.repo_id.is_(None)
            )
            if repo_id
            else (KnowledgeEntryModel.status == "PROMOTED")
        )
        stmt = (
            select(KnowledgeEntryModel)
            .where(
                KnowledgeEntryModel.status == "PROMOTED",
                scope_cond,
            )
            .order_by(
                KnowledgeEntryModel.utility_score.desc(),
                KnowledgeEntryModel.usage_count.desc(),
                KnowledgeEntryModel.updated_at.desc(),
            )
            .limit(200)
        )
        res = await session.execute(stmt)
        candidates = res.scalars().all()

        if not candidates:
            return []

        # Build 1-hop entity adjacency across candidate graph relations for multi-hop expansion
        neighbor_entities: set = set(prompt_entities)
        for c in candidates:
            for rel in (c.relations or []):
                if isinstance(rel, dict):
                    subj = str(rel.get("subject", "")).lower()
                    obj = str(rel.get("object", "")).lower()
                    if subj in prompt_entities and obj:
                        neighbor_entities.add(obj)
                    elif obj in prompt_entities and subj:
                        neighbor_entities.add(subj)

        lexical_scores: Dict[str, float] = {}
        vector_scores: Dict[str, float] = {}
        graph_scores: Dict[str, float] = {}
        raw_match_bonus: Dict[str, float] = {}
        matched_ids: set = set()

        prompt_lower = (prompt or "").lower()

        for c in candidates:
            cid = c.id
            bonus = 0.0

            # --- Lane 1: Lexical & Trigger Pattern Score ---
            trig_lower = (c.trigger_pattern or "").lower()
            ins_lower = (c.insight or "").lower()
            c_tokens = set(re.findall(r"[a-zA-Z0-9_.-]{3,}", f"{trig_lower} {ins_lower}"))
            trig_tokens = set(re.findall(r"[a-zA-Z0-9_.-]{3,}", trig_lower))

            trig_overlap = prompt_keywords.intersection(trig_tokens)
            full_overlap = prompt_keywords.intersection(c_tokens)

            lex_score = len(trig_overlap) * 1.5 + len(full_overlap) * 0.5
            if trig_lower and trig_lower in prompt_lower:
                lex_score += 3.0
                bonus += 1.5
            if trig_overlap:
                bonus += len(trig_overlap) * 0.5
                matched_ids.add(cid)
            elif full_overlap:
                bonus += len(full_overlap) * 0.25
                matched_ids.add(cid)

            if lex_score > 0:
                lexical_scores[cid] = lex_score

            # --- Lane 2: Vector Cosine Similarity Score ---
            if query_vec:
                c_vec: List[float] = []
                if c.embedding_json:
                    try:
                        c_vec = json.loads(c.embedding_json)
                    except Exception:
                        c_vec = []
                if not c_vec:
                    c_vec = compute_fallback_embedding(f"{c.trigger_pattern} {c.insight}")
                sim = cosine_similarity(query_vec, c_vec)
                if sim > 0.15:
                    vector_scores[cid] = sim
                    if sim >= 0.45:
                        matched_ids.add(cid)
                        bonus += sim * 0.5

            # --- Lane 3: Graph Entity, Relation & File Context Walk ---
            g_score = 0.0
            c_files = {os.path.basename(f) for f in (c.context_files or []) if f}
            if target_basenames and c_files.intersection(target_basenames):
                g_score += 3.0
                bonus += 1.5
                matched_ids.add(cid)

            c_entities = {str(e).lower() for e in (c.entities or []) if e} | {f.lower() for f in c_files}
            direct_ent_hits = c_entities.intersection(prompt_entities)
            hop_ent_hits = c_entities.intersection(neighbor_entities - prompt_entities)

            if direct_ent_hits:
                g_score += len(direct_ent_hits) * 2.0
                bonus += len(direct_ent_hits) * 0.6
                matched_ids.add(cid)
            if hop_ent_hits:
                g_score += len(hop_ent_hits) * 1.0
                bonus += len(hop_ent_hits) * 0.3
                matched_ids.add(cid)

            if g_score > 0:
                graph_scores[cid] = g_score

            raw_match_bonus[cid] = bonus

        # Compute per-lane ranks for Reciprocal Rank Fusion (RRF, k=60)
        def _build_ranks(score_map: Dict[str, float]) -> Dict[str, int]:
            sorted_ids = sorted(score_map.keys(), key=lambda k: score_map[k], reverse=True)
            return {item_id: rank_idx + 1 for rank_idx, item_id in enumerate(sorted_ids)}

        lex_ranks = _build_ranks(lexical_scores)
        vec_ranks = _build_ranks(vector_scores)
        graph_ranks = _build_ranks(graph_scores)
        rrf_k = 60.0

        heuristics: List[Dict[str, Any]] = []
        for c in candidates:
            cid = c.id
            is_matched = cid in matched_ids

            # Consider matched candidates OR high-utility global rules (utility_score >= 1.5)
            if not (is_matched or c.utility_score >= 1.5 or ( not prompt.strip() and not target_basenames )):
                continue

            rrf_score = 0.0
            if cid in lex_ranks:
                rrf_score += 1.2 / (rrf_k + lex_ranks[cid])
            if cid in vec_ranks:
                rrf_score += 0.8 / (rrf_k + vec_ranks[cid])
            if cid in graph_ranks:
                rrf_score += 1.3 / (rrf_k + graph_ranks[cid])

            grade = (c.epistemic_grade or "asserted").lower()
            grade_weight = EPISTEMIC_GRADE_WEIGHTS.get(grade, 1.0)
            if grade_weight <= 0.0:
                continue

            # Exponential time decay (half-life ~138 days so recent verified memories win ties)
            created_dt = c.updated_at or c.created_at or now
            if created_dt.tzinfo is None:
                created_dt = created_dt.replace(tzinfo=timezone.utc)
            age_days = max(0.0, (now - created_dt).total_seconds() / 86400.0)
            decay = math.exp(-0.005 * min(age_days, 365.0))

            # Combine base utility + match bonus + scaled RRF + grade weight + decay
            combined_score = (
                (c.utility_score + raw_match_bonus.get(cid, 0.0) + rrf_score * 30.0)
                * grade_weight
                * (0.85 + 0.15 * decay)
            )

            heuristics.append({
                "id": c.id,
                "category": c.category,
                "trigger_pattern": c.trigger_pattern,
                "insight": c.insight,
                "context_files": c.context_files or [],
                "slug": c.slug,
                "epistemic_grade": c.epistemic_grade or "asserted",
                "entities": c.entities or [],
                "relations": c.relations or [],
                "graph_facts": _format_entry_graph_facts(c),
                "utility_score": round(combined_score, 2),
                "usage_count": c.usage_count,
            })

    heuristics.sort(key=lambda x: x["utility_score"], reverse=True)
    return heuristics[:limit]


def format_working_memory_block(heuristics: List[Dict[str, Any]]) -> str:
    """
    Formats a concise, high-priority prompt section strictly capped at 400 tokens (~1600 characters),
    including CortexDB-style relational graph facts when available.
    """
    if not heuristics:
        return ""

    lines = ["[System Experiential Memory - Verified Lessons]:"]
    total_len = len(lines[0])
    graph_facts_collected: List[str] = []

    for h in heuristics:
        grade = h.get("epistemic_grade", "asserted")
        badge = "[VERIFIED] " if grade == "verified" else ""
        trig = (h.get("trigger_pattern") or "").strip()
        ins = (h.get("insight") or "").strip()
        if trig and trig.lower() not in ins.lower():
            entry_text = f"- {badge}[{trig}] → {ins}"
        else:
            entry_text = f"- {badge}{ins}"
        if total_len + len(entry_text) > 1350:
            break
        lines.append(entry_text)
        total_len += len(entry_text) + 1

        for gf in (h.get("graph_facts") or []):
            if gf not in graph_facts_collected:
                graph_facts_collected.append(gf)

    if graph_facts_collected and total_len < 1420:
        gf_line = "[Knowledge Graph Facts]: " + " | ".join(graph_facts_collected[:4])
        if total_len + len(gf_line) <= 1550:
            lines.append(gf_line)

    return "\n".join(lines)


async def get_file_memory_hints(
    file_path: str,
    repo_id: Optional[str] = None,
    limit: int = 3
) -> List[Dict[str, Any]]:
    """
    CortexDB Pre-File-Open Contextual Recall hook:
    When an agent opens a file with `read_file`, surfaces promoted heuristics and
    graph facts specifically tied to that file so the agent avoids repeating past bugs.
    """
    if not file_path or not str(file_path).strip():
        return []
    basename = os.path.basename(str(file_path).strip())
    if not basename:
        return []

    async with async_session_factory() as session:
        scope_cond = (
            or_(
                KnowledgeEntryModel.repo_id == repo_id,
                KnowledgeEntryModel.repo_id.is_(None)
            )
            if repo_id
            else (KnowledgeEntryModel.status == "PROMOTED")
        )
        stmt = (
            select(KnowledgeEntryModel)
            .where(
                KnowledgeEntryModel.status == "PROMOTED",
                scope_cond,
            )
            .order_by(KnowledgeEntryModel.utility_score.desc(), KnowledgeEntryModel.updated_at.desc())
            .limit(100)
        )
        res = await session.execute(stmt)
        candidates = res.scalars().all()

    matched: List[Dict[str, Any]] = []
    b_lower = basename.lower()
    for c in candidates:
        c_files = [os.path.basename(str(f)).lower() for f in (c.context_files or []) if f]
        c_ents = [str(e).lower() for e in (c.entities or []) if e]
        if b_lower in c_files or b_lower in c_ents:
            matched.append({
                "id": c.id,
                "category": c.category,
                "insight": c.insight,
                "epistemic_grade": c.epistemic_grade or "asserted",
                "utility_score": c.utility_score,
                "graph_facts": _format_entry_graph_facts(c),
            })
            if len(matched) >= limit:
                break

    return matched


async def recall_context_pack(
    query: str,
    repo_id: Optional[str] = None,
    target_files: Optional[List[str]] = None,
    limit: int = 5
) -> Dict[str, Any]:
    """
    High-level CortexDB `KnowledgeMemory.Recall` equivalent returning:
      - `plan`: QueryPlanner output (keywords, entities, active lanes, retrieval_mode)
      - `entries`: Fused RRF memory records
      - `graph_facts`: Deduplicated relational facts (`Subject —predicate→ Object`)
      - `context_pack`: Paste-ready prompt block
      - `engine_tier`: Active tier (`cortexdb_grpc_sidecar` or `native_sqlalchemy_cortex`)
    """
    plan = plan_memory_query(query, target_files=target_files)
    entries = await retrieve_relevant_heuristics(
        repo_id=repo_id,
        prompt=query,
        target_files=target_files,
        limit=limit,
    )
    graph_facts: List[str] = []
    for e in entries:
        for gf in (e.get("graph_facts") or []):
            if gf not in graph_facts:
                graph_facts.append(gf)

    sidecar_res = CortexDBBridge.recall_sidecar(
        query=query,
        entity_names=plan.get("entities"),
        keywords=plan.get("keywords"),
        top_k=limit,
    )
    if sidecar_res and sidecar_res.get("results"):
        for sh in sidecar_res["results"]:
            snippet = sh.get("snippet", "")
            if snippet:
                graph_facts.append(f"[Sidecar] {snippet[:120]}")

    return {
        "plan": plan,
        "entries": entries,
        "graph_facts": graph_facts,
        "context_pack": format_working_memory_block(entries),
        "engine_tier": CortexDBBridge.get_active_tier(),
    }


async def build_knowledge_graph(
    repo_id: Optional[str] = None,
    task_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Builds a CortexDB-style property graph & epistemic contract tally across stored memories.
    Returns `nodes`, `edges`, and `contract_tally` (`verified`, `self_consistent`, `asserted`,
    `held`, `refused`, `superseded`).
    """
    async with async_session_factory() as session:
        stmt = select(KnowledgeEntryModel)
        conditions = []
        if repo_id:
            conditions.append(or_(KnowledgeEntryModel.repo_id == repo_id, KnowledgeEntryModel.repo_id.is_(None)))
        if task_id:
            conditions.append(KnowledgeEntryModel.source_task_id == task_id)
        if conditions:
            stmt = stmt.where(*conditions)
        stmt = stmt.order_by(KnowledgeEntryModel.updated_at.desc()).limit(250)
        res = await session.execute(stmt)
        entries = res.scalars().all()

    nodes_map: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, Any]] = []
    seen_edges: set = set()
    contract_tally: Dict[str, int] = {
        "verified": 0,
        "self_consistent": 0,
        "asserted": 0,
        "held": 0,
        "refused": 0,
        "superseded": 0,
    }

    def _ensure_node(node_id: str, kind: str = "entity"):
        key = node_id.strip()
        if not key:
            return
        if key not in nodes_map:
            nodes_map[key] = {"id": key, "label": key, "kind": kind, "weight": 1}
        else:
            nodes_map[key]["weight"] += 1

    for e in entries:
        if e.status == "SUPERSEDED":
            contract_tally["superseded"] += 1
            continue
        if e.status == "INVALIDATED":
            contract_tally["refused"] += 1
            continue
        grade = (e.epistemic_grade or "asserted").lower()
        if e.status == "PROVISIONAL" and grade == "asserted":
            contract_tally["held"] += 1
        elif grade in contract_tally:
            contract_tally[grade] += 1
        else:
            contract_tally["asserted"] += 1

        for f in (e.context_files or []):
            if f:
                _ensure_node(os.path.basename(str(f)), kind="file")
        for ent in (e.entities or []):
            if ent:
                kind = "file" if "." in str(ent) else ("error" if "Error" in str(ent) or "Exception" in str(ent) else "entity")
                _ensure_node(str(ent), kind=kind)
        for rel in (e.relations or []):
            if isinstance(rel, dict):
                s = str(rel.get("subject", "")).strip()
                p = str(rel.get("predicate", "")).strip()
                o = str(rel.get("object", "")).strip()
                if s and p and o:
                    _ensure_node(s)
                    _ensure_node(o)
                    edge_key = (s, p, o)
                    if edge_key not in seen_edges:
                        seen_edges.add(edge_key)
                        edges.append({
                            "source": s,
                            "predicate": p,
                            "target": o,
                            "memory_id": e.id,
                            "epistemic_grade": e.epistemic_grade or "asserted",
                        })

    return {
        "nodes": list(nodes_map.values()),
        "edges": edges,
        "contract_tally": contract_tally,
        "engine_tier": CortexDBBridge.get_active_tier(),
    }


async def vote_memory_heuristic(memory_id: str, delta: float) -> Optional[Dict[str, Any]]:
    """
    Adjusts the utility score of a heuristic.
    - Positive reinforcement (`delta > 0`) upgrades `epistemic_grade` to `'verified'` (CortexDB human-verified grade).
    - If score drops below 0.3, marks `INVALIDATED` and sets `epistemic_grade = 'refused'`.
    """
    async with async_session_factory() as session:
        stmt = select(KnowledgeEntryModel).where(KnowledgeEntryModel.id == memory_id)
        res = await session.execute(stmt)
        entry = res.scalars().first()
        if not entry:
            return None

        entry.utility_score = max(0.1, min(10.0, round(entry.utility_score + delta, 2)))
        entry.usage_count += 1
        if delta > 0:
            entry.epistemic_grade = "verified"
        if entry.utility_score < 0.3:
            entry.status = "INVALIDATED"
            entry.epistemic_grade = "refused"
            logger.info(f"Knowledge entry {memory_id} invalidated due to low utility score ({entry.utility_score})")

        entry.updated_at = get_utc_now()
        await session.commit()
        await session.refresh(entry)

        return {
            "id": entry.id,
            "utility_score": entry.utility_score,
            "status": entry.status,
            "epistemic_grade": entry.epistemic_grade,
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
