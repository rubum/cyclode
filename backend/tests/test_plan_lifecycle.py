import pytest
from app.agent.harness import AntigravityHarness
from app.db.models import TaskModel, TaskMessageModel


def test_generate_initial_plan_app_builder():
    harness = AntigravityHarness()
    plan = harness._generate_initial_plan(
        title="Build OmniCalc Web App",
        prompt="Create a scientific calculator application with Tailwind CSS",
        persona_name="AppBuilder"
    )

    assert plan["objective"] == "Build OmniCalc Web App"
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
