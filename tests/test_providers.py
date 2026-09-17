import pytest
from app.agent.providers.base import BaseLLMProvider, ProviderResponse, ToolCallRequest
from app.agent.providers.gemini import GeminiProvider
from app.agent.providers.claude import ClaudeProvider
from app.agent.providers.openai import OpenAIProvider
from app.agent.providers.factory import get_provider_for_model, get_model_catalog


def test_provider_factory_routing():
    # Claude models
    assert isinstance(get_provider_for_model("claude-3-7-sonnet"), ClaudeProvider)
    assert isinstance(get_provider_for_model("claude-3-5-sonnet"), ClaudeProvider)
    assert isinstance(get_provider_for_model("claude-3-5-haiku"), ClaudeProvider)
    
    # OpenAI / Codex models
    assert isinstance(get_provider_for_model("gpt-4o"), OpenAIProvider)
    assert isinstance(get_provider_for_model("gpt-4o-mini"), OpenAIProvider)
    assert isinstance(get_provider_for_model("o3-mini"), OpenAIProvider)
    assert isinstance(get_provider_for_model("codex"), OpenAIProvider)
    
    # Gemini models / Default
    assert isinstance(get_provider_for_model("gemini-2.5-flash"), GeminiProvider)
    assert isinstance(get_provider_for_model("gemini-2.0-pro"), GeminiProvider)
    assert isinstance(get_provider_for_model(""), GeminiProvider)
    assert isinstance(get_provider_for_model(None), GeminiProvider)


def test_model_catalog_structure():
    catalog = get_model_catalog()
    assert len(catalog) == 3
    providers = [c["provider"] for c in catalog]
    assert "google" in providers
    assert "anthropic" in providers
    assert "openai" in providers

    anthropic_group = next(c for c in catalog if c["provider"] == "anthropic")
    model_ids = [m["id"] for m in anthropic_group["models"]]
    assert "claude-3-7-sonnet" in model_ids
    assert "claude-3-5-sonnet" in model_ids


def test_claude_tool_declaration_conversion():
    provider = ClaudeProvider(api_key="mock-key")
    sample_tools = [
        {
            "name": "read_file",
            "description": "Reads file contents",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"]
            }
        }
    ]
    converted = provider._convert_tool_declarations(sample_tools)
    assert len(converted) == 1
    assert converted[0]["name"] == "read_file"
    assert "input_schema" in converted[0]
    assert converted[0]["input_schema"]["properties"]["path"]["type"] == "string"


def test_claude_message_conversion():
    provider = ClaudeProvider(api_key="mock-key")
    gemini_style_history = [
        {"role": "user", "parts": [{"text": "Inspect the workspace"}]},
        {"role": "model", "parts": [
            {"thought": "I should list files"},
            {"functionCall": {"name": "list_files", "args": {"directory": "."}, "id": "call_1"}}
        ]},
        {"role": "user", "parts": [
            {"functionResponse": {"name": "list_files", "id": "call_1", "response": {"output": "main.py, config.py"}}}
        ]}
    ]

    converted = provider._convert_messages(gemini_style_history)
    assert len(converted) == 3
    assert converted[0]["role"] == "user"
    assert converted[1]["role"] == "assistant"
    assert converted[2]["role"] == "user"

    # Verify tool_use and tool_result blocks
    assert converted[1]["content"][0]["type"] == "tool_use"
    assert converted[1]["content"][0]["name"] == "list_files"
    assert converted[2]["content"][0]["type"] == "tool_result"
    assert converted[2]["content"][0]["tool_use_id"] == "call_1"


def test_openai_tool_declaration_conversion():
    provider = OpenAIProvider(api_key="mock-key")
    sample_tools = [
        {
            "name": "run_command",
            "description": "Runs a bash command",
            "parameters": {
                "type": "object",
                "properties": {"command": {"type": "string"}},
                "required": ["command"]
            }
        }
    ]
    converted = provider._convert_tool_declarations(sample_tools)
    assert len(converted) == 1
    assert converted[0]["type"] == "function"
    assert converted[0]["function"]["name"] == "run_command"
    assert "parameters" in converted[0]["function"]


def test_openai_message_conversion():
    provider = OpenAIProvider(api_key="mock-key")
    history = [
        {"role": "user", "parts": [{"text": "Run pytest"}]},
        {"role": "model", "parts": [
            {"functionCall": {"name": "run_command", "args": {"command": "pytest"}, "id": "call_pytest"}}
        ]},
        {"role": "user", "parts": [
            {"functionResponse": {"name": "run_command", "id": "call_pytest", "response": {"output": "10 passed"}}}
        ]}
    ]

    converted = provider._convert_messages(history, system_instruction="You are an AI assistant.")
    assert converted[0]["role"] == "system"
    assert converted[1]["role"] == "user"
    assert converted[2]["role"] == "assistant"
    assert "tool_calls" in converted[2]
    assert converted[3]["role"] == "tool"
    assert converted[3]["tool_call_id"] == "call_pytest"


@pytest.mark.asyncio
async def test_missing_api_keys_surface_honest_diagnostics():
    claude = ClaudeProvider(api_key=None)
    claude._api_key = None
    resp_claude = await claude.generate_response([], None, "", "claude-3-7-sonnet")
    assert resp_claude.status_code == 401
    assert "Anthropic API Key is missing or unconfigured" in resp_claude.error_message

    openai = OpenAIProvider(api_key=None)
    openai._api_key = None
    resp_openai = await openai.generate_response([], None, "", "gpt-4o")
    assert resp_openai.status_code == 401
    assert "OpenAI API Key is missing or unconfigured" in resp_openai.error_message


def test_claude_multi_round_tool_conversation():
    provider = ClaudeProvider(api_key="mock-key")
    multi_round_history = [
        {"role": "user", "parts": [{"text": "First turn prompt"}]},
        {"role": "model", "parts": [
            {"functionCall": {"name": "read_file", "args": {"path": "a.txt"}, "id": "call_a"}}
        ]},
        {"role": "user", "parts": [
            {"functionResponse": {"name": "read_file", "id": "call_a", "response": {"output": "content a"}}}
        ]},
        {"role": "model", "parts": [
            {"functionCall": {"name": "edit_file", "args": {"path": "a.txt", "content": "new"}, "id": "call_b"}}
        ]},
        {"role": "user", "parts": [
            {"functionResponse": {"name": "edit_file", "id": "call_b", "response": {"output": "edited"}}}
        ]}
    ]

    converted = provider._convert_messages(multi_round_history)
    assert len(converted) == 5
    roles = [m["role"] for m in converted]
    assert roles == ["user", "assistant", "user", "assistant", "user"]
    assert converted[1]["content"][0]["type"] == "tool_use"
    assert converted[2]["content"][0]["type"] == "tool_result"
    assert converted[3]["content"][0]["type"] == "tool_use"
    assert converted[4]["content"][0]["type"] == "tool_result"


@pytest.mark.asyncio
async def test_semantic_cache_openai_embedding_routing():
    from app.agent.semantic_cache import generate_query_embedding
    import httpx
    from unittest.mock import AsyncMock, MagicMock

    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "data": [{"embedding": [0.3, 0.4, 0.5]}]
    }
    mock_client.post.return_value = mock_resp

    emb = await generate_query_embedding("Test OpenAI Query", api_key="sk-test-openai-key", client=mock_client)
    assert len(emb) == 3
    assert mock_client.post.call_count == 1
    call_args = mock_client.post.call_args
    assert "https://api.openai.com/v1/embeddings" in call_args[0][0]

