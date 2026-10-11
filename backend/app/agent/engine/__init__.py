"""
Cyclode Agent Engine Package
Modular components for turn orchestration, planning, snapshots, and model cascades.
"""

from app.agent.engine.snapshots import (
    _get_isolated_git_env,
    ensure_workspace_git_repo,
    create_turn_snapshot,
    rollback_workspace_to_commit,
)
from app.agent.engine.planning import (
    generate_plan_markdown,
    extract_plan_from_markdown,
)
from app.agent.engine.tool_declarations import (
    ALL_TOOLS_DECLARATIONS,
    get_all_tool_declarations,
    filter_declarations_for_intent,
    MUTATION_TOOL_NAMES,
)
from app.agent.engine.context import (
    downscale_context_image,
    estimate_messages_tokens,
    format_plan_chat_summary,
    assemble_system_instruction,
)
from app.agent.engine.reporting import (
    compile_session_report,
    harvest_session_intelligence,
    synthesize_report_markdown,
    generate_printable_html,
)
from app.agent.engine.memory import (
    extract_turn_heuristics,
    promote_task_memories,
    rollback_turn_memories,
    retrieve_relevant_heuristics,
    format_working_memory_block,
    vote_memory_heuristic,
    cascade_delete_task_memories,
)

__all__ = [
    "_get_isolated_git_env",
    "ensure_workspace_git_repo",
    "create_turn_snapshot",
    "rollback_workspace_to_commit",
    "generate_plan_markdown",
    "extract_plan_from_markdown",
    "ALL_TOOLS_DECLARATIONS",
    "get_all_tool_declarations",
    "filter_declarations_for_intent",
    "MUTATION_TOOL_NAMES",
    "downscale_context_image",
    "estimate_messages_tokens",
    "format_plan_chat_summary",
    "assemble_system_instruction",
    "compile_session_report",
    "harvest_session_intelligence",
    "synthesize_report_markdown",
    "generate_printable_html",
    "extract_turn_heuristics",
    "promote_task_memories",
    "rollback_turn_memories",
    "retrieve_relevant_heuristics",
    "format_working_memory_block",
    "vote_memory_heuristic",
    "cascade_delete_task_memories",
]

