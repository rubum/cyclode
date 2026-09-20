import time
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from app.db.models import get_utc_now
from app.schemas.trajectory import (
    ToolInvocationRecord,
    TrajectoryTurn,
    AgentTrajectory,
)

logger = logging.getLogger("cyclode.trajectories.collector")


class TrajectoryCollector:
    """
    Stateful collector accumulating turn-by-turn trajectory states,
    chain-of-thought streams, tool executions, and evaluation checkpoints.
    """

    def __init__(self, task_id: str, persona: str, model_name: str, session_key: Optional[str] = None):
        self.task_id = task_id
        self.persona = persona
        self.model_name = model_name
        self.session_key = session_key
        self.start_time = time.time()
        self.turns: List[TrajectoryTurn] = []
        self._current_turn: Optional[TrajectoryTurn] = None
        self.total_tokens: int = 0

    def start_turn(self, turn_index: int, user_prompt: Optional[str] = None) -> TrajectoryTurn:
        """Initializes a new conversational turn."""
        turn = TrajectoryTurn(
            turn_index=turn_index,
            timestamp=get_utc_now(),
            thoughts=[],
            user_prompt=user_prompt,
            agent_response=None,
            tool_calls=[],
            diff_snapshot_sha=None,
            tokens_consumed=0
        )
        self.turns.append(turn)
        self._current_turn = turn
        return turn

    def add_thought(self, thought: str):
        """Appends an internal chain-of-thought snippet to the active turn."""
        if self._current_turn and thought:
            self._current_turn.thoughts.append(thought)

    def record_tool_invocation(
        self,
        tool_name: str,
        input_args: Dict[str, Any],
        output_data: Optional[str] = None,
        error: Optional[str] = None,
        duration_ms: Optional[int] = None,
        exit_code: int = 0
    ) -> ToolInvocationRecord:
        """Records an action/observation pair in the active turn."""
        rec = ToolInvocationRecord(
            tool_name=tool_name,
            input_args=input_args,
            output_data=output_data,
            error=error,
            duration_ms=duration_ms,
            exit_code=exit_code,
            created_at=get_utc_now()
        )
        if self._current_turn:
            self._current_turn.tool_calls.append(rec)
        return rec

    def end_turn(
        self,
        agent_response: Optional[str] = None,
        diff_snapshot_sha: Optional[str] = None,
        tokens: int = 0
    ):
        """Finalizes the current turn with response text and commit snapshot."""
        if self._current_turn:
            self._current_turn.agent_response = agent_response
            self._current_turn.diff_snapshot_sha = diff_snapshot_sha
            self._current_turn.tokens_consumed = tokens
            self.total_tokens += tokens

    def build_trajectory(self, status: str = "COMPLETED") -> AgentTrajectory:
        """Constructs the immutable AgentTrajectory model."""
        elapsed_ms = int((time.time() - self.start_time) * 1000)
        # Cost heuristic: ~$0.001 per 1k tokens
        est_cost = round((self.total_tokens / 1000.0) * 0.0015, 5)

        return AgentTrajectory(
            task_id=self.task_id,
            session_key=self.session_key,
            persona=self.persona,
            model_name=self.model_name,
            status=status,
            turns=self.turns,
            total_tokens=self.total_tokens,
            total_latency_ms=elapsed_ms,
            estimated_cost_usd=est_cost,
            created_at=datetime.fromtimestamp(self.start_time, tz=get_utc_now().tzinfo),
            updated_at=get_utc_now()
        )
