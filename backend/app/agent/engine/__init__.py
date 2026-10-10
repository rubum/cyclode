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
]

