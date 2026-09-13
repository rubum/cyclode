import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Any, Callable, Optional, List, Awaitable, Protocol


@dataclass
class IntentContext:
    task_id: str
    title: str
    prompt: str
    lower_prompt: str
    persona_name: str
    workspace_path: Path
    emit_thought: Callable[[str], Awaitable[None]]
    emit_message: Callable[[str, str], Awaitable[None]]
    call_tool_start: Callable[[str, Dict[str, Any]], Awaitable[None]]
    call_tool_end: Callable[..., Awaitable[None]]
    on_approval_required: Callable[[str, Dict[str, Any]], Any]
    on_diff_updated: Callable[[List[Dict[str, Any]]], Any]
    history: Optional[List[Dict[str, Any]]] = None
    extra: Dict[str, Any] = field(default_factory=dict)


class IntentHandler(Protocol):
    name: str
    description: str = ""
    exemplars: List[str] = []
    negative_exemplars: List[str] = []
    priority_weight: float = 1.0

    def matches(self, ctx: IntentContext) -> bool:
        """Determines if this handler should execute for the given prompt context."""
        ...

    async def execute(self, ctx: IntentContext) -> Dict[str, Any]:
        """Executes the handler logic and returns task result dictionary."""
        ...

