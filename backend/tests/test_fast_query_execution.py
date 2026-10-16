import asyncio
import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.agent.harness import Harness
from app.agent.providers.base import ProviderResponse, ToolCallRequest


def test_contextual_followup_intent_ignores_stale_code_title():
    """
    A short conceptual query like "what's a namespace" in an ongoing coding session
    whose title contains a filename ('Refactor payment_gateway.py') must be classified
    as 'qa_research', require no reasoning, and qualify for the fast direct query path.
    """
    title = "Refactor payment_gateway.py"
    prompt = "what's a namespace"
    history = [
        {"sender": "user", "content": "Refactor payment_gateway.py to use async httpx"},
        {"sender": "agent", "content": "I have updated payment_gateway.py."},
    ]

    intent = Harness.infer_task_intent(title, prompt, persona_name="SeniorEngineer", mode="agent")
    assert intent == "qa_research"

    needs_reasoning = Harness.requires_reasoning_for_query(
        title, prompt, intent_category=intent, history=history
    )
    assert needs_reasoning is False

    is_fast = Harness.is_fast_direct_query(
        title, prompt, intent_category=intent, mode="agent", history=history
    )
    assert is_fast is True


def test_queries_with_workspace_file_or_complex_why_do_not_bypass_or_suppress():
    """
    Queries referencing specific workspace files or asking root-cause 'why' questions
    should either use tools or enable reasoning appropriately.
    """
    title = "Session"
    # References a specific file -> not a zero-tool fast direct query
    assert (
        Harness.is_fast_direct_query(
            title, "explain auth_service.py", intent_category="qa_research", mode="agent"
        )
        is False
    )
    # Complex root-cause debugging question -> requires reasoning
    assert (
        Harness.requires_reasoning_for_query(
            title,
            "why does the websocket connection deadlock under concurrent load?",
            intent_category="qa_research",
        )
        is True
    )


def test_resolve_planner_model_and_selective_reasoning_downgrade():
    """
    Verify that resolve_planner_model routes DeepSeek models (including deepseek-v4.1-flash)
    to 'deepseek-flash', and resolve_effective_model downgrades reasoning models when
    requires_reasoning=False.
    """
    h = Harness(model_name="deepseek-reasoner")
    assert h.resolve_planner_model("deepseek-reasoner") == "deepseek-flash"
    assert h.resolve_planner_model("deepseek-v4.1-flash") == "deepseek-flash"

    # Explicit non-DeepSeek models in unit tests are preserved when no DeepSeek key is active
    with patch("app.agent.harness.settings.DEEPSEEK_API_KEY", None):
        assert h.resolve_planner_model("gemini-3.7-flash") == "gemini-3.7-flash"

    # Reasoning model downgraded when requires_reasoning=False
    assert (
        h.resolve_effective_model(
            "deepseek-reasoner", intent_category="qa_research", requires_reasoning=False
        )
        == "deepseek-flash"
    )
    assert (
        h.resolve_effective_model(
            "deepseek-v4.1-flash", intent_category="code_modification", requires_reasoning=False
        )
        == "deepseek-flash"
    )


@pytest.mark.asyncio
async def test_fast_direct_query_skips_llm_planner_and_disables_thinking(tmp_path: Path):
    """
    Verify that executing 'what's a namespace' with prior conversation history:
    1. Does NOT call provider.generate_structured_plan (0 planner LLM calls)
    2. Calls provider.generate_response once with thinking_budget=0
    3. Emits a completed 1-step plan with response_style='direct_concise'
    """
    h = Harness(model_name="deepseek-chat")
    emitted_plans = []
    emitted_messages = []

    async def on_plan(p):
        emitted_plans.append(p)

    async def on_message(sender, msg, stream_id=None):
        emitted_messages.append(msg)

    async def noop(*args, **kwargs):
        pass

    mock_plan_fn = AsyncMock()
    captured_thinking_budgets = []

    async def mock_generate_response(*args, **kwargs):
        captured_thinking_budgets.append(kwargs.get("thinking_budget"))
        return ProviderResponse(
            content=(
                "A **namespace** is a declarative container that scopes identifiers to prevent naming collisions.\n\n"
                "- **Isolation**: Keeps variables, functions, and classes separated across modules.\n"
                "- **Resolution**: Enables qualified lookup such as `module.symbol`."
            ),
            thought="",
            tool_calls=[],
            finish_reason="STOP",
            input_tokens=50,
            output_tokens=25,
        )

    with patch(
        "app.agent.providers.deepseek.DeepSeekProvider.get_api_key", return_value="sk-test-key"
    ), patch(
        "app.agent.providers.deepseek.DeepSeekProvider.generate_structured_plan", mock_plan_fn
    ), patch(
        "app.agent.providers.deepseek.DeepSeekProvider.generate_response",
        side_effect=mock_generate_response,
    ):
        result = await h.execute_task(
            task_id="fast-query-test",
            title="Refactor payment_gateway.py",
            description="what's a namespace",
            persona_name="SeniorEngineer",
            workspace_path=tmp_path,
            on_thought=noop,
            on_tool_start=noop,
            on_tool_end=noop,
            on_message=on_message,
            on_approval_required=noop,
            on_diff_updated=noop,
            on_plan=on_plan,
            history=[
                {"sender": "user", "content": "Update payment_gateway.py"},
                {"sender": "agent", "content": "Updated payment_gateway.py."},
            ],
        )

    assert result["status"] == "COMPLETED"
    assert mock_plan_fn.call_count == 0, "Fast direct query must bypass LLM plan generation"
    assert len(captured_thinking_budgets) == 1
    assert captured_thinking_budgets[0] == 0, "Fast direct query must pass thinking_budget=0"
    assert len(emitted_plans) >= 1
    final_plan = emitted_plans[-1]
    assert final_plan["response_style"] == "direct_concise"
    assert final_plan["requires_plan"] is False
    assert final_plan["requires_reasoning"] is False
    assert all(s["status"] == "completed" for s in final_plan["steps"])


@pytest.mark.asyncio
async def test_dynamic_plan_caps_steps_to_3_for_non_planning_mode(tmp_path: Path):
    """
    Verify that _generate_dynamic_plan caps steps to <= 3 and omits heavy phases
    when intent_category != 'planning', even if the LLM returns 5 steps.
    """
    h = Harness(model_name="deepseek-v4.1-flash")

    async def mock_structured_plan(*args, **kwargs):
        return {
            "result": {
                "intent_category": "code_modification",
                "response_style": "action_execution",
                "requires_plan": True,
                "requires_reasoning": False,
                "objective": "Add validation helper",
                "steps": [
                    {"id": "s1", "title": "Step 1", "status": "in_progress"},
                    {"id": "s2", "title": "Step 2", "status": "pending"},
                    {"id": "s3", "title": "Step 3", "status": "pending"},
                    {"id": "s4", "title": "Step 4", "status": "pending"},
                    {"id": "s5", "title": "Step 5", "status": "pending"},
                ],
                "phases": [
                    {"id": "p1", "title": "Phase 1", "steps": ["a", "b"]}
                ],
            }
        }

    with patch(
        "app.agent.providers.deepseek.DeepSeekProvider.generate_structured_plan",
        side_effect=mock_structured_plan,
    ):
        async with httpx.AsyncClient() as client:
            plan = await h._generate_dynamic_plan(
                client=client,
                api_key="sk-test",
                model_name="deepseek-v4.1-flash",
                title="Add validation helper",
                prompt="Add a validation helper to utils.py",
                persona_name="SeniorEngineer",
                workspace_path=tmp_path,
                cached_workspace_files=["utils.py"],
            )

    assert len(plan["steps"]) == 3
    assert plan.get("phases", []) == []
    assert plan["response_style"] == "action_execution"


@pytest.mark.asyncio
async def test_parallel_read_only_tools_execute_concurrently(tmp_path: Path):
    """
    Verify that multiple read-only tool calls (e.g., 3 read_file calls) in a single
    LLM turn execute concurrently via asyncio.gather while preserving deterministic order.
    """
    (tmp_path / "a.txt").write_text("content-a")
    (tmp_path / "b.txt").write_text("content-b")
    (tmp_path / "c.txt").write_text("content-c")

    h = Harness(model_name="deepseek-chat")
    turn_counter = 0
    observed_user_parts = []

    async def noop(*args, **kwargs):
        pass

    async def slow_read_file(ws_path, file_path, start_line=None, end_line=None):
        await asyncio.sleep(0.15)
        return {"content": f"data:{file_path}"}

    async def mock_generate_response(*args, **kwargs):
        nonlocal turn_counter
        turn_counter += 1
        messages = kwargs.get("messages") if "messages" in kwargs else args[0]
        if turn_counter == 1:
            return ProviderResponse(
                content="",
                thought="",
                tool_calls=[
                    ToolCallRequest(call_id="c1", tool_name="read_file", tool_args={"file_path": "a.txt"}),
                    ToolCallRequest(call_id="c2", tool_name="read_file", tool_args={"file_path": "b.txt"}),
                    ToolCallRequest(call_id="c3", tool_name="read_file", tool_args={"file_path": "c.txt"}),
                ],
                finish_reason="STOP",
                input_tokens=20,
                output_tokens=20,
            )
        # Capture the tool responses sent back to the model on turn 2
        observed_user_parts.extend(messages[-1]["parts"])
        return ProviderResponse(
            content=(
                "### File Comparison Summary\n\n"
                "- **a.txt**: Contains `data:a.txt`.\n"
                "- **b.txt**: Contains `data:b.txt`.\n"
                "- **c.txt**: Contains `data:c.txt`."
            ),
            thought="",
            tool_calls=[],
            finish_reason="STOP",
            input_tokens=40,
            output_tokens=20,
        )

    async def fake_run_io_blocking(func, *args, **kwargs):
        if getattr(func, "__name__", "") == "read_file":
            return await slow_read_file(*args, **kwargs)
        return func(*args, **kwargs)

    t0 = time.monotonic()
    with patch(
        "app.agent.providers.deepseek.DeepSeekProvider.get_api_key", return_value="sk-test"
    ), patch(
        "app.agent.harness.run_io_blocking", side_effect=fake_run_io_blocking
    ), patch(
        "app.agent.providers.deepseek.DeepSeekProvider.generate_structured_plan",
        AsyncMock(
            return_value={
                "result": {
                    "intent_category": "qa_research",
                    "response_style": "analytical_briefing",
                    "requires_plan": True,
                    "requires_reasoning": False,
                    "objective": "Read files",
                    "steps": [{"id": "s1", "title": "Read", "status": "in_progress"}],
                }
            }
        ),
    ), patch(
        "app.agent.providers.deepseek.DeepSeekProvider.generate_response",
        side_effect=mock_generate_response,
    ):
        res = await h.execute_task(
            task_id="parallel-tools-test",
            title="Compare a.txt, b.txt, and c.txt",
            description="Read a.txt, b.txt, and c.txt and summarize them",
            persona_name="SeniorEngineer",
            workspace_path=tmp_path,
            on_thought=noop,
            on_tool_start=noop,
            on_tool_end=noop,
            on_message=noop,
            on_approval_required=noop,
            on_diff_updated=noop,
        )
    elapsed = time.monotonic() - t0

    assert res["status"] == "COMPLETED"
    # 3 * 0.15s sequentially would take >= 0.45s; parallel execution completes well under 0.38s
    assert elapsed < 0.42, f"Expected parallel execution (<0.42s), took {elapsed:.3f}s"
    assert [p["functionResponse"]["id"] for p in observed_user_parts] == ["c1", "c2", "c3"]
    assert [p["functionResponse"]["response"]["content"] for p in observed_user_parts] == [
        "data:a.txt",
        "data:b.txt",
        "data:c.txt",
    ]
