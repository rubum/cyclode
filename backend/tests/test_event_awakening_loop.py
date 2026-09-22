import pytest
import asyncio
import uuid
import httpx
from pathlib import Path
from app.main import app
from app.core.router import event_router
from app.core.events.debouncer import EventDebouncer, event_debouncer
from app.core.events.dispatcher import OutboundEventDispatcher, event_dispatcher
from app.core.trajectories.collector import TrajectoryCollector
from app.core.evals.runner import EvaluationRunner, evaluation_runner
from app.schemas.events import InboundEventSchema, OutboundEventSchema, OutboundActionType
from app.schemas.trajectory import AgentTrajectory, TrajectoryTurn, ToolInvocationRecord
from app.schemas.evals import EvaluationCategory, EvaluationScorecard, EvaluationCheck
from app.db.session import async_session_factory
from app.db.models import TaskModel


def test_ci_failure_routing():
    # 1. Test check_run failure
    cr_payload = {
        "action": "completed",
        "check_run": {
            "name": "CI / Pytest Unit Tests",
            "conclusion": "failure",
            "output": {
                "title": "2 tests failed in backend/tests/test_auth.py",
                "summary": "AssertionError: Expected 200 got 401"
            },
            "check_suite": {
                "head_branch": "fix/jwt-expiration",
                "head_sha": "d3adb33f"
            }
        },
        "repository": {
            "full_name": "acme/auth-service",
            "clone_url": "https://github.com/acme/auth-service.git"
        }
    }
    title, desc, persona, action = event_router._resolve_task_params("github", "check_run", cr_payload)
    assert "CI Failure: CI / Pytest Unit Tests" in title
    assert persona in ["SoftwareEngineer", "IssueResolver"]
    assert "AssertionError" in desc

    session_key, repo_name, repo_url, branch, commit_sha = event_router._extract_metadata("github", "check_run", cr_payload)
    assert session_key == "github:acme/auth-service:branch:fix/jwt-expiration"
    assert repo_name == "acme/auth-service"
    assert branch == "fix/jwt-expiration"
    assert commit_sha == "d3adb33f"

    # 2. Test status failure (commit status)
    status_payload = {
        "state": "failure",
        "description": "Build failed on step #3 (npm test)",
        "context": "continuous-integration/travis-ci/push",
        "branches": [{"name": "staging"}],
        "sha": "1234567890abcdef",
        "repository": {
            "full_name": "acme/frontend-app",
            "clone_url": "https://github.com/acme/frontend-app.git"
        }
    }
    title, desc, persona, action = event_router._resolve_task_params("github", "status", status_payload)
    assert "CI Failure: continuous-integration/travis-ci/push" in title
    assert persona in ["SoftwareEngineer", "IssueResolver"]
    assert action == "awaken_session"

    session_key, repo_name, repo_url, branch, commit_sha = event_router._extract_metadata("github", "status", status_payload)
    assert session_key == "github:acme/frontend-app:branch:staging"
    assert branch == "staging"
    assert commit_sha == "1234567890abcdef"


@pytest.mark.asyncio
async def test_event_debouncer_coalescing():
    debouncer = EventDebouncer(debounce_seconds=0.15)
    called_events = []

    async def mock_callback(event_dict):
        called_events.append(event_dict)

    # Send 3 rapid push events on same branch
    key = "github:org/repo:branch:main"
    p1 = {"payload": {"commits": [{"id": "c1", "message": "commit 1"}]}}
    p2 = {"payload": {"commits": [{"id": "c2", "message": "commit 2"}]}}
    p3 = {"payload": {"commits": [{"id": "c3", "message": "commit 3"}]}}

    debouncer.submit_event(key, p1, mock_callback)
    await asyncio.sleep(0.03)
    debouncer.submit_event(key, p2, mock_callback)
    await asyncio.sleep(0.03)
    debouncer.submit_event(key, p3, mock_callback)

    # Wait for debouncer window to fire
    await asyncio.sleep(0.3)

    assert len(called_events) == 1
    event_result = called_events[0]
    combined_payload = event_result.get("payload", {})
    # Merged commits should have all 3
    assert len(combined_payload.get("commits", [])) == 3
    assert event_result.get("coalesced_count") == 3


@pytest.mark.asyncio
async def test_outbound_dispatcher():
    dispatcher = OutboundEventDispatcher()
    task_id = str(uuid.uuid4())

    out1 = await dispatcher.record_and_broadcast(
        task_id=task_id,
        action_type=OutboundActionType.POST_PR_REVIEW.value,
        target="github:octocat/repo#42",
        payload={"state": "APPROVED", "body": "Looks great!"}
    )
    assert out1.delivered is True
    assert out1.action_type == "post_pull_request_review"

    out2 = await dispatcher.record_and_broadcast(
        task_id=task_id,
        action_type=OutboundActionType.GIT_PUSH.value,
        target="origin/cyclode-fix",
        payload={"commit_sha": "abc1234", "branch": "cyclode-fix"}
    )
    assert out2.action_type == "git_push"

    events = dispatcher.get_task_outbound_events(task_id)
    assert len(events) == 2


def test_trajectory_collector():
    task_id = str(uuid.uuid4())
    collector = TrajectoryCollector(
        task_id=task_id,
        persona="SoftwareEngineer",
        model_name="gemini-3.7-flash"
    )

    # Turn 1
    collector.start_turn(turn_index=1, user_prompt="Fix login bug")
    collector.add_thought("Inspecting router.py for auth logic")
    collector.record_tool_invocation(
        tool_name="view_file",
        input_args={"AbsolutePath": "/app/router.py"},
        output_data="def login(): pass",
        duration_ms=45
    )
    collector.end_turn(
        agent_response="Identified the bug in router.py",
        tokens=150,
        diff_snapshot_sha="diff_sha_1"
    )

    # Turn 2
    collector.start_turn(turn_index=2)
    collector.add_thought("Applying patch")
    collector.record_tool_invocation(
        tool_name="replace_file_content",
        input_args={"TargetFile": "/app/router.py"},
        output_data="Successfully updated file.",
        duration_ms=120
    )
    collector.end_turn(
        agent_response="Fixed the issue and ran tests.",
        tokens=250,
        diff_snapshot_sha="diff_sha_2"
    )

    trajectory = collector.build_trajectory()
    assert trajectory is not None
    assert len(trajectory.turns) == 2
    assert trajectory.total_tokens == 400
    assert trajectory.turns[0].tool_calls[0].tool_name == "view_file"
    assert trajectory.turns[1].tool_calls[0].tool_name == "replace_file_content"
    assert trajectory.estimated_cost_usd > 0


@pytest.mark.asyncio
async def test_evaluation_runner(tmp_path):
    runner = EvaluationRunner()

    # Create dummy workspace files
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    index_html = workspace / "index.html"
    index_html.write_text("<!DOCTYPE html><html><body><h1>App Preview</h1></body></html>")

    scorecard = await runner.evaluate_task(
        workspace_path=workspace,
        intent_category="interactive_app",
        is_app_task=True,
        preview_info={"status": "ready", "framework": "vanilla_html", "issues": []},
        tool_call_count=2,
        final_agent_text="I have implemented the application and verified the live preview."
    )

    assert scorecard is not None
    assert scorecard.status == "accomplished"
    assert scorecard.score >= 0.8
    assert len(scorecard.checks) >= 3
    preview_check = next((c for c in scorecard.checks if c.category == EvaluationCategory.PREVIEW_BUNDLE), None)
    assert preview_check is not None
    assert preview_check.passed is True


@pytest.mark.asyncio
async def test_api_task_events_and_trajectory():
    async with async_session_factory() as session:
        # Create test task in isolated test DB
        task = TaskModel(
            title="Event Driven Test Task",
            description="Automate event loop",
            status="RUNNING",
            workspace_path="/tmp/test_workspace",
            git_branch="feature/events-test"
        )
        session.add(task)
        await session.commit()
        await session.refresh(task)
        task_id = task.id

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        # 1. Inject event
        res = await client.post(f"/api/tasks/{task_id}/events/inject", json={
            "source": "github",
            "event_type": "check_run",
            "payload": {"check_run": {"conclusion": "failure"}},
            "session_key": "feature/events-test"
        })
        assert res.status_code == 200
        injected_data = res.json()
        assert injected_data["status"] in ["AWAKENED", "injected", "PROCESSED"]

        # 2. Get events
        events_res = await client.get(f"/api/tasks/{task_id}/events")
        assert events_res.status_code == 200
        events_data = events_res.json()
        assert "timeline" in events_data or "inbound" in events_data

        # 3. Get trajectory
        traj_res = await client.get(f"/api/tasks/{task_id}/trajectory")
        assert traj_res.status_code == 200
        traj_data = traj_res.json()
        assert "turns" in traj_data

        # 4. Get evaluation
        eval_res = await client.get(f"/api/tasks/{task_id}/evaluation")
        assert eval_res.status_code == 200
        eval_data = eval_res.json()
        assert "status" in eval_data
        assert "summary" in eval_data

        # 5. Replay task
        replay_res = await client.post(f"/api/tasks/{task_id}/replay")
        assert replay_res.status_code == 200
        replay_data = replay_res.json()
        assert replay_data["status"] in ["PAUSED", "replayed", "QUEUED"]
