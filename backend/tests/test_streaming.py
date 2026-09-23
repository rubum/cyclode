import pytest
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from app.agent.harness import antigravity_harness


@pytest.mark.asyncio
async def test_emit_streamed_thought():
    chunks = []
    starts = []
    ends = []

    async def on_thought(text):
        pass

    async def on_stream_start(stream_type, s_id):
        starts.append((stream_type, s_id))

    async def on_stream_chunk(stream_type, s_id, delta, accumulated):
        chunks.append((stream_type, delta, accumulated))

    async def on_stream_end(stream_type, s_id, final_content):
        ends.append((stream_type, s_id, final_content))

    await antigravity_harness._emit_streamed_thought(
        thought_text="Analyzing repository structure...",
        on_thought=on_thought,
        on_stream_start=on_stream_start,
        on_stream_chunk=on_stream_chunk,
        on_stream_end=on_stream_end,
        stream_id="test-thought-1"
    )

    assert len(starts) == 1
    assert starts[0] == ("thought", "test-thought-1")
    assert len(chunks) > 0
    assert chunks[-1][2] == "Analyzing repository structure..."
    assert len(ends) == 1
    assert ends[0] == ("thought", "test-thought-1", "Analyzing repository structure...")


@pytest.mark.asyncio
async def test_emit_streamed_message():
    chunks = []
    starts = []
    ends = []
    messages = []

    async def on_message(sender, content):
        messages.append((sender, content))

    async def on_stream_start(stream_type, s_id):
        starts.append((stream_type, s_id))

    async def on_stream_chunk(stream_type, s_id, delta, accumulated):
        chunks.append((stream_type, delta, accumulated))

    async def on_stream_end(stream_type, s_id, final_content):
        ends.append((stream_type, s_id, final_content))

    await antigravity_harness._emit_streamed_message(
        sender="agent",
        content="Hello world! Cyclode is ready.",
        on_message=on_message,
        on_stream_start=on_stream_start,
        on_stream_chunk=on_stream_chunk,
        on_stream_end=on_stream_end,
        stream_id="test-msg-1"
    )

    assert len(starts) == 1
    assert starts[0] == ("message", "test-msg-1")
    assert len(chunks) > 0
    assert chunks[-1][2] == "Hello world! Cyclode is ready."
    assert len(ends) == 1
    assert ends[0] == ("message", "test-msg-1", "Hello world! Cyclode is ready.")
    assert len(messages) == 1
    assert messages[0] == ("agent", "Hello world! Cyclode is ready.")


@pytest.mark.asyncio
async def test_emit_streamed_message_propagates_stream_id():
    received_stream_ids = []

    async def on_message_3args(sender, content, s_id):
        received_stream_ids.append((sender, content, s_id))

    await antigravity_harness._emit_streamed_message(
        sender="agent",
        content="Reconciliation test message",
        on_message=on_message_3args,
        stream_id="stream-uuid-999"
    )

    assert len(received_stream_ids) == 1
    assert received_stream_ids[0] == ("agent", "Reconciliation test message", "stream-uuid-999")


@pytest.mark.asyncio
async def test_emit_streamed_thought_propagates_stream_id():
    received_thought_ids = []

    async def on_thought_2args(thought, s_id):
        received_thought_ids.append((thought, s_id))

    await antigravity_harness._emit_streamed_thought(
        thought_text="Analyzing repository structure...",
        on_thought=on_thought_2args,
        stream_id="stream-thought-888"
    )

    assert len(received_thought_ids) == 1
    assert received_thought_ids[0] == ("Analyzing repository structure...", "stream-thought-888")


@pytest.mark.asyncio
async def test_websocket_manager_broadcast_with_clients():
    from app.api.websocket import ws_manager
    from unittest.mock import AsyncMock

    mock_ws = AsyncMock()
    mock_ws.send_text = AsyncMock()

    ws_manager.active_connections.add(mock_ws)
    try:
        await ws_manager.broadcast("TASK_CREATED", {"id": "test-task-123", "status": "INITIALIZING"})
        assert mock_ws.send_text.called
        sent_payload = mock_ws.send_text.call_args[0][0]
        assert "TASK_CREATED" in sent_payload
        assert "test-task-123" in sent_payload
    finally:
        ws_manager.active_connections.discard(mock_ws)


