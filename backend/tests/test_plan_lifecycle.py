import pytest
from app.agent.harness import AntigravityHarness
from app.db.models import TaskModel, TaskMessageModel


def test_generate_initial_plan_app_builder():
    harness = AntigravityHarness()
    plan = harness._generate_initial_plan(
        title="Build Modern Web App",
        prompt="Create a responsive web application dashboard with Tailwind CSS",
        persona_name="AppBuilder"
    )

    assert plan["objective"] == "Build Modern Web App"
    assert len(plan["steps"]) == 3
    assert plan["steps"][0]["status"] == "in_progress"
    assert plan["steps"][1]["status"] == "pending"
    assert plan["steps"][2]["status"] == "pending"
    assert "Scaffold application" in plan["steps"][0]["title"]
    assert "interactive components" in plan["steps"][1]["title"]
    assert "preview" in plan["steps"][2]["title"]
    assert plan["evaluation"]["status"] == "pending"


def test_generate_initial_plan_code_reviewer():
    harness = AntigravityHarness()
    plan = harness._generate_initial_plan(
        title="Review Pull Request #42",
        prompt="Review pull request changes and verify edge cases",
        persona_name="CodeReviewer"
    )

    assert len(plan["steps"]) == 3
    assert plan["steps"][0]["status"] == "in_progress"
    assert "Inspect pull request" in plan["steps"][0]["title"]
    assert "bugs" in plan["steps"][1]["title"]
    assert "review synthesis" in plan["steps"][2]["title"]


def test_generate_initial_plan_web_research():
    harness = AntigravityHarness()
    plan = harness._generate_initial_plan(
        title="Latest AI news this week",
        prompt="Search the live web for recent AI model releases",
        persona_name="IssueResolver"
    )

    assert len(plan["steps"]) == 3
    assert "Search live documentation" in plan["steps"][0]["title"]
    assert "Deliver analytical briefing" in plan["steps"][2]["title"]


@pytest.mark.asyncio
async def test_emit_plan_callback():
    harness = AntigravityHarness()
    emitted = []

    async def mock_on_plan(p):
        emitted.append(p)

    initial_plan = harness._generate_initial_plan("Test Plan", "Do task", "IssueResolver")
    await harness._emit_plan(initial_plan, mock_on_plan)

    assert len(emitted) == 1
    assert emitted[0]["objective"] == "Test Plan"


def test_generate_initial_plan_messaging_app():
    harness = AntigravityHarness()
    plan = harness._generate_initial_plan(
        title="Create a messaging app",
        prompt="Build a real-time messaging chat app with channels",
        persona_name="PairProgrammer"
    )

    assert plan["objective"] == "Create a messaging app"
    assert len(plan["steps"]) == 3
    assert "messaging UI layout" in plan["steps"][0]["title"]
    assert "reactive chat stream" in plan["steps"][1]["title"]
    assert "live messaging preview" in plan["steps"][2]["title"]


def test_generate_initial_plan_game():
    harness = AntigravityHarness()
    plan = harness._generate_initial_plan(
        title="Build Retro Arcade Game",
        prompt="Create a classic snake game with canvas and sound effects",
        persona_name="AppBuilder"
    )

    assert len(plan["steps"]) == 3
    assert "canvas" in plan["steps"][0]["title"]
    assert "player controls" in plan["steps"][1]["title"]
    assert "60fps render loop" in plan["steps"][2]["title"]


def test_generate_initial_plan_calculator():
    harness = AntigravityHarness()
    plan = harness._generate_initial_plan(
        title="OmniCalc Studio",
        prompt="Scientific calculator with history log",
        persona_name="AppBuilder"
    )

    assert len(plan["steps"]) == 3
    assert "keypad controls" in plan["steps"][0]["title"]
    assert "calculation engine" in plan["steps"][1]["title"]


def test_database_models_plan_column():
    plan_data = {
        "objective": "Implement authentication",
        "steps": [
            {"id": "step-1", "title": "Scaffold auth routes", "status": "completed"},
            {"id": "step-2", "title": "Implement JWT middleware", "status": "in_progress"}
        ],
        "evaluation": {
            "status": "accomplished",
            "summary": "Verified all JWT claims and test routes."
        }
    }

    task = TaskModel(
        title="Auth Implementation",
        description="Implement user auth",
        plan=plan_data
    )
    assert task.plan == plan_data
    assert task.plan["evaluation"]["status"] == "accomplished"

    msg = TaskMessageModel(
        task_id="test-task-1",
        sender="agent",
        content="Finished implementing authentication.",
        plan=plan_data
    )
    assert msg.plan == plan_data
    assert len(msg.plan["steps"]) == 2


@pytest.mark.asyncio
async def test_permission_denied_403_plan_evaluation(monkeypatch, tmp_path):
    harness = AntigravityHarness()
    emitted_plans = []
    emitted_messages = []

    async def mock_on_plan(p):
        emitted_plans.append(p)

    async def mock_on_message(sender, content, plan=None):
        emitted_messages.append({"sender": sender, "content": content, "plan": plan})

    class Mock403Response:
        status_code = 403
        text = '{"error": {"code": 403, "message": "Your project has been denied access.", "status": "PERMISSION_DENIED"}}'
        def json(self):
            return {"error": {"code": 403, "message": "Your project has been denied access.", "status": "PERMISSION_DENIED"}}

    import httpx
    async def mock_post(self, url, **kwargs):
        return Mock403Response()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    async def noop(*args, **kwargs):
        pass

    result = await harness.execute_task(
        task_id="task-403-test",
        workspace_path=tmp_path,
        title="Create a messaging app",
        description="Create a messaging app",
        persona_name="PairProgrammer",
        on_thought=noop,
        on_tool_start=noop,
        on_tool_end=noop,
        on_message=mock_on_message,
        on_approval_required=noop,
        on_diff_updated=noop,
        on_plan=mock_on_plan
    )

    assert result["status"] == "FAILED"
    assert "Permission Denied" in result["summary"] or "Access Denied" in result["summary"]
    assert len(emitted_plans) >= 2
    final_plan = emitted_plans[-1]
    assert final_plan["evaluation"]["status"] == "needs_revision"
    assert final_plan["steps"][0]["status"] == "failed"
    assert any(c["name"] == "API Connection" and not c["passed"] for c in final_plan["evaluation"]["checks"])
    assert any("Google Gemini API Access Notice (403)" in m["content"] for m in emitted_messages)


@pytest.mark.asyncio
async def test_quota_depleted_429_plan_evaluation(monkeypatch, tmp_path):
    harness = AntigravityHarness()
    emitted_plans = []
    emitted_messages = []

    async def mock_on_plan(p):
        emitted_plans.append(p)

    async def mock_on_message(sender, content, plan=None):
        emitted_messages.append({"sender": sender, "content": content, "plan": plan})

    class Mock429Response:
        status_code = 429
        text = '{"error": {"code": 429, "message": "Resource has been exhausted (e.g. check quota)."}}'
        def json(self):
            return {"error": {"code": 429, "message": "Resource has been exhausted (e.g. check quota)."}}

    import httpx
    async def mock_post(self, url, **kwargs):
        return Mock429Response()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    async def noop(*args, **kwargs):
        pass

    result = await harness.execute_task(
        task_id="task-429-test",
        workspace_path=tmp_path,
        title="Create a game",
        description="Create a snake game",
        persona_name="AppBuilder",
        on_thought=noop,
        on_tool_start=noop,
        on_tool_end=noop,
        on_message=mock_on_message,
        on_approval_required=noop,
        on_diff_updated=noop,
        on_plan=mock_on_plan
    )

    assert result["status"] == "FAILED"
    assert "Quota Depleted" in result["summary"]
    assert len(emitted_plans) >= 2
    final_plan = emitted_plans[-1]
    assert final_plan["evaluation"]["status"] == "needs_revision"
    assert final_plan["steps"][0]["status"] == "failed"
    assert any(c["name"] == "API Connection" and not c["passed"] for c in final_plan["evaluation"]["checks"])
    assert any("Google Gemini API Quota Notice (429)" in m["content"] for m in emitted_messages)


def test_generate_initial_plan_qa_intent():
    harness = AntigravityHarness()
    plan = harness._generate_initial_plan(
        title="What is Redis LangCache",
        prompt="Explain Redis LangCache architecture and its performance characteristics",
        persona_name="PairProgrammer"
    )

    assert plan["intent_category"] == "qa_research"
    assert len(plan["steps"]) == 3
    assert "Search live documentation" in plan["steps"][0]["title"]
    assert "analytical briefing" in plan["steps"][2]["title"]


def test_generate_initial_plan_debugging():
    harness = AntigravityHarness()
    plan = harness._generate_initial_plan(
        title="Fix TypeError in auth",
        prompt="Fix error: TypeError: cannot read property 'token' of undefined",
        persona_name="PairProgrammer"
    )

    assert plan["intent_category"] == "debugging"
    assert "Diagnose runtime error" in plan["steps"][0]["title"]
    assert "test suites" in plan["steps"][2]["title"]


def test_generate_initial_plan_devops():
    harness = AntigravityHarness()
    plan = harness._generate_initial_plan(
        title="Setup Docker containers",
        prompt="Configure docker-compose and deploy nginx reverse proxy",
        persona_name="PairProgrammer"
    )

    assert plan["intent_category"] == "devops"
    assert "container" in plan["steps"][0]["title"]


@pytest.mark.asyncio
async def test_dynamic_plan_llm_synthesis(monkeypatch):
    harness = AntigravityHarness()

    class MockPlanResponse:
        status_code = 200
        def json(self):
            return {
                "candidates": [{
                    "content": {
                        "parts": [{
                            "text": '{"intent_category": "qa_research", "objective": "Explain Redis LangCache caching architecture", "steps": [{"id": "step-1", "title": "Analyze Redis LangCache cache-aside semantics", "status": "in_progress"}, {"id": "step-2", "title": "Evaluate latency benchmarks and eviction strategies", "status": "pending"}, {"id": "step-3", "title": "Synthesize comprehensive architectural guide", "status": "pending"}]}'
                        }]
                    }
                }]
            }

    import httpx
    async def mock_post(self, url, **kwargs):
        return MockPlanResponse()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    async with httpx.AsyncClient() as client:
        plan = await harness._generate_dynamic_plan(
            client=client,
            api_key="AIzaSyTestKey",
            model_name="gemini-2.5-flash",
            title="What is Redis LangCache",
            prompt="Explain Redis LangCache architecture",
            persona_name="PairProgrammer"
        )

    assert plan["intent_category"] == "qa_research"
    assert plan["objective"] == "Explain Redis LangCache caching architecture"
    assert len(plan["steps"]) == 3
    assert plan["steps"][0]["title"] == "Analyze Redis LangCache cache-aside semantics"
    assert plan["steps"][1]["title"] == "Evaluate latency benchmarks and eviction strategies"


@pytest.mark.asyncio
async def test_dynamic_plan_fallback_on_error(monkeypatch):
    harness = AntigravityHarness()

    class MockErrorResponse:
        status_code = 500
        text = "Internal Server Error"
        def json(self):
            return {"error": "Server error"}

    import httpx
    async def mock_post(self, url, **kwargs):
        return MockErrorResponse()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    async with httpx.AsyncClient() as client:
        plan = await harness._generate_dynamic_plan(
            client=client,
            api_key="AIzaSyTestKey",
            model_name="gemini-2.5-flash",
            title="What is Redis LangCache",
            prompt="Explain Redis LangCache architecture",
            persona_name="PairProgrammer"
        )

    assert plan["intent_category"] == "qa_research"
    assert len(plan["steps"]) == 3
    assert "Search live documentation" in plan["steps"][0]["title"]


@pytest.mark.asyncio
async def test_qa_task_evaluation_accomplished_without_preview(monkeypatch, tmp_path):
    harness = AntigravityHarness()
    emitted_plans = []
    emitted_messages = []

    async def mock_on_plan(p):
        emitted_plans.append(p)

    async def mock_on_message(sender, content, plan=None):
        emitted_messages.append({"sender": sender, "content": content, "plan": plan})

    class MockQAResponse:
        status_code = 200
        def json(self):
            return {
                "candidates": [{
                    "content": {
                        "parts": [{
                            "text": "Redis LangCache is an intelligent caching layer designed for LLM prompts and vector embeddings, reducing inference latency by up to 80%."
                        }]
                    }
                }]
            }

    import httpx
    async def mock_post(self, url, **kwargs):
        return MockQAResponse()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    async def noop(*args, **kwargs):
        pass

    result = await harness.execute_task(
        task_id="task-qa-test",
        workspace_path=tmp_path,
        title="What is Redis LangCache",
        description="Explain Redis LangCache and how it works",
        persona_name="PairProgrammer",
        on_thought=noop,
        on_tool_start=noop,
        on_tool_end=noop,
        on_message=mock_on_message,
        on_approval_required=noop,
        on_diff_updated=noop,
        on_plan=mock_on_plan
    )

    assert result["status"] == "COMPLETED"
    assert len(emitted_plans) >= 1
    final_plan = emitted_plans[-1]
    assert final_plan["evaluation"]["status"] == "accomplished"
    assert all(s["status"] == "completed" for s in final_plan["steps"])
    assert any(c["name"] == "Analytical Synthesis" and c["passed"] for c in final_plan["evaluation"]["checks"])
    assert not any(c["name"] == "Live Application Preview" for c in final_plan["evaluation"]["checks"])


