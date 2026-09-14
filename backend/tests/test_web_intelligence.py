import pytest
import asyncio
from pathlib import Path
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
async def test_personas_have_prose_and_citation_directives():
    for name, persona in PERSONAS.items():
        instructions = persona["system_instructions"]
        assert "Communication & Synthesis Standards" in instructions
        assert "Mandatory Markdown Links" in instructions
        assert "cohesive analytical prose" in instructions
        assert "bullet highlights" in instructions


@pytest.mark.asyncio
async def test_local_harness_web_query_intent(tmp_path: Path):
    thoughts = []
    messages = []
    tool_events = []

    async def on_thought(t):
        thoughts.append(t)

    async def on_message(sender, content):
        messages.append((sender, content))

    async def on_tool_start(name, args):
        tool_events.append(("start", name, args))

    async def on_tool_end(name, out, code, ms, input_args=None):
        tool_events.append(("end", name, code))

    async def on_approval(act, data):
        pass

    async def on_diff(diffs):
        pass

    res = await antigravity_harness.execute_task(
        task_id="test-web-task-1",
        title="What happened this week at nvidia",
        description="What happened this week at nvidia",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=on_thought,
        on_tool_start=on_tool_start,
        on_tool_end=on_tool_end,
        on_message=on_message,
        on_approval_required=on_approval,
        on_diff_updated=on_diff
    )

    assert res["status"] == "COMPLETED"
    assert len(messages) >= 1
    sender, content = messages[-1]
    assert sender == "agent"
    assert ("NVIDIA" in content or "nvidia" in content or "developer feeds" in content or "ecosystem" in content)
    # Ensure it doesn't give a canned refusal or robotic banner
    assert "I don't have real-time access" not in content
    assert "I do not have access" not in content
    assert "Real-Time Intelligence Briefing" not in content
    # Verify search_web tool was executed
    assert any(t[1] == "search_web" for t in tool_events)


@pytest.mark.asyncio
async def test_local_harness_url_summarize_intent(tmp_path: Path):
    thoughts = []
    messages = []
    tool_events = []

    async def on_thought(t):
        thoughts.append(t)

    async def on_message(sender, content):
        messages.append((sender, content))

    async def on_tool_start(name, args):
        tool_events.append(("start", name, args))

    async def on_tool_end(name, out, code, ms, input_args=None):
        tool_events.append(("end", name, code))

    res = await antigravity_harness.execute_task(
        task_id="test-url-summary-1",
        title="Summarize this https://github.com/confident-ai/deepeval",
        description="Summarize this https://github.com/confident-ai/deepeval",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=on_thought,
        on_tool_start=on_tool_start,
        on_tool_end=on_tool_end,
        on_message=on_message,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res["status"] == "COMPLETED"
    assert len(messages) >= 1
    sender, content = messages[-1]
    assert sender == "agent"
    assert "confident-ai/deepeval" in content
    assert "https://github.com/confident-ai/deepeval" in content
    assert any(t[1] == "fetch_url" for t in tool_events)


@pytest.mark.asyncio
async def test_local_harness_github_repo_analysis_intent(tmp_path: Path):
    # Create sample files in tmp_path to emulate a cloned repo
    (tmp_path / "deepeval").mkdir()
    (tmp_path / "deepeval" / "__init__.py").write_text("# DeepEval module\n", encoding="utf-8")
    (tmp_path / "deepeval" / "evaluator.py").write_text("class Evaluator:\n    pass\n", encoding="utf-8")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_eval.py").write_text("def test_one():\n    assert True\n", encoding="utf-8")
    (tmp_path / "pyproject.toml").write_text('[project]\nname = "deepeval"\ndescription = "Production LLM Evaluation Framework"\n', encoding="utf-8")
    (tmp_path / "README.md").write_text("# DeepEval\n\nDeepEval is an open-source LLM evaluation framework for AI engineers.\n", encoding="utf-8")

    thoughts = []
    messages = []
    tool_events = []

    async def on_thought(t):
        thoughts.append(t)

    async def on_message(sender, content):
        messages.append((sender, content))

    async def on_tool_start(name, args):
        tool_events.append(("start", name, args))

    async def on_tool_end(name, out, code, ms, input_args=None):
        tool_events.append(("end", name, code))

    res = await antigravity_harness.execute_task(
        task_id="test-analysis-task-1",
        title="Analyse this https://github.com/confident-ai/deepeval",
        description="Analyse this https://github.com/confident-ai/deepeval",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=on_thought,
        on_tool_start=on_tool_start,
        on_tool_end=on_tool_end,
        on_message=on_message,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res["status"] == "COMPLETED"
    assert len(messages) >= 1
    sender, content = messages[-1]
    assert sender == "agent"
    assert "https://github.com/confident-ai/deepeval" in content
    assert "| Path / Directory |" in content or "| Language / Runtime |" in content
    assert "Recommended Next Actions" not in content
    assert any(t[1] == "list_dir" for t in tool_events)


@pytest.mark.asyncio
async def test_workspace_tools_search_web_temporal_anchor():
    res = await WorkspaceTools.search_web("nvidia news this week", limit=4)
    assert isinstance(res, dict)
    assert res["query"] == "nvidia news this week"
    assert "results" in res
    assert isinstance(res["results"], list)
    # Check structure of each result item
    for item in res["results"]:
        assert "title" in item
        assert "url" in item
        assert item["url"].startswith("http")
        assert "source" in item
        assert "date" in item


@pytest.mark.asyncio
async def test_local_harness_apple_month_intent(tmp_path: Path):
    thoughts = []
    messages = []
    tool_events = []

    async def on_thought(t):
        thoughts.append(t)

    async def on_message(sender, content):
        messages.append((sender, content))

    async def on_tool_start(name, args):
        tool_events.append(("start", name, args))

    async def on_tool_end(name, out, code, ms, input_args=None):
        tool_events.append(("end", name, code))

    res = await antigravity_harness.execute_task(
        task_id="test-apple-month-1",
        title="Provide a summary of what happened at apple this month",
        description="Provide a summary of what happened at apple this month",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=on_thought,
        on_tool_start=on_tool_start,
        on_tool_end=on_tool_end,
        on_message=on_message,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res["status"] == "COMPLETED"
    assert len(messages) >= 1
    sender, content = messages[-1]
    assert sender == "agent"
    assert "Apple" in content
    # Verify no robotic double dumping
    assert "Real-Time Intelligence Briefing" not in content
    assert any(t[1] == "search_web" for t in tool_events)


@pytest.mark.asyncio
async def test_temporal_query_normalization():
    res = await WorkspaceTools.search_web("Apple news announcements updates March 2025", limit=3)
    assert isinstance(res, dict)
    assert "results" in res
    assert isinstance(res["results"], list)
    assert "results_count" in res
    assert res["results_count"] == len(res["results"])


@pytest.mark.asyncio
async def test_cursor_temporal_homonym_filtering():
    res = await WorkspaceTools.search_web("What is happening at Cursor, esp the last weeks", limit=5)
    assert isinstance(res, dict)
    assert "results" in res
    for item in res["results"]:
        t_lower = item["title"].lower()
        assert "mouse cursor" not in t_lower
        assert "windows 95" not in t_lower
        assert "2019" not in str(item.get("date", ""))


@pytest.mark.asyncio
async def test_spacex_today_temporal_entity_and_noise_filtering():
    res = await WorkspaceTools.search_web("What is happening at Spacex today", limit=5)
    assert isinstance(res, dict)
    assert "results" in res
    for item in res["results"]:
        t_lower = item["title"].lower()
        # Ensure no random non-SpaceX noise is included
        assert any(k in t_lower for k in ("spacex", "space x", "elon musk", "musk", "starship", "starlink", "falcon"))
        assert "lattepanda" not in t_lower
        assert "vibeworld" not in t_lower
        assert "surraura" not in t_lower


@pytest.mark.asyncio
async def test_spacex_local_harness_entity_title(tmp_path: Path):
    messages = []
    res = await antigravity_harness.execute_task(
        task_id="test-spacex-today-1",
        title="What is happening at Spacex today",
        description="What is happening at Spacex today",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, c, ms, a=None: None,
        on_message=lambda s, c: messages.append((s, c)),
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res["status"] == "COMPLETED"
    assert len(messages) >= 1
    sender, content = messages[-1]
    assert sender == "agent"
    # Ensure topic is cleanly SpaceX and not "Spacex Today"
    assert "Spacex Today" not in content
    assert "SpaceX" in content or "spacex" in content.lower()


@pytest.mark.asyncio
async def test_github_repo_query_does_not_trigger_pat_help(tmp_path: Path):
    messages = []
    res = await antigravity_harness.execute_task(
        task_id="test-tgrep-1",
        title="What is this project https://github.com/microsoft/tgrep",
        description="What is this project https://github.com/microsoft/tgrep",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, c, ms, a=None: None,
        on_message=lambda s, c: messages.append((s, c)),
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res["status"] in ("COMPLETED", "IN_PROGRESS")
    assert len(messages) >= 1
    sender, content = messages[-1]
    assert sender == "agent"
    # Must NOT return the PAT generation tutorial
    assert "How to Generate a GitHub Personal Access Token" not in content
    assert "To access private repositories with Cyclode" not in content
    # Should identify the repo or web resource
    assert "microsoft/tgrep" in content or "tgrep" in content or "github.com" in content




