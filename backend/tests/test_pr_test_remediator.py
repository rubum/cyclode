import pytest
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch
import httpx
from sqlalchemy import select
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel, TaskPRModel
from app.agent.personas import get_persona, PERSONAS, PERSONA_ALIASES
from app.agent.tools import WorkspaceTools


def test_test_remediator_persona_registered():
    p = get_persona("TestRemediator")
    assert p["name"] == "TestRemediator"
    assert "Principal Test Remediation Engineer" in p["system_instructions"]
    assert "MANDATORY CLOSED-LOOP TEST REMEDIATION PROTOCOL" in p["system_instructions"]


def test_test_remediator_aliases():
    for alias in ["test_remediator", "TestingAgent", "testing_agent", "test_runner"]:
        p = get_persona(alias)
        assert p["name"] == "TestRemediator"


def test_workspace_tools_run_command_cwd(tmp_path: Path):
    sub_dir = tmp_path / "subpkg"
    sub_dir.mkdir()
    (sub_dir / "marker.txt").write_text("hello from subpkg")

    res = WorkspaceTools.run_command(tmp_path, "cat marker.txt", cwd="subpkg")
    assert res["exit_code"] == 0
    assert "hello from subpkg" in res["stdout"]
    assert res.get("cwd") == "subpkg"


@pytest.mark.asyncio
async def test_pr_test_remediation_endpoints():
    async with async_session_factory() as session:
        parent_task = TaskModel(
            title="Parent PR Task",
            repo_name="org/demo-repo",
            repo_url="https://github.com/org/demo-repo",
            workspace_path="/tmp/test-workspace"
        )
        session.add(parent_task)
        await session.commit()
        await session.refresh(parent_task)

        pr = TaskPRModel(
            task_id=parent_task.id,
            pr_number=42,
            title="feat: add telemetry unit tests",
            head_branch="feat/telemetry",
            base_branch="main",
            status="TESTS_FAILED",
            test_output="** (Mix) Error: the dependency telemetry is not available, run mix deps.get"
        )
        session.add(pr)
        await session.commit()
        await session.refresh(pr)

        task_id = parent_task.id
        pr_number = pr.pr_number

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Check initial remediation status (should not exist yet)
        res_get = await client.get(f"/api/tasks/{task_id}/prs/{pr_number}/test/remediate")
        assert res_get.status_code == 200
        get_json = res_get.json()
        assert get_json["exists"] is False
        assert get_json["subsession"] is None
        assert f"pr:{pr_number}" in get_json["session_key"]

        # 2. Trigger remediation with autonomous testing agent
        with patch("app.agent.pool.agent_pool.spawn_task", new_callable=AsyncMock) as mock_spawn:
            mock_spawn.return_value = "subtask-12345"

            res_post = await client.post(
                f"/api/tasks/{task_id}/prs/{pr_number}/test/remediate",
                json={"mode": "agent"}
            )
            assert res_post.status_code == 200
            post_json = res_post.json()
            assert post_json["ok"] is True
            assert post_json["status"] == "LAUNCHED"
            assert post_json["subsession_task_id"] == "subtask-12345"

            mock_spawn.assert_awaited_once()
            call_kwargs = mock_spawn.await_args.kwargs
            assert call_kwargs["persona"] == "TestRemediator"
            assert call_kwargs["parent_task_id"] == task_id
            assert call_kwargs["is_subsession"] is True
            assert call_kwargs["session_key"] == f"test:org/demo-repo:pr:{pr_number}"
            assert "prs/pr-42" in call_kwargs["description"]

        # 3. Create subsession in DB to verify GET returns the active subsession details
        async with async_session_factory() as session:
            subsession_task = TaskModel(
                id="subtask-12345",
                parent_task_id=task_id,
                session_key=f"test:org/demo-repo:pr:{pr_number}",
                title=f"Fix Tests: PR #{pr_number}",
                persona="TestRemediator",
                status="RUNNING",
                is_subsession=True
            )
            session.add(subsession_task)
            await session.commit()

        res_get_active = await client.get(f"/api/tasks/{task_id}/prs/{pr_number}/test/remediate")
        assert res_get_active.status_code == 200
        active_json = res_get_active.json()
        assert active_json["exists"] is True
        assert active_json["subsession"]["id"] == "subtask-12345"
        assert active_json["subsession"]["persona"] == "TestRemediator"
        assert active_json["subsession"]["status"] == "RUNNING"

        # 4. Send follow-up user prompt into subsession
        with patch("app.agent.pool.agent_pool.send_user_message", new_callable=AsyncMock) as mock_send:
            res_msg = await client.post(
                f"/api/tasks/{task_id}/prs/{pr_number}/test/message",
                json={"message": "Please also verify config/test.exs"}
            )
            assert res_msg.status_code == 200
            msg_json = res_msg.json()
            assert msg_json["ok"] is True
            assert msg_json["subsession_task_id"] == "subtask-12345"
            mock_send.assert_awaited_once_with(
                task_id="subtask-12345",
                message_text="Please also verify config/test.exs"
            )

        # 5. Clear ephemeral test console output
        res_clear_test = await client.delete(f"/api/tasks/{task_id}/prs/{pr_number}/test")
        assert res_clear_test.status_code == 200
        clear_json = res_clear_test.json()
        assert clear_json["ok"] is True
        assert clear_json["status"] == "OPEN"

        # Verify PR record was cleared
        async with async_session_factory() as session:
            pr_res = await session.execute(
                select(TaskPRModel).where(TaskPRModel.task_id == task_id, TaskPRModel.pr_number == pr_number)
            )
            pr_db = pr_res.scalars().first()
            assert pr_db.test_output is None
            assert pr_db.status == "OPEN"

        # 6. Reset remediation subsession
        with patch("app.agent.pool.agent_pool.stop_task", new_callable=AsyncMock) as mock_stop:
            res_reset_rem = await client.delete(f"/api/tasks/{task_id}/prs/{pr_number}/test/remediate")
            assert res_reset_rem.status_code == 200
            reset_json = res_reset_rem.json()
            assert reset_json["ok"] is True
            assert reset_json["reset"] is True
            assert reset_json["archived_count"] == 1
            mock_stop.assert_awaited_once_with("subtask-12345", "Testing Agent subsession reset")

        # Verify GET now reports no active subsession
        res_get_after = await client.get(f"/api/tasks/{task_id}/prs/{pr_number}/test/remediate")
        assert res_get_after.status_code == 200
        assert res_get_after.json()["exists"] is False

