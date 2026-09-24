import pytest
import httpx
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock
from app.agent.harness import AntigravityHarness
from app.agent.providers.claude import ClaudeProvider
from app.agent.providers.openai import OpenAIProvider
from app.agent.providers.gemini import GeminiProvider
from app.agent.providers.base import ProviderResponse, ToolCallRequest


@pytest.mark.asyncio
async def test_dynamic_plan_generation_claude():
    harness = AntigravityHarness(model_name="claude-3-7-sonnet")
    mock_plan_json = {
        "intent_category": "qa_research",
        "objective": "Explain Redis LangCache architecture and benefits",
        "steps": [
            {"id": "step-1", "title": "Analyze Redis LangCache query", "status": "in_progress"},
            {"id": "step-2", "title": "Synthesize caching mechanics and cost savings", "status": "pending"},
            {"id": "step-3", "title": "Provide architectural overview", "status": "pending"}
        ]
    }

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    
    with patch.object(ClaudeProvider, "get_api_key", return_value="mock-claude-key"), \
         patch.object(ClaudeProvider, "generate_structured_plan", new_callable=AsyncMock) as mock_gen_plan:
        mock_gen_plan.return_value = {"result": mock_plan_json, "error": None}

        plan = await harness._generate_dynamic_plan(
            client=mock_client,
            api_key="mock-key",
            model_name="claude-3-7-sonnet",
            title="Redis LangCache Research",
            prompt="Explain how Redis LangCache optimizes LLM costs",
            persona_name="SoftwareEngineer"
        )

        assert plan["intent_category"] == "qa_research"
        assert "Explain Redis LangCache" in plan["objective"]
        assert len(plan["steps"]) == 3
        assert plan["steps"][0]["title"] == "Analyze Redis LangCache query"


@pytest.mark.asyncio
async def test_dynamic_plan_generation_openai():
    harness = AntigravityHarness(model_name="gpt-4o")
    mock_plan_json = {
        "intent_category": "app_building",
        "objective": "Build a responsive Markdown previewer web app",
        "steps": [
            {"id": "step-1", "title": "Scaffold React Vite application", "status": "in_progress"},
            {"id": "step-2", "title": "Implement split-pane editor and preview", "status": "pending"},
            {"id": "step-3", "title": "Verify preview and bundle styles", "status": "pending"}
        ]
    }

    mock_client = AsyncMock(spec=httpx.AsyncClient)

    with patch.object(OpenAIProvider, "get_api_key", return_value="mock-openai-key"), \
         patch.object(OpenAIProvider, "generate_structured_plan", new_callable=AsyncMock) as mock_gen_plan:
        mock_gen_plan.return_value = {"result": mock_plan_json, "error": None}

        plan = await harness._generate_dynamic_plan(
            client=mock_client,
            api_key="mock-key",
            model_name="gpt-4o",
            title="Markdown Previewer",
            prompt="Build a markdown previewer web application",
            persona_name="AppBuilder"
        )

        assert plan["intent_category"] == "app_building"
        assert "Markdown previewer" in plan["objective"]
        assert len(plan["steps"]) == 3
        assert plan["steps"][0]["title"] == "Scaffold React Vite application"


@pytest.mark.asyncio
async def test_dynamic_plan_missing_key_diagnostics():
    harness = AntigravityHarness(model_name="claude-3-7-sonnet")
    mock_client = AsyncMock(spec=httpx.AsyncClient)

    with patch.object(ClaudeProvider, "get_api_key", return_value=None):
        plan = await harness._generate_dynamic_plan(
            client=mock_client,
            api_key="",
            model_name="claude-3-7-sonnet",
            title="Test Missing Key",
            prompt="Test prompt",
            persona_name="SoftwareEngineer"
        )

        assert "Plan Generation Failed: Anthropic Claude API Key is missing or unconfigured" in plan["steps"][0]["title"]
        assert plan["evaluation"]["status"] == "needs_revision"


@pytest.mark.asyncio
async def test_multi_turn_execution_claude(tmp_path):
    harness = AntigravityHarness(model_name="claude-3-7-sonnet")
    test_file = tmp_path / "hello.txt"
    test_file.write_text("Hello from Cyclode test", encoding="utf-8")

    thought_events = []
    message_events = []
    tool_events = []

    async def mock_on_thought(text):
        thought_events.append(text)

    async def mock_on_message(sender, text):
        message_events.append((sender, text))

    async def mock_on_tool_start(tool_name, args):
        tool_events.append((tool_name, args))

    # Turn 1: Model requests read_file
    turn1_resp = ProviderResponse(
        thought="I will read the test file first.",
        tool_calls=[
            ToolCallRequest(
                call_id="call_read_1",
                tool_name="read_file",
                tool_args={"path": "hello.txt"}
            )
        ],
        raw_response={"id": "msg_turn1"}
    )

    # Turn 2: Model returns final synthesis
    turn2_resp = ProviderResponse(
        content="The file contains: 'Hello from Cyclode test'. Everything is verified.",
        raw_response={"id": "msg_turn2"}
    )

    call_count = 0
    async def mock_generate_response(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return turn1_resp
        return turn2_resp

    with patch.object(ClaudeProvider, "get_api_key", return_value="mock-claude-key"), \
         patch.object(ClaudeProvider, "generate_response", side_effect=mock_generate_response), \
         patch.object(ClaudeProvider, "generate_structured_plan", new_callable=AsyncMock) as mock_plan:
        
        mock_plan.return_value = {
            "result": {
                "intent_category": "qa_research",
                "objective": "Read and verify test file",
                "steps": [
                    {"id": "step-1", "title": "Read file", "status": "in_progress"},
                    {"id": "step-2", "title": "Verify contents", "status": "pending"}
                ]
            }
        }

        result = await harness.execute_task(
            task_id="task-multi-turn-claude",
            title="Read test file",
            description=f"Read hello.txt",
            persona_name="SoftwareEngineer",
            workspace_path=tmp_path,
            on_thought=mock_on_thought,
            on_tool_start=mock_on_tool_start,
            on_tool_end=AsyncMock(),
            on_message=mock_on_message,
            on_approval_required=AsyncMock(),
            on_diff_updated=AsyncMock()
        )

        assert result["status"] == "COMPLETED"
        assert call_count == 2
        assert len(tool_events) == 1
        assert tool_events[0][0] == "read_file"
        assert any("Hello from Cyclode test" in msg[1] for msg in message_events)


@pytest.mark.asyncio
async def test_multi_turn_execution_openai(tmp_path):
    harness = AntigravityHarness(model_name="gpt-4o")
    test_file = tmp_path / "data.json"
    test_file.write_text('{"status": "ok"}', encoding="utf-8")

    thought_events = []
    message_events = []
    tool_events = []

    async def mock_on_thought(text):
        thought_events.append(text)

    async def mock_on_message(sender, text):
        message_events.append((sender, text))

    async def mock_on_tool_start(tool_name, args):
        tool_events.append((tool_name, args))

    # Turn 1: Model requests read_file
    turn1_resp = ProviderResponse(
        thought="Reading the data json file.",
        tool_calls=[
            ToolCallRequest(
                call_id="call_read_json",
                tool_name="read_file",
                tool_args={"path": "data.json"}
            )
        ],
        raw_response={"id": "chatcmpl_1"}
    )

    # Turn 2: Final response
    turn2_resp = ProviderResponse(
        content="JSON data successfully inspected: status is ok.",
        raw_response={"id": "chatcmpl_2"}
    )

    call_count = 0
    async def mock_generate_response(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return turn1_resp
        return turn2_resp

    with patch.object(OpenAIProvider, "get_api_key", return_value="mock-openai-key"), \
         patch.object(OpenAIProvider, "generate_response", side_effect=mock_generate_response), \
         patch.object(OpenAIProvider, "generate_structured_plan", new_callable=AsyncMock) as mock_plan:
        
        mock_plan.return_value = {
            "result": {
                "intent_category": "qa_research",
                "objective": "Inspect data json",
                "steps": [
                    {"id": "step-1", "title": "Inspect file", "status": "in_progress"}
                ]
            }
        }

        result = await harness.execute_task(
            task_id="task-multi-turn-openai",
            title="Inspect data json",
            description=f"Inspect data.json",
            persona_name="SoftwareEngineer",
            workspace_path=tmp_path,
            on_thought=mock_on_thought,
            on_tool_start=mock_on_tool_start,
            on_tool_end=AsyncMock(),
            on_message=mock_on_message,
            on_approval_required=AsyncMock(),
            on_diff_updated=AsyncMock()
        )

        assert result["status"] == "COMPLETED"
        assert call_count == 2
        assert len(tool_events) == 1
        assert tool_events[0][0] == "read_file"


def test_adaptive_tiering_resolution():
    from app.config import settings

    # 1. When model is explicitly requested by user (e.g. claude-3-7-sonnet or deepseek-flash)
    harness_explicit = AntigravityHarness(model_name="claude-3-7-sonnet")
    assert harness_explicit.resolve_effective_model("qa_research") == "claude-3-7-sonnet"
    assert harness_explicit.resolve_effective_model("app_building") == "claude-3-7-sonnet"

    harness_ds = AntigravityHarness(model_name="deepseek-flash")
    assert harness_ds.resolve_effective_model("qa_research") == "deepseek-flash"
    assert harness_ds.resolve_effective_model("app_building") == "deepseek-flash"

    # 2. When routing mode is adaptive with DeepSeek tiers
    harness_auto = AntigravityHarness(model_name="auto")
    settings.ANTIGRAVITY_ROUTING_MODE = "adaptive"
    settings.ANTIGRAVITY_MINOR_MODEL = "deepseek-flash"
    settings.ANTIGRAVITY_MAJOR_MODEL = "deepseek-reasoner"

    assert harness_auto.resolve_effective_model("qa_research") == "deepseek-flash"
    assert harness_auto.resolve_effective_model("app_building") == "deepseek-reasoner"
    assert harness_auto.resolve_effective_model("code_modification") == "deepseek-reasoner"
    assert harness_auto.resolve_effective_model("debugging") == "deepseek-reasoner"
    assert harness_auto.resolve_effective_model(None) == "deepseek-reasoner"

    # 3. When routing mode is manual
    settings.ANTIGRAVITY_ROUTING_MODE = "manual"
    settings.ANTIGRAVITY_MODEL = "gpt-6-astra"
    assert harness_auto.resolve_effective_model("qa_research") == "gpt-6-astra"

    # Restore settings
    settings.ANTIGRAVITY_ROUTING_MODE = "adaptive"
    settings.ANTIGRAVITY_MODEL = "gemini-3.7-flash"
    settings.ANTIGRAVITY_MAJOR_MODEL = "gemini-3.8-flash"
    settings.ANTIGRAVITY_MINOR_MODEL = "gemini-3.7-flash"


@pytest.mark.asyncio
async def test_dynamic_plan_generation_deepseek():
    from app.agent.providers.deepseek import DeepSeekProvider

    harness = AntigravityHarness(model_name="deepseek-flash")
    mock_plan_json = {
        "intent_category": "code_modification",
        "objective": "Refactor async task worker pool",
        "steps": [
            {"id": "step-1", "title": "Inspect worker lifecycle", "status": "in_progress"},
            {"id": "step-2", "title": "Implement task pool queue", "status": "pending"}
        ]
    }

    mock_client = AsyncMock(spec=httpx.AsyncClient)

    with patch.object(DeepSeekProvider, "get_api_key", return_value="mock-deepseek-key"), \
         patch.object(DeepSeekProvider, "generate_structured_plan", new_callable=AsyncMock) as mock_gen_plan:
        mock_gen_plan.return_value = {"result": mock_plan_json, "error": None}

        plan = await harness._generate_dynamic_plan(
            client=mock_client,
            api_key="mock-key",
            model_name="deepseek-flash",
            title="Refactor Worker Pool",
            prompt="Refactor async task worker pool with graceful shutdowns",
            persona_name="SoftwareEngineer"
        )

        assert plan["intent_category"] == "code_modification"
        assert "Refactor async task worker pool" in plan["objective"]
        assert len(plan["steps"]) == 2


