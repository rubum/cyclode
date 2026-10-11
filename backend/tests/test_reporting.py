import pytest
import os
import shutil
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from app.main import app
from app.db.session import async_session_factory
from app.db.models import TaskModel, TaskMessageModel, TaskDiffModel
from app.agent.tools import WorkspaceTools
from app.agent.engine.reporting import (
    _extract_citations_from_text,
    harvest_session_intelligence,
    synthesize_report_markdown,
    generate_printable_html,
    compile_session_report
)


def test_extract_citations_from_text():
    text = """
    Here are our key research findings:
    - [FastAPI Documentation](https://fastapi.tiangolo.com/tutorial)
    - [PostgreSQL Async Driver](https://magicstack.github.io/asyncpg/current/)
    - [Repeated Link](https://fastapi.tiangolo.com/tutorial)
    """
    citations = _extract_citations_from_text(text)
    assert len(citations) == 2
    assert citations[0]["title"] == "FastAPI Documentation"
    assert citations[0]["domain"] == "fastapi.tiangolo.com"
    assert citations[1]["domain"] == "magicstack.github.io"


def test_harvest_and_synthesize_report_markdown():
    # Mock task
    task = TaskModel(
        id="test-task-report-1",
        title="Implement High-Throughput Stream Router",
        description="Build an async event bus for WebSocket client telemetry.",
        persona="CodeArchitect",
        total_tokens=15420
    )
    user_msg = TaskMessageModel(
        id="msg-1",
        task_id="test-task-report-1",
        sender="user",
        content="Please architect the WebSocket telemetry pipeline."
    )
    agent_msg = TaskMessageModel(
        id="msg-2",
        task_id="test-task-report-1",
        sender="agent",
        content="I have designed the pipeline.\n\nWe benchmarked [FastAPI Docs](https://fastapi.tiangolo.com) and confirmed non-blocking broadcast throughput."
    )
    diff = TaskDiffModel(
        id="diff-1",
        task_id="test-task-report-1",
        file_path="backend/app/api/websocket.py",
        diff_content="@@ -1,3 +1,4 @@\n+import asyncio",
        additions=1,
        deletions=0
    )
    task.messages = [user_msg, agent_msg]
    task.diffs = [diff]
    task.plan = {
        "steps": [
            {"title": "Inspect WebSocket Gateway", "status": "completed"},
            {"title": "Implement Async Broadcast Buffer", "status": "completed"}
        ],
        "evaluation": {"status": "passed"}
    }

    intel = harvest_session_intelligence(task, None, [diff])
    assert intel["task_id"] == "test-task-report-1"
    assert len(intel["citations"]) == 1
    assert len(intel["files_touched"]) == 1
    assert intel["files_touched"][0]["path"] == "websocket.py"

    markdown = synthesize_report_markdown(intel)
    assert "# Executive Briefing: Implement High-Throughput Stream Router" in markdown
    assert "FastAPI Docs" in markdown
    assert "websocket.py" in markdown
    assert "Step 1" in markdown

    html = generate_printable_html(intel["title"], markdown, intel)
    assert "<!DOCTYPE html>" in html
    assert "@media print" in html
    assert "FastAPI Docs" in html


@pytest.mark.asyncio
async def test_compile_report_endpoint_and_workspace_save():
    tmp_workspace = f"/tmp/cyclode_test_report_ws_{os.getpid()}"
    os.makedirs(tmp_workspace, exist_ok=True)

    try:
        async with async_session_factory() as session:
            task = TaskModel(
                id="test-task-endpoint-report",
                title="AI Focus Group Benchmarks",
                description="Evaluate 7 focus group platforms.",
                persona="General",
                workspace_path=tmp_workspace
            )
            msg1 = TaskMessageModel(
                id="ep-msg-1",
                task_id=task.id,
                sender="user",
                content="Research the 7 best AI focus group platforms in 2026."
            )
            msg2 = TaskMessageModel(
                id="ep-msg-2",
                task_id=task.id,
                sender="agent",
                content="Here is the comprehensive market comparison based on [H-in-Q Research](https://h-in-q.com/article)."
            )
            session.add_all([task, msg1, msg2])
            await session.commit()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            # 1. POST /api/tasks/{task_id}/report with save_to_workspace
            post_res = await ac.post(
                f"/api/tasks/{task.id}/report",
                json={
                    "title": "2026 AI Focus Group Intelligence Briefing",
                    "save_to_workspace": True
                }
            )
            assert post_res.status_code == 200
            data = post_res.json()
            assert data["title"] == "2026 AI Focus Group Intelligence Briefing"
            assert "H-in-Q Research" in data["markdown"]
            assert data["workspace_file_path"] is not None
            # Check file created on disk
            saved_file = os.path.join(tmp_workspace, data["workspace_file_path"])
            assert os.path.exists(saved_file)

            # 2. GET /api/tasks/{task_id}/report
            get_res = await ac.get(f"/api/tasks/{task.id}/report")
            assert get_res.status_code == 200
            get_data = get_res.json()
            assert get_data["title"] == "2026 AI Focus Group Intelligence Briefing"

            # 3. GET /api/tasks/{task_id}/report/download?format=markdown
            dl_md = await ac.get(f"/api/tasks/{task.id}/report/download?format=markdown")
            assert dl_md.status_code == 200
            assert "attachment" in dl_md.headers["content-disposition"]
            assert "2026_ai_focus_group" in dl_md.headers["content-disposition"]
            assert "# Executive Briefing:" in dl_md.text

            # 4. GET /api/tasks/{task_id}/report/download?format=html
            dl_html = await ac.get(f"/api/tasks/{task.id}/report/download?format=html")
            assert dl_html.status_code == 200
            assert "text/html" in dl_html.headers["content-type"]
            assert "<!DOCTYPE html>" in dl_html.text

            # 5. Tool execution via WorkspaceTools
            tool_res = await WorkspaceTools.compile_session_report(
                task_id=task.id,
                title="Tool Compiled Report",
                save_to_workspace=False
            )
            assert tool_res["success"] is True
            assert tool_res["title"] == "Tool Compiled Report"
    finally:
        if os.path.exists(tmp_workspace):
            shutil.rmtree(tmp_workspace, ignore_errors=True)
