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
