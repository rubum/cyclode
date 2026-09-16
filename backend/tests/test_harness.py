import pytest
import re
from app.agent.harness import AntigravityHarness


@pytest.mark.asyncio
async def test_emit_streamed_message_anti_echo_guardrail():
    harness = AntigravityHarness()
    emitted_messages = []

    async def mock_on_message(sender: str, content: str):
        emitted_messages.append((sender, content))

    # Test that a leaked action trace is intercepted by the Anti-Echo Guardrail
    raw_action_msg = "Action: Edited file 'src/components/Modals/NewPostModal.jsx'"
    await harness._emit_streamed_message(
        sender="agent",
        content=raw_action_msg,
        on_message=mock_on_message
    )

    assert len(emitted_messages) == 1
    sender, content = emitted_messages[0]
    assert sender == "agent"
    assert not content.startswith("Action:")
    assert "completed and verified" in content


@pytest.mark.asyncio
async def test_emit_streamed_message_normal_synthesis_preserved():
    harness = AntigravityHarness()
    emitted_messages = []

    async def mock_on_message(sender: str, content: str):
        emitted_messages.append((sender, content))

    normal_msg = "### Executive Summary\n\nSuccessfully built the social feed application with responsive layouts."
    await harness._emit_streamed_message(
        sender="agent",
        content=normal_msg,
        on_message=mock_on_message
    )

    assert len(emitted_messages) == 1
    sender, content = emitted_messages[0]
    assert sender == "agent"
    assert "Executive Summary" in content


@pytest.mark.asyncio
async def test_emit_streamed_message_bullet_action_intercepted():
    harness = AntigravityHarness()
    emitted_messages = []

    async def mock_on_message(sender: str, content: str):
        emitted_messages.append((sender, content))

    bullet_action_msg = "• Modified src/components/Feed.jsx and added styles."
    await harness._emit_streamed_message(
        sender="agent",
        content=bullet_action_msg,
        on_message=mock_on_message
    )

    assert len(emitted_messages) == 1
    sender, content = emitted_messages[0]
    assert not content.startswith("• Modified")
    assert "completed and verified" in content


def test_persona_app_builder_resilient_bundling():
    from app.agent.personas import get_persona
    app_builder = get_persona("AppBuilder")
    instructions = app_builder["system_instructions"]
    assert "npx vite build" in instructions
    assert "verify_app_preview" in instructions
    assert "READY" in instructions


def test_persona_pair_programmer_resilient_bundling():
    from app.agent.personas import get_persona
    pair_prog = get_persona("PairProgrammer")
    instructions = pair_prog["system_instructions"]
    assert "npm run build" in instructions
    assert "verify_app_preview" in instructions
