import pytest
import asyncio
import uuid
from pathlib import Path
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel, TaskDiffModel, TaskMessageModel
from app.agent.tools import WorkspaceTools
from app.agent.pool import agent_pool


@pytest.mark.asyncio
async def test_subagents_api_crud_and_lifecycle(tmp_path):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create a parent primary task
        res_parent = await client.post("/api/tasks", json={
            "title": "Primary Factory Orchestrator",
            "description": "Orchestrate feature construction",
            "persona": "SoftwareEngineer",
            "is_subsession": False
        })
        assert res_parent.status_code == 200
        parent_id = res_parent.json()["task_id"]

        # 2. Spawn a worker subagent via POST /api/tasks/{task_id}/subagents
        res_sub = await client.post(f"/api/tasks/{parent_id}/subagents", json={
            "title": "Security Audit Pod",
            "description": "Inspect dependencies and AST for CVE vulnerabilities",
            "persona": "SecurityAuditor",
            "session_key": "sec-scan-01"
        })
        assert res_sub.status_code == 200
        data_sub = res_sub.json()
        assert data_sub["status"] == "ok"
        sub_id = data_sub["subagent_id"]
        assert sub_id is not None

        # 3. Query GET /api/tasks/{task_id}/subagents
        res_list = await client.get(f"/api/tasks/{parent_id}/subagents")
        assert res_list.status_code == 200
        sub_roster = res_list.json()
        assert sub_roster["parent_task_id"] == parent_id
        assert sub_roster["count"] >= 1
        found = next((s for s in sub_roster["subagents"] if s["id"] == sub_id), None)
        assert found is not None
        assert found["persona"] == "SecurityAuditor"
        assert found["parent_task_id"] == parent_id

        # 4. Cancel all subagents
        res_cancel = await client.post(f"/api/tasks/{parent_id}/subagents/cancel-all")
        assert res_cancel.status_code == 200
        cancel_data = res_cancel.json()
        assert cancel_data["status"] == "ok"
        assert sub_id in cancel_data["cancelled_ids"]


@pytest.mark.asyncio
async def test_apply_subagent_diff_tool_and_endpoint(tmp_path):
    # Set up parent workspace directory
    parent_ws = tmp_path / "sandbox-parent-test"
    parent_ws.mkdir(parents=True, exist_ok=True)
    target_file = parent_ws / "service.py"
    target_file.write_text("def run():\n    return 'old'\n")

    # Set up subagent workspace and DB record
    sub_id = "sub-test-diff-123"
    async with async_session_factory() as session:
        parent_task = TaskModel(
            id="parent-test-diff-123",
            title="Parent Session",
            workspace_path=str(parent_ws),
            status="RUNNING"
        )
        sub_task = TaskModel(
            id=sub_id,
            parent_task_id="parent-test-diff-123",
            title="Subagent Worker",
            workspace_path=str(parent_ws),
            status="COMPLETED",
            is_subsession=True
        )
        diff_record = TaskDiffModel(
            task_id=sub_id,
            file_path="service.py",
            diff_content="--- service.py\n+++ service.py\n@@ -1,2 +1,2 @@\n def run():\n-    return 'old'\n+    return 'new_v2'\n",
            additions=1,
            deletions=1
        )
        session.add_all([parent_task, sub_task, diff_record])
        await session.commit()

    # Apply diff directly via WorkspaceTools
    result = await WorkspaceTools.apply_subagent_diff(parent_ws, sub_id)
    assert result.get("success") is True
    assert "service.py" in result.get("applied_files", [])
    assert target_file.read_text() == "def run():\n    return 'new_v2'\n"

    # Test via API endpoint
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(f"/api/tasks/parent-test-diff-123/subagents/{sub_id}/apply-diff")
        assert res.status_code == 200
        data = res.json()
        assert data.get("success") is True


@pytest.mark.asyncio
async def test_delegate_subtasks_and_batch_review(tmp_path):
    ws_path = tmp_path / "sandbox-orch-test"
    ws_path.mkdir(parents=True, exist_ok=True)

    # Test batch_review_prs generation
    res_batch = await WorkspaceTools.batch_review_prs(
        workspace_path=ws_path,
        repository="org/repo",
        pr_numbers=[101, 102],
        wait_for_completion=False
    )
    assert res_batch.get("subtasks_dispatched") == 2
    assert len(res_batch.get("subagent_task_ids", [])) == 2

    # Test get_subagent_results
    sub_ids = res_batch.get("subagent_task_ids", [])
    results = await WorkspaceTools.get_subagent_results(ws_path, sub_ids)
    assert "results" in results
    assert len(results["results"]) == 2


@pytest.mark.asyncio
async def test_subagent_messaging_and_stateful_reuse(tmp_path):
    ws_path = tmp_path / "sandbox-orch-reuse-test"
    ws_path.mkdir(parents=True, exist_ok=True)
    parent_task_id = "orch-reuse-test"

    # 1. Create parent task record
    async with async_session_factory() as session:
        parent_task = TaskModel(
            id=parent_task_id,
            title="Parent Orchestrator",
            workspace_path=str(ws_path),
            status="RUNNING"
        )
        session.add(parent_task)
        await session.commit()

    # 2. Delegate initial subtask with a session_key
    res_initial = await WorkspaceTools.delegate_subtasks(
        workspace_path=ws_path,
        subtasks=[{
            "title": "Auth Module Pod",
            "prompt": "Scaffold authentication logic",
            "persona": "SoftwareEngineer",
            "session_key": "auth-module-pod"
        }],
        wait_for_completion=False
    )
    assert res_initial.get("subtasks_dispatched") == 1
    pod_id = res_initial.get("subagent_task_ids", [])[0]
    assert pod_id is not None

    # Verify pod was created with the session_key
    async with async_session_factory() as session:
        pod_task = (await session.execute(
            TaskModel.__table__.select().where(TaskModel.id == pod_id)
        )).first()
        assert pod_task is not None
        assert pod_task.session_key == "auth-module-pod"

    # 3. Subsequent turn delegates follow-up with matching session_key -> statefully reuses existing pod
    res_followup = await WorkspaceTools.delegate_subtasks(
        workspace_path=ws_path,
        subtasks=[{
            "title": "Auth Module Pod",
            "prompt": "Add password hashing and JWT issuance",
            "persona": "SoftwareEngineer",
            "session_key": "auth-module-pod"
        }],
        wait_for_completion=False
    )
    assert res_followup.get("subtasks_dispatched") == 1
    assert res_followup.get("subagent_task_ids", [])[0] == pod_id

    # 4. Test send_subagent_message tool directly
    send_res = await WorkspaceTools.send_subagent_message(
        workspace_path=ws_path,
        message="Now add OAuth2 provider integration",
        subagent_id=pod_id,
        wait_for_completion=False
    )
    assert send_res.get("status") == "DISPATCHED_ASYNC"
    assert send_res.get("subagent_id") == pod_id

    # 5. Test subagent message endpoint via API
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        api_res = await client.post(
            f"/api/tasks/{parent_task_id}/subagents/{pod_id}/messages",
            json={"content": "Add refresh token rotation"}
        )
        assert api_res.status_code == 200
        assert api_res.json().get("ok") is True


@pytest.mark.asyncio
async def test_inflight_steering_queue_message_ingestion(tmp_path):
    ws_path = tmp_path / "sandbox-steer-test"
    ws_path.mkdir(parents=True, exist_ok=True)
    task_id = "steer-test-task"

    # Create task record
    async with async_session_factory() as session:
        t = TaskModel(
            id=task_id,
            title="Steering Test Session",
            workspace_path=str(ws_path),
            status="RUNNING"
        )
        session.add(t)
        await session.commit()

    # Simulate an active running worker task in agent_pool
    async def dummy_worker():
        await asyncio.sleep(10.0)

    dummy_task = asyncio.create_task(dummy_worker())
    agent_pool.active_tasks[task_id] = dummy_task
    agent_pool.steering_queues[task_id] = asyncio.Queue()

    try:
        # User sends message while worker is actively running
        res = await agent_pool.send_user_message(
            task_id=task_id,
            message_text="In-flight directive: switch UI theme to dark mode immediately."
        )
        assert res.get("ok") is True
        assert res.get("steered") is True

        # Assert message was put in steering_queue rather than creating a duplicate conflicting worker
        assert not agent_pool.steering_queues[task_id].empty()
        queued_msg = await agent_pool.steering_queues[task_id].get()
        assert queued_msg == "In-flight directive: switch UI theme to dark mode immediately."
    finally:
        dummy_task.cancel()
        agent_pool.active_tasks.pop(task_id, None)
        agent_pool.steering_queues.pop(task_id, None)


def test_dynamic_persona_synthesis():
    from app.agent.personas import get_persona

    # 1. Test fabrication of an un-registered persona (e.g. TradeAnalyst)
    custom_inst = "Analyze daily high/low/close, volatility, and order flow for Gold (XAU/USD)."
    role_def = "Quantitative Commodities & Trade Analyst"
    persona = get_persona(
        persona_name="TradeAnalyst",
        custom_instructions=custom_inst,
        role_definition=role_def
    )

    assert persona["name"] == "TradeAnalyst"
    assert persona["description"] == role_def
    assert custom_inst in persona["system_instructions"]
    assert "SPECIALIZED DOMAIN ROLE & DIRECTIVES (TRADEANALYST)" in persona["system_instructions"]
    # Verify platform invariants (e.g. Zero-Internal-Leakage, mandatory markdown links) are composed
    assert "Communication & Synthesis Standards:" in persona["system_instructions"]
    assert "Mandatory Markdown Links:" in persona["system_instructions"]

    # 2. Test customization of an existing persona (e.g. SoftwareEngineer with domain instructions)
    swe_custom = get_persona(
        persona_name="SoftwareEngineer",
        custom_instructions="Prioritize Rust SIMD optimizations for data processing."
    )
    assert swe_custom["name"] == "SoftwareEngineer"
    assert "Prioritize Rust SIMD optimizations" in swe_custom["system_instructions"]


@pytest.mark.asyncio
async def test_delegate_subtasks_with_dynamic_trade_analyst(tmp_path):
    ws_path = tmp_path / "sandbox-trade-test"
    ws_path.mkdir(parents=True, exist_ok=True)
    parent_task_id = "trade-orch-test"

    # 1. Create parent task
    async with async_session_factory() as session:
        parent_task = TaskModel(
            id=parent_task_id,
            title="Gold Market Comparison Orchestrator",
            workspace_path=str(ws_path),
            status="RUNNING"
        )
        session.add(parent_task)
        await session.commit()

    # 2. Delegate subtasks with dynamic TradeAnalyst persona
    res = await WorkspaceTools.delegate_subtasks(
        workspace_path=ws_path,
        subtasks=[{
            "title": "Day 1: October 1 Gold Trading Analysis",
            "prompt": "Evaluate price velocity and tick volume on Oct 1",
            "persona": "TradeAnalyst",
            "role_definition": "Quantitative Commodities & Trade Analyst",
            "persona_instructions": "Analyze intraday high/low/close and volume profile for XAU/USD.",
            "session_key": "gold-day-1"
        }],
        wait_for_completion=False
    )
    assert res.get("subtasks_dispatched") == 1
    sub_id = res.get("subagent_task_ids", [])[0]
    assert sub_id is not None

    # 3. Assert DB record preserved dynamic persona and custom instructions
    async with async_session_factory() as session:
        pod_task = (await session.execute(
            TaskModel.__table__.select().where(TaskModel.id == sub_id)
        )).first()
        assert pod_task is not None
        assert pod_task.persona == "TradeAnalyst"
        assert pod_task.role_definition == "Quantitative Commodities & Trade Analyst"
        assert "Analyze intraday high/low/close" in pod_task.persona_instructions


@pytest.mark.asyncio
async def test_subagent_api_dynamic_persona(tmp_path):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Create parent task
        res_parent = await client.post("/api/tasks", json={
            "title": "Parent Factory Session",
            "description": "Multi-agent coordination",
            "persona": "General"
        })
        assert res_parent.status_code == 200
        parent_id = res_parent.json()["task_id"]

        # Spawn subagent with custom dynamic persona
        res_sub = await client.post(f"/api/tasks/{parent_id}/subagents", json={
            "title": "Security Deep Scan Pod",
            "description": "Scan dependencies for supply chain tampering",
            "persona": "SupplyChainAuditor",
            "role_definition": "Principal Supply Chain Security Auditor",
            "persona_instructions": "Inspect SBOM hashes and verify crate checksums against upstream."
        })
        assert res_sub.status_code == 200
        data_sub = res_sub.json()
        sub_id = data_sub["subagent_id"]

        # Query subagents list and verify serialization
        res_list = await client.get(f"/api/tasks/{parent_id}/subagents")
        assert res_list.status_code == 200
        subagents = res_list.json()["subagents"]
        found = next((s for s in subagents if s["id"] == sub_id), None)
        assert found is not None
        assert found["persona"] == "SupplyChainAuditor"
        assert found["role_definition"] == "Principal Supply Chain Security Auditor"
        assert "Inspect SBOM hashes" in found["persona_instructions"]


@pytest.mark.asyncio
async def test_subagent_full_results_and_diffs_untruncated(tmp_path):
    """
    Verifies that subagents with long analytical reports (>120 chars) and file diffs
    are returned in their entirety without truncation in get_task_subagents API.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create parent task
        res_parent = await client.post("/api/tasks", json={
            "title": "Parent Orchestrator Session",
            "description": "Coordinate multi-agent comparison",
            "persona": "General"
        })
        parent_id = res_parent.json()["task_id"]

        # 2. Directly insert a subagent with a truncated 120-char result_summary but 5KB full message
        long_report = (
            "# Sagents v0.16.1 vs. LangChain v0.15.0: Agent Runtime Architecture\n\n"
            "## Executive Summary\n\n"
            "Sagents does not wrap LangChain's LLMChain as a thin adapter; it replaces the underlying execution loop with OTP GenServer processes.\n\n"
            + ("Detailed comparative section analyzing supervision trees and state machines across repositories.\n" * 50)
        )
        assert len(long_report) > 3000

        subagent_id = "sub-untruncated-test-123"
        async with async_session_factory() as session:
            sub = TaskModel(
                id=subagent_id,
                parent_task_id=parent_id,
                title="Sagents vs LangChain Runtime Comparison",
                description="Compare the agent runtime architecture",
                persona="ElixirAgentArchitect",
                role_definition="Senior Elixir/OTP Architect",
                status="COMPLETED",
                result_summary=long_report[:120],  # Simulate legacy 120-char truncation
                workspace_path=str(tmp_path)
            )
            session.add(sub)

            # Add full message
            msg = TaskMessageModel(
                task_id=subagent_id,
                sender="agent",
                content=long_report,
                tokens=1200
            )
            session.add(msg)

            # Add diff
            diff = TaskDiffModel(
                task_id=subagent_id,
                file_path="lib/sagents/runtime.ex",
                diff_content="@@ -1,4 +1,8 @@\n-defmodule Sagents.Runtime do\n+defmodule Sagents.Runtime.V2 do\n+  use GenServer\n",
                additions=2,
                deletions=1
            )
            session.add(diff)
            await session.commit()

        # 3. Fetch subagents via API
        res_api = await client.get(f"/api/tasks/{parent_id}/subagents")
        assert res_api.status_code == 200
        subagents = res_api.json()["subagents"]
        target = next((s for s in subagents if s["id"] == subagent_id), None)
        assert target is not None

        # Verify result_summary is restored to full length rather than cut at 120 characters
        assert len(target["result_summary"]) == len(long_report)
        assert target["result_summary"].startswith("# Sagents v0.16.1 vs. LangChain v0.15.0")
        assert "Detailed comparative section" in target["result_summary"]

        # Verify diffs are properly serialized with file_path and diff_content
        assert len(target["diffs"]) == 1
        assert target["diffs"][0]["file_path"] == "lib/sagents/runtime.ex"
        assert target["diffs"][0]["additions"] == 2
        assert target["diffs"][0]["deletions"] == 1
        assert "defmodule Sagents.Runtime.V2" in target["diffs"][0]["diff_content"]


@pytest.mark.asyncio
async def test_clear_subagents_and_auto_purge_on_delegation(tmp_path):
    """
    Verifies that calling delegate_subtasks with clear_existing=True (default)
    cleans up prior completed and running subagents, ensuring no stale pods accumulate.
    """
    parent_id = f"parent-wave-{uuid.uuid4().hex[:6]}"
    parent_ws = tmp_path / f"sandbox-{parent_id}"
    parent_ws.mkdir(parents=True, exist_ok=True)

    # 1. Create parent task and 2 previous subagents directly
    async with async_session_factory() as session:
        parent_task = TaskModel(
            id=parent_id,
            title="Swarm Wave Parent",
            description="Orchestrate multi-wave delegation",
            persona="General",
            status="RUNNING",
            workspace_path=str(parent_ws)
        )
        sub1 = TaskModel(
            id=f"sub-wave1-done-{uuid.uuid4().hex[:6]}",
            parent_task_id=parent_id,
            title="Wave 1: Agriculture Analysis",
            description="Analyze top agricultural economies",
            persona="AgronomySpecialist",
            status="COMPLETED",
            result_summary="Completed Africa agriculture report.",
            workspace_path=str(tmp_path / "sub1")
        )
        sub2 = TaskModel(
            id=f"sub-wave1-running-{uuid.uuid4().hex[:6]}",
            parent_task_id=parent_id,
            title="Wave 1: Mining Analysis",
            description="Analyze mining reserves",
            persona="MineralsSpecialist",
            status="RUNNING",
            workspace_path=str(tmp_path / "sub2")
        )
        session.add_all([parent_task, sub1, sub2])
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Verify initial count is 2
        res_initial = await client.get(f"/api/tasks/{parent_id}/subagents")
        assert res_initial.status_code == 200
        assert res_initial.json()["count"] == 2

        # 2. Trigger new delegation with clear_existing=True (default)
        res_del = await WorkspaceTools.delegate_subtasks(
            workspace_path=parent_ws,
            subtasks=[
                {
                    "title": "Wave 2: South America Tech",
                    "prompt": "Evaluate fintech ecosystems in Brazil and Chile",
                    "persona": "FintechAnalyst"
                }
            ],
            wait_for_completion=False,
            clear_existing=True
        )
        assert res_del["subtasks_dispatched"] == 1
        new_sub_id = res_del["subagent_task_ids"][0]

        # 3. Verify that previous subagents were cleared and only the new one exists
        res_after = await client.get(f"/api/tasks/{parent_id}/subagents")
        assert res_after.status_code == 200
        after_subs = res_after.json()["subagents"]
        assert len(after_subs) == 1
        assert after_subs[0]["id"] == new_sub_id
        assert after_subs[0]["persona"] == "FintechAnalyst"
        assert after_subs[0]["title"] == "Wave 2: South America Tech"


@pytest.mark.asyncio
async def test_clear_subagents_api_endpoint(tmp_path):
    """
    Verifies DELETE /api/tasks/{task_id}/subagents and POST /api/tasks/{task_id}/subagents/clear-all
    explicitly purge all child subagent records and return success.
    """
    parent_id = f"parent-clear-{uuid.uuid4().hex[:6]}"
    parent_ws = tmp_path / f"sandbox-{parent_id}"
    parent_ws.mkdir(parents=True, exist_ok=True)

    # Directly create parent task and 3 subagents
    async with async_session_factory() as session:
        parent_task = TaskModel(
            id=parent_id,
            title="Manual Clear Parent",
            description="Test clear API",
            persona="General",
            status="RUNNING",
            workspace_path=str(parent_ws)
        )
        session.add(parent_task)
        for i in range(3):
            s = TaskModel(
                id=f"sub-clear-api-{i}-{uuid.uuid4().hex[:6]}",
                parent_task_id=parent_id,
                title=f"Worker Pod {i + 1}",
                description=f"Task {i + 1}",
                persona="TestWorker",
                status="COMPLETED" if i % 2 == 0 else "RUNNING"
            )
            session.add(s)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Check subagents exist
        res_subs = await client.get(f"/api/tasks/{parent_id}/subagents")
        assert res_subs.json()["count"] == 3

        # Call DELETE endpoint
        res_del = await client.delete(f"/api/tasks/{parent_id}/subagents")
        assert res_del.status_code == 200
        del_data = res_del.json()
        assert del_data["ok"] is True
        assert del_data["cleared_count"] == 3

        # Verify count is now 0
        res_empty = await client.get(f"/api/tasks/{parent_id}/subagents")
        assert res_empty.json()["count"] == 0
        assert len(res_empty.json()["subagents"]) == 0



