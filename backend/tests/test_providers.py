import pytest
import httpx
from app.agent.providers.base import BaseLLMProvider, ProviderResponse, ToolCallRequest
from app.agent.providers.gemini import GeminiProvider
from app.agent.providers.claude import ClaudeProvider
from app.agent.providers.openai import OpenAIProvider
from app.agent.providers.deepseek import DeepSeekProvider
from app.config import settings
from app.agent.providers.factory import get_provider_for_model, get_model_catalog


def test_provider_factory_routing():
    # DeepSeek models
    assert isinstance(get_provider_for_model("deepseek-flash"), DeepSeekProvider)
    assert isinstance(get_provider_for_model("deepseek-chat"), DeepSeekProvider)
    assert isinstance(get_provider_for_model("deepseek-reasoner"), DeepSeekProvider)
    assert isinstance(get_provider_for_model("deepseek:deepseek-flash"), DeepSeekProvider)

    # Claude & Fable frontier models
    assert isinstance(get_provider_for_model("claude-fable-5-1"), ClaudeProvider)
    assert isinstance(get_provider_for_model("fable"), ClaudeProvider)
    assert isinstance(get_provider_for_model("anthropic:fable-5-1"), ClaudeProvider)
    assert isinstance(get_provider_for_model("claude-3-7-sonnet"), ClaudeProvider)
    assert isinstance(get_provider_for_model("claude-3-5-sonnet"), ClaudeProvider)
    assert isinstance(get_provider_for_model("claude-3-5-haiku"), ClaudeProvider)
    
    # OpenAI & GPT-6 / Codex models
    assert isinstance(get_provider_for_model("gpt-6-astra"), OpenAIProvider)
    assert isinstance(get_provider_for_model("gpt-6"), OpenAIProvider)
    assert isinstance(get_provider_for_model("openai:gpt-6-astra"), OpenAIProvider)
    assert isinstance(get_provider_for_model("gpt-4o"), OpenAIProvider)
    assert isinstance(get_provider_for_model("gpt-4o-mini"), OpenAIProvider)
    assert isinstance(get_provider_for_model("o3-mini"), OpenAIProvider)
    assert isinstance(get_provider_for_model("codex"), OpenAIProvider)
    assert isinstance(get_provider_for_model("custom:my-ollama"), OpenAIProvider)
    
    # Gemini models / Default
    assert isinstance(get_provider_for_model("gemini-3.7-flash"), GeminiProvider)
    assert isinstance(get_provider_for_model("gemini-3.8-flash"), GeminiProvider)
    assert isinstance(get_provider_for_model("google:gemini-3.7-flash"), GeminiProvider)
    assert isinstance(get_provider_for_model("google:gemini-3.8-flash"), GeminiProvider)
    assert isinstance(get_provider_for_model(""), GeminiProvider)
    assert isinstance(get_provider_for_model(None), GeminiProvider)


def test_model_catalog_structure():
    catalog = get_model_catalog()
    assert len(catalog) == 4
    providers = [c["provider"] for c in catalog]
    assert "google" in providers
    assert "deepseek" in providers
    assert "anthropic" in providers
    assert "openai" in providers

    deepseek_group = next(c for c in catalog if c["provider"] == "deepseek")
    ds_ids = [m["id"] for m in deepseek_group["models"]]
    assert "deepseek-flash" in ds_ids
    assert "deepseek-chat" in ds_ids
    assert "deepseek-reasoner" in ds_ids

    anthropic_group = next(c for c in catalog if c["provider"] == "anthropic")
    model_ids = [m["id"] for m in anthropic_group["models"]]
    assert "claude-fable-5-1" in model_ids
    assert "claude-3-7-sonnet" in model_ids
    assert "claude-3-5-sonnet" in model_ids

    google_group = next(c for c in catalog if c["provider"] == "google")
    google_ids = [m["id"] for m in google_group["models"]]
    assert "gemini-3.7-flash" in google_ids
    assert "gemini-3.8-flash" in google_ids

    openai_group = next(c for c in catalog if c["provider"] == "openai")
    openai_ids = [m["id"] for m in openai_group["models"]]
    assert "gpt-6-astra" in openai_ids
    assert "gpt-4o" in openai_ids


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
async def test_missing_api_keys_surface_honest_diagnostics(monkeypatch):
    from app.integrations.manager import integration_manager
    monkeypatch.setattr("app.config.Settings.get_anthropic_api_key", lambda self: None)
    monkeypatch.setattr("app.config.Settings.get_openai_api_key", lambda self: None)
    monkeypatch.setattr(integration_manager, "get_custom_credential", lambda *args, **kwargs: None)
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


def test_integration_manager_model_settings():
    from app.integrations.manager import integration_manager
    from app.config import settings

    # Initial read
    settings_data = integration_manager.get_model_settings()
    assert "routing_mode" in settings_data
    assert "major_model" in settings_data
    assert "minor_model" in settings_data
    assert "providers" in settings_data

    # Update settings
    updated = integration_manager.update_model_settings({
        "routing_mode": "manual",
        "major_model": "gpt-6-astra",
        "minor_model": "gemini-3.8-flash",
        "default_model": "gpt-6-astra",
        "gemini_model": "gemini-3.8-flash",
        "openai_base_url": "http://localhost:11434/v1"
    })

    assert updated["routing_mode"] == "manual"
    assert updated["major_model"] == "gpt-6-astra"
    assert updated["minor_model"] == "gemini-3.8-flash"
    assert updated["default_model"] == "gpt-6-astra"
    assert updated["providers"]["openai"]["base_url"] == "http://localhost:11434/v1"

    # Restore default
    integration_manager.update_model_settings({
        "routing_mode": "adaptive",
        "major_model": "gemini-3.8-flash",
        "minor_model": "gemini-3.7-flash",
        "default_model": "gemini-3.7-flash",
        "openai_base_url": None
    })


@pytest.mark.asyncio
async def test_gemini_thought_signature_and_raw_parts_preservation():
    from app.agent.providers.gemini import GeminiProvider
    from unittest.mock import AsyncMock, MagicMock, patch

    provider = GeminiProvider(api_key="mock-gemini-key")
    mock_client = AsyncMock(spec=httpx.AsyncClient)

    mock_gemini_json = {
        "candidates": [{
            "content": {
                "parts": [
                    {
                        "functionCall": {
                            "name": "list_dir",
                            "args": {"subpath": "."},
                            "id": "call_1_list_dir"
                        },
                        "thoughtSignature": "mock_crypto_token_xyz123"
                    }
                ]
            },
            "finishReason": "STOP"
        }],
        "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 50}
    }

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = mock_gemini_json
    mock_client.post.return_value = mock_resp

    resp = await provider.generate_response(
        messages=[{"role": "user", "parts": [{"text": "Create game"}]}],
        tools=[{"function_declarations": [{"name": "list_dir"}]}],
        system_instruction="You are SoftwareEngineer.",
        model_name="gemini-3.8-flash",
        client=mock_client
    )

    assert resp.status_code == 200
    assert len(resp.tool_calls) == 1
    tc = resp.tool_calls[0]
    assert tc.tool_name == "list_dir"
    assert tc.raw_part is not None
    assert tc.raw_part.get("thoughtSignature") == "mock_crypto_token_xyz123"
    assert resp.raw_parts == mock_gemini_json["candidates"][0]["content"]["parts"]


def test_deepseek_tool_and_message_conversion():
    provider = DeepSeekProvider(api_key="mock-key")
    sample_tools = [
        {
            "name": "replace_file_content",
            "description": "Edits a file block",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"]
            }
        }
    ]
    converted_tools = provider._convert_tool_declarations(sample_tools)
    assert len(converted_tools) == 1
    assert converted_tools[0]["type"] == "function"
    assert converted_tools[0]["function"]["name"] == "replace_file_content"

    history = [
        {"role": "user", "parts": [{"text": "Fix bug"}]},
        {"role": "model", "parts": [
            {"thought": "Checking logs"},
            {"functionCall": {"name": "read_file", "args": {"path": "app.py"}, "id": "call_1"}}
        ]},
        {"role": "user", "parts": [
            {"functionResponse": {"name": "read_file", "id": "call_1", "response": {"output": "print('hello')"}}}
        ]}
    ]
    converted_msgs = provider._convert_messages(history, system_instruction="You are an autonomous AI.")
    assert converted_msgs[0]["role"] == "system"
    assert converted_msgs[1]["role"] == "user"
    assert converted_msgs[2]["role"] == "assistant"
    assert "tool_calls" in converted_msgs[2]
    assert converted_msgs[3]["role"] == "tool"
    assert converted_msgs[3]["tool_call_id"] == "call_1"


@pytest.mark.asyncio
async def test_deepseek_missing_api_key_diagnostics(monkeypatch):
    from app.integrations.manager import integration_manager
    monkeypatch.setattr("app.config.Settings.get_deepseek_api_key", lambda self: None)
    monkeypatch.setattr(integration_manager, "get_custom_credential", lambda *args, **kwargs: None)
    ds = DeepSeekProvider(api_key=None)
    ds._api_key = None
    resp = await ds.generate_response([], None, "", "deepseek-flash")
    assert resp.status_code == 401
    assert "DeepSeek API Key is missing or unconfigured" in resp.error_message


@pytest.mark.asyncio
async def test_deepseek_reasoning_and_tool_call_parsing():
    from unittest.mock import AsyncMock, MagicMock

    provider = DeepSeekProvider(api_key="mock-deepseek-key")
    mock_client = AsyncMock(spec=httpx.AsyncClient)

    mock_ds_json = {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "<think>Analyzing repository structure and dependencies</think>I will inspect the files.",
                "reasoning_content": "DeepSeek R1 internal thought chain",
                "tool_calls": [{
                    "id": "call_inspect_1",
                    "type": "function",
                    "function": {
                        "name": "grep_search",
                        "arguments": '{"query": "def main"}'
                    }
                }]
            },
            "finish_reason": "tool_calls"
        }],
        "usage": {
            "prompt_tokens": 120,
            "completion_tokens": 80
        }
    }

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = mock_ds_json
    mock_client.post.return_value = mock_resp

    resp = await provider.generate_response(
        messages=[{"role": "user", "parts": [{"text": "Search for main entrypoint"}]}],
        tools=[{"name": "grep_search"}],
        system_instruction="You are DeepSeek agent.",
        model_name="deepseek-reasoner",
        client=mock_client
    )

    assert resp.status_code == 200
    assert "DeepSeek R1 internal thought chain" in resp.thought
    assert "Analyzing repository structure" in resp.thought
    assert "I will inspect the files." in resp.content
    assert len(resp.tool_calls) == 1
    assert resp.input_tokens == 120
    assert resp.output_tokens == 80


def test_deepseek_multi_round_tool_conversation():
    provider = DeepSeekProvider(api_key="mock-key")
    multi_round_history = [
        {"role": "user", "parts": [{"text": "Hey"}]},
        {"role": "model", "parts": [
            {"thought": "Inspect workspace"},
            {"functionCall": {"name": "list_dir", "args": {"subpath": "."}, "id": "call_1_list_dir"}},
            {"functionCall": {"name": "run_command", "args": {"command": "git status"}, "id": "call_2_git"}}
        ]},
        {"role": "user", "parts": [
            {"functionResponse": {"name": "list_dir", "id": "call_1_list_dir", "response": {"items": []}}},
            {"functionResponse": {"name": "run_command", "id": "call_2_git", "response": {"stdout": "clean"}}}
        ]}
    ]

    converted = provider._convert_messages(multi_round_history, system_instruction="System prompt")
    assert len(converted) == 5
    assert converted[0]["role"] == "system"
    assert converted[1]["role"] == "user"
    assert converted[1]["content"] == "Hey"
    assert converted[2]["role"] == "assistant"
    assert len(converted[2]["tool_calls"]) == 2
    assert converted[2]["tool_calls"][0]["id"] == "call_1_list_dir"
    assert converted[2]["tool_calls"][1]["id"] == "call_2_git"
    assert converted[3]["role"] == "tool"
    assert converted[3]["tool_call_id"] == "call_1_list_dir"
    assert converted[4]["role"] == "tool"
    assert converted[4]["tool_call_id"] == "call_2_git"


def test_openai_multi_round_tool_conversation():
    provider = OpenAIProvider(api_key="mock-key")
    multi_round_history = [
        {"role": "user", "parts": [{"text": "Hey"}]},
        {"role": "model", "parts": [
            {"thought": "Inspect workspace"},
            {"functionCall": {"name": "list_dir", "args": {"subpath": "."}, "id": "call_1_list_dir"}},
            {"functionCall": {"name": "run_command", "args": {"command": "git status"}, "id": "call_2_git"}}
        ]},
        {"role": "user", "parts": [
            {"functionResponse": {"name": "list_dir", "id": "call_1_list_dir", "response": {"items": []}}},
            {"functionResponse": {"name": "run_command", "id": "call_2_git", "response": {"stdout": "clean"}}}
        ]}
    ]

    converted = provider._convert_messages(multi_round_history, system_instruction="System prompt")
    assert len(converted) == 5
    assert converted[0]["role"] == "system"
    assert converted[1]["role"] == "user"
    assert converted[1]["content"] == "Hey"
    assert converted[2]["role"] == "assistant"
    assert len(converted[2]["tool_calls"]) == 2
    assert converted[2]["tool_calls"][0]["id"] == "call_1_list_dir"
    assert converted[2]["tool_calls"][1]["id"] == "call_2_git"
    assert converted[3]["role"] == "tool"
    assert converted[3]["tool_call_id"] == "call_1_list_dir"
    assert converted[4]["role"] == "tool"
    assert converted[4]["tool_call_id"] == "call_2_git"


def test_deepseek_model_normalization():
    ds = DeepSeekProvider(api_key="mock-key", base_url="https://api.deepseek.com")
    assert ds._normalize_model_name("deepseek-flash") == "deepseek-chat"
    assert ds._normalize_model_name("deepseek-v4-pro") == "deepseek-chat"
    assert ds._normalize_model_name("deepseek-reasoner") == "deepseek-reasoner"
    assert ds._normalize_model_name("deepseek-r1") == "deepseek-reasoner"

    # Custom gateways retain their specified model identifier
    ds_custom = DeepSeekProvider(api_key="mock-key", base_url="https://my-proxy.com/v1")
    assert ds_custom._normalize_model_name("deepseek-flash") == "deepseek-flash"


@pytest.mark.asyncio
async def test_deepseek_structured_plan_timeout_diagnostics():
    from unittest.mock import AsyncMock
    import asyncio

    provider = DeepSeekProvider(api_key="mock-deepseek-key")
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_client.post.side_effect = asyncio.TimeoutError()

    res = await provider.generate_structured_plan("Make a plan", "System instruction", "deepseek-chat", client=mock_client)
    assert res.get("status_code") == 500
    assert "Timed out" in res.get("error", "") or "TimeoutError" in res.get("error", "")


@pytest.mark.asyncio
async def test_update_credentials_preserves_existing_key(monkeypatch):
    from app.integrations.manager import IntegrationManager
    from unittest.mock import patch

    mgr = IntegrationManager()
    monkeypatch.setattr(settings, "DEEPSEEK_API_KEY", "sk-existing-secret-key")
    monkeypatch.setattr(settings, "DEEPSEEK_BASE_URL", "https://api.deepseek.com")

    with patch.object(mgr, "validate_credentials", return_value={"valid": True, "message": "Validated"}):
        res = await mgr.update_credentials("deepseek", {"model": "deepseek-chat", "base_url": "https://api.deepseek.com"})
        assert res["status"] == "configured"
        assert res["masked_credentials"]["api_key"].startswith("sk-e")


def test_deepseek_tool_call_reconciliation_guardrail_turn():
    provider = DeepSeekProvider(api_key="mock-key")
    # Scenario: Assistant issued tool_call, but harness skipped tool execution due to guardrail and added user prompt
    history = [
        {"role": "user", "parts": [{"text": "Build a React game"}]},
        {"role": "model", "parts": [
            {"text": "I will scaffold the app."},
            {"functionCall": {"name": "list_dir", "args": {"subpath": "."}, "id": "call_1"}}
        ]},
        {"role": "user", "parts": [{"text": "Autonomous Pre-Completion Verification Notice: index.html missing."}]}
    ]

    converted = provider._convert_messages(history, system_instruction="System")
    assert converted[0]["role"] == "system"
    assert converted[1]["role"] == "user"
    assert converted[2]["role"] == "assistant"
    # Tool call stripped because text content was present and no tool responses followed
    assert "tool_calls" not in converted[2]
    assert converted[2]["content"] == "I will scaffold the app."
    assert converted[3]["role"] == "user"
    assert "Autonomous Pre-Completion Verification Notice" in converted[3]["content"]


def test_deepseek_tool_call_reconciliation_partial_responses():
    provider = DeepSeekProvider(api_key="mock-key")
    # Scenario: Assistant issued 2 tool calls, but only 1 response was provided in history
    history = [
        {"role": "user", "parts": [{"text": "Run checks"}]},
        {"role": "model", "parts": [
            {"functionCall": {"name": "read_file", "args": {"file_path": "a.py"}, "id": "call_a"}},
            {"functionCall": {"name": "read_file", "args": {"file_path": "b.py"}, "id": "call_b"}}
        ]},
        {"role": "user", "parts": [
            {"functionResponse": {"name": "read_file", "id": "call_a", "response": {"output": "a content"}}}
        ]},
        {"role": "user", "parts": [{"text": "What next?"}]}
    ]

    converted = provider._convert_messages(history, system_instruction="")
    # Check that both tool_a and tool_b have responses before user turn
    assert converted[1]["role"] == "assistant"
    assert len(converted[1]["tool_calls"]) == 2
    assert converted[2]["role"] == "tool"
    assert converted[2]["tool_call_id"] == "call_a"
    assert converted[3]["role"] == "tool"
    assert converted[3]["tool_call_id"] == "call_b"
    assert converted[4]["role"] == "user"
    assert converted[4]["content"] == "What next?"


def test_openai_tool_call_reconciliation_empty_assistant_with_tools():
    provider = OpenAIProvider(api_key="mock-key")
    # Scenario: Assistant issued tool call with no text, followed directly by user message
    history = [
        {"role": "user", "parts": [{"text": "Test"}]},
        {"role": "model", "parts": [
            {"functionCall": {"name": "test_tool", "args": {}, "id": "call_test"}}
        ]},
        {"role": "user", "parts": [{"text": "User interrupted"}]}
    ]

    converted = provider._convert_messages(history, system_instruction="")
    assert converted[1]["role"] == "assistant"
    assert converted[1]["tool_calls"][0]["id"] == "call_test"
    # Synthesized tool response added before user turn to maintain protocol
    assert converted[2]["role"] == "tool"
    assert converted[2]["tool_call_id"] == "call_test"
    assert converted[3]["role"] == "user"


def test_claude_tool_call_reconciliation_missing_results():
    provider = ClaudeProvider(api_key="mock-key")
    history = [
        {"role": "user", "parts": [{"text": "Inspect"}]},
        {"role": "model", "parts": [
            {"functionCall": {"name": "list_dir", "args": {}, "id": "call_list"}}
        ]},
        {"role": "user", "parts": [{"text": "Follow-up question"}]}
    ]

    converted = provider._convert_messages(history)
    # The user message following assistant tool_use must contain the matching tool_result block
    assert converted[0]["role"] == "user"
    assert converted[1]["role"] == "assistant"
    assert converted[2]["role"] == "user"
    tool_results = [b for b in converted[2]["content"] if b.get("type") == "tool_result"]
    assert len(tool_results) == 1
    assert tool_results[0]["tool_use_id"] == "call_list"


def test_json_safe_serializer_handles_datetime_and_models():
    from app.agent.pool import _serialize_json_safe
    from app.schemas.evals import EvaluationScorecard, EvaluationCheck
    from datetime import datetime, timezone
    import json

    now = datetime.now(timezone.utc)
    scorecard = EvaluationScorecard(
        status="accomplished",
        summary="All tests passed",
        score=1.0,
        checks=[EvaluationCheck(name="Lint Check", passed=True)]
    )

    raw_dict = {
        "title": "Task Plan",
        "created_at": now,
        "evaluation": scorecard,
        "nested": {"time": now, "items": [scorecard]}
    }

    sanitized = _serialize_json_safe(raw_dict)
    # Verify standard json.dumps succeeds without TypeError
    dumped = json.dumps(sanitized)
    assert "accomplished" in dumped
    assert "Lint Check" in dumped
    assert isinstance(sanitized["created_at"], str)


@pytest.mark.asyncio
async def test_deepseek_payload_sets_max_tokens():
    from unittest.mock import AsyncMock, MagicMock

    provider = DeepSeekProvider(api_key="mock-key")
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [{"message": {"role": "assistant", "content": "Done."}, "finish_reason": "stop"}]
    }
    mock_client.post.return_value = mock_resp

    await provider.generate_response(
        messages=[{"role": "user", "parts": [{"text": "Hello"}]}],
        tools=None,
        system_instruction="System",
        model_name="deepseek-chat",
        client=mock_client
    )

    call_args = mock_client.post.call_args
    assert call_args is not None
    posted_json = call_args.kwargs.get("json") or call_args[1].get("json")
    assert posted_json is not None
    assert posted_json.get("max_tokens") == 8192


@pytest.mark.asyncio
async def test_openai_payload_sets_max_tokens_and_completion_tokens():
    from unittest.mock import AsyncMock, MagicMock

    provider = OpenAIProvider(api_key="mock-key")
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [{"message": {"role": "assistant", "content": "Done."}, "finish_reason": "stop"}]
    }
    mock_client.post.return_value = mock_resp

    # Standard model (gpt-4o)
    await provider.generate_response(
        messages=[{"role": "user", "parts": [{"text": "Hello"}]}],
        tools=None,
        system_instruction="System",
        model_name="gpt-4o",
        client=mock_client
    )
    call_args = mock_client.post.call_args
    posted_json = call_args.kwargs.get("json") or call_args[1].get("json")
    assert posted_json.get("max_tokens") == 8192
    assert "max_completion_tokens" not in posted_json

    # Reasoning model (o3-mini)
    await provider.generate_response(
        messages=[{"role": "user", "parts": [{"text": "Hello"}]}],
        tools=None,
        system_instruction="System",
        model_name="o3-mini",
        client=mock_client
    )
    call_args = mock_client.post.call_args
    posted_json = call_args.kwargs.get("json") or call_args[1].get("json")
    assert posted_json.get("max_completion_tokens") == 8192
    assert "max_tokens" not in posted_json


@pytest.mark.asyncio
async def test_provider_api_key_resolution_from_integration_manager():
    from unittest.mock import patch
    from app.integrations.manager import integration_manager

    with patch.object(settings, "DEEPSEEK_API_KEY", None), \
         patch.object(settings, "OPENAI_API_KEY", None), \
         patch.object(settings, "ANTHROPIC_API_KEY", None), \
         patch.object(settings, "GEMINI_API_KEY", None), \
         patch.object(settings, "GOOGLE_API_KEY", None), \
         patch.dict("os.environ", {}, clear=True):
        
        # Save custom credentials in integration manager
        integration_manager._custom_credentials["deepseek"] = {"api_key": "sk-deepseek-vault-test-123"}
        integration_manager._custom_credentials["openai"] = {"api_key": "sk-openai-vault-test-456"}
        integration_manager._custom_credentials["anthropic"] = {"api_key": "sk-ant-vault-test-789"}
        integration_manager._custom_credentials["gemini"] = {"api_key": "AIzaSyVaultTest999"}

        ds_prov = DeepSeekProvider()
        oa_prov = OpenAIProvider()
        cl_prov = ClaudeProvider()
        gm_prov = GeminiProvider()

        assert ds_prov.get_api_key() == "sk-deepseek-vault-test-123"
        assert oa_prov.get_api_key() == "sk-openai-vault-test-456"
        assert cl_prov.get_api_key() == "sk-ant-vault-test-789"
        assert gm_prov.get_api_key() == "AIzaSyVaultTest999"

        assert integration_manager.is_configured("deepseek") is True
        assert integration_manager.is_configured("openai") is True
        assert integration_manager.is_configured("anthropic") is True
        assert integration_manager.is_configured("gemini") is True


@pytest.mark.asyncio
async def test_provider_base_url_resolution_from_integration_manager():
    from unittest.mock import patch
    from app.integrations.manager import integration_manager

    with patch.object(settings, "DEEPSEEK_BASE_URL", None), \
         patch.object(settings, "OPENAI_BASE_URL", None), \
         patch.dict("os.environ", {}, clear=True):
        
        integration_manager._custom_credentials["deepseek"] = {"base_url": "https://custom.deepseek.internal/v1"}
        integration_manager._custom_credentials["openai"] = {"base_url": "http://localhost:11434/v1"}

        ds_prov = DeepSeekProvider()
        oa_prov = OpenAIProvider()

        assert ds_prov.get_base_url() == "https://custom.deepseek.internal/v1"
        assert oa_prov.get_base_url() == "http://localhost:11434/v1"


@pytest.mark.asyncio
async def test_vault_interceptor_extracts_all_provider_keys():
    from app.agent.vault_interceptor import VaultInterceptor
    from app.integrations.manager import integration_manager

    # Test prompt with multiple provider secrets
    prompt = (
        "Configure DeepSeek sk-mockmockmockmockmockmockmock123 and "
        "Claude sk-ant-api03-mockantkey1234567890abcdef and "
        "OpenAI sk-proj-mockopenaikey1234567890abcdef and "
        "Linear lin_api_mocklinearkey1234567890"
    )

    sanitized, extracted = await VaultInterceptor.process_prompt(prompt)

    assert "deepseek_api_key" in extracted
    assert extracted["deepseek_api_key"] == "sk-mockmockmockmockmockmockmock123"
    assert "sk-mockmockmockmockmockmockmock123" not in sanitized

    assert "anthropic_api_key" in extracted
    assert extracted["anthropic_api_key"] == "sk-ant-api03-mockantkey1234567890abcdef"
    assert "sk-ant-api03-mockantkey1234567890abcdef" not in sanitized

    assert "openai_api_key" in extracted
    assert extracted["openai_api_key"] == "sk-proj-mockopenaikey1234567890abcdef"
    assert "sk-proj-mockopenaikey1234567890abcdef" not in sanitized

    assert "linear_api_key" in extracted
    assert extracted["linear_api_key"] == "lin_api_mocklinearkey1234567890"
    assert "lin_api_mocklinearkey1234567890" not in sanitized

    assert integration_manager.get_custom_credential("deepseek", "api_key") == "sk-mockmockmockmockmockmockmock123"
    assert integration_manager.get_custom_credential("anthropic", "api_key") == "sk-ant-api03-mockantkey1234567890abcdef"
    assert integration_manager.get_custom_credential("openai", "api_key") == "sk-proj-mockopenaikey1234567890abcdef"
    assert integration_manager.get_custom_credential("linear", "api_key") == "lin_api_mocklinearkey1234567890"







