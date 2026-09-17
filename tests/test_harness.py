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
    assert "Obsidian Minimalist Dark" in instructions


def test_persona_software_engineer_and_alias_resolution():
    from app.agent.personas import get_persona
    swe = get_persona("SoftwareEngineer")
    assert swe["name"] == "SoftwareEngineer"
    instructions = swe["system_instructions"]
    assert "npm run build" in instructions
    assert "verify_app_preview" in instructions
    assert "AUTONOMOUS CODE & UI DELIVERY MANDATE" in instructions

    # Test alias resolution
    pair_prog = get_persona("PairProgrammer")
    assert pair_prog["name"] == "SoftwareEngineer"
    assert pair_prog == swe

    swe_alias = get_persona("swe")
    assert swe_alias["name"] == "SoftwareEngineer"


def test_autonomous_html_shell_synthesis(tmp_path):
    from app.api.preview import verify_workspace_preview
    css_dir = tmp_path / "css"
    js_dir = tmp_path / "js"
    css_dir.mkdir(parents=True)
    js_dir.mkdir(parents=True)

    (css_dir / "styles.css").write_text("body { background: #000; }", encoding="utf-8")
    (js_dir / "app.js").write_text("const { createApp } = Vue; createApp({}).mount('#app');", encoding="utf-8")

    # Before synthesis, status is unlinked_assets
    v1 = verify_workspace_preview(tmp_path, "test-stitch")
    assert v1["status"] == "unlinked_assets"

    # Simulate harness synthesis
    css_files = [css_dir / "styles.css"]
    js_files = [js_dir / "app.js"]
    css_links = "\n".join(f'  <link rel="stylesheet" href="./{f.relative_to(tmp_path).as_posix()}" />' for f in css_files)
    js_scripts = "\n".join(f'  <script src="./{f.relative_to(tmp_path).as_posix()}"></script>' for f in js_files)
    html = f"<!DOCTYPE html><html><head>{css_links}</head><body><div id='app'></div>{js_scripts}</body></html>"
    (tmp_path / "index.html").write_text(html, encoding="utf-8")

    # After synthesis, status is ready
    v2 = verify_workspace_preview(tmp_path, "test-stitch")
    assert v2["status"] == "ready"
    assert v2["has_preview"] is True
    assert v2["entry_point"] == "index.html"


def test_guardrail_intent_triggers_on_clean_workspace(tmp_path):
    from app.api.preview import verify_workspace_preview

    # Completely clean / empty workspace
    v = verify_workspace_preview(tmp_path, "test-clean")
    assert v["status"] == "missing_entry_point"
    assert v["has_preview"] is False

    # The harness checks status_val in ["missing_entry_point", "missing_workspace", "empty_ui"]
    # Verify that clean workspace is correctly identified as needing guardrail intervention
    assert v["status"] in ["missing_entry_point", "missing_workspace", "empty_ui"]


