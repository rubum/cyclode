import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
from app.agent.tools import WorkspaceTools
from app.agent.harness import antigravity_harness
from app.agent.personas import PERSONAS, get_persona


@pytest.mark.asyncio
async def test_workspace_tools_search_web_structure():
    res = await WorkspaceTools.search_web("nvidia", limit=3)
    assert isinstance(res, dict)
    assert "query" in res
    assert "results" in res
    assert isinstance(res["results"], list)


@pytest.mark.asyncio
async def test_workspace_tools_search_web_temporal():
    res = await WorkspaceTools.search_web("spacex starship", limit=3, temporal_context="this week")
    assert isinstance(res, dict)
    assert "results" in res


@pytest.mark.asyncio
async def test_workspace_tools_fetch_url():
    # Mocking httpx get for deterministic fetch_url test
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = "<html><body><h1>Sample Docs</h1><p>FastAPI reference guide.</p></body></html>"

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        res = await WorkspaceTools.fetch_url("https://example.com/docs")
        assert res["status_code"] == 200
        assert "Sample Docs" in res["content"]


def test_personas_have_prose_and_citation_directives():
    for name, persona in PERSONAS.items():
        instructions = persona["system_instructions"]
        assert "Communication & Synthesis Standards" in instructions
        assert "Mandatory Markdown Links" in instructions
        assert "cohesive analytical prose" in instructions
        assert "bullet highlights" in instructions


@pytest.mark.asyncio
async def test_harness_unconfigured_api_key_guidance(tmp_path: Path):
    messages = []

    async def on_message(sender, content):
        messages.append((sender, content))

    from app.config import settings
    with patch.object(settings, "get_api_key", return_value=None), \
         patch.object(settings, "GEMINI_API_KEY", None), \
         patch.object(settings, "GOOGLE_API_KEY", None), \
         patch.dict("app.integrations.manager.integration_manager._custom_credentials", {"gemini": {}}, clear=True):
        res = await antigravity_harness.execute_task(
            task_id="test-unconfigured-task",
            title="Review PR #42",
            description="Review PR #42 in gowaylo/waylo",
            persona_name="CodeReviewer",
            workspace_path=tmp_path,
            on_thought=lambda t: None,
            on_tool_start=lambda n, a: None,
            on_tool_end=lambda n, o, e, d, a=None: None,
            on_message=on_message,
            on_approval_required=lambda a, d: None,
            on_diff_updated=lambda d: None
        )

        assert res["status"] == "AWAITING_INPUT"
        assert len(messages) >= 1
        sender, content = messages[0]
        assert sender == "agent"
        assert "LLM Model Configuration Required" in content
        assert "Gemini API Key" in content
