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
