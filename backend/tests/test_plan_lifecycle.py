import pytest
from app.agent.harness import AntigravityHarness
from app.db.models import TaskModel, TaskMessageModel


def test_generate_initial_plan_placeholder():
    harness = AntigravityHarness()
    plan = harness._generate_initial_plan(
        title="Build Modern Web App",
        prompt="Create a responsive web application dashboard with Tailwind CSS",
        persona_name="AppBuilder"
    )

    assert plan["objective"] == "Build Modern Web App"
    assert len(plan["steps"]) == 1
    assert plan["steps"][0]["status"] == "in_progress"
    assert "Synthesizing dynamic execution plan with AI model..." in plan["steps"][0]["title"]
    assert plan["evaluation"]["status"] == "pending"
    assert "Formulating execution plan" in plan["evaluation"]["summary"]


def test_generate_initial_plan_qa_placeholder():
    harness = AntigravityHarness()
    plan = harness._generate_initial_plan(
        title="What is Redis LangCache",
        prompt="Explain Redis LangCache architecture and its performance characteristics",
        persona_name="SoftwareEngineer"
    )

    assert plan["objective"] == "What is Redis LangCache"
    assert len(plan["steps"]) == 1
    assert plan["steps"][0]["status"] == "in_progress"
    assert "Synthesizing dynamic execution plan with AI model..." in plan["steps"][0]["title"]
    assert plan["evaluation"]["status"] == "pending"


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
            model_name="gemini-3.7-flash",
            title="What is Redis LangCache",
            prompt="Explain Redis LangCache architecture",
            persona_name="SoftwareEngineer"
        )

    assert plan["intent_category"] == "qa_research"
    assert plan["objective"] == "Explain Redis LangCache caching architecture"
    assert len(plan["steps"]) == 3
    assert plan["steps"][0]["title"] == "Analyze Redis LangCache cache-aside semantics"
    assert plan["steps"][1]["title"] == "Evaluate latency benchmarks and eviction strategies"
    assert plan["steps"][2]["title"] == "Synthesize comprehensive architectural guide"
    assert plan["evaluation"]["status"] == "pending"


@pytest.mark.asyncio
async def test_dynamic_plan_model_cascade_on_404(monkeypatch):
    harness = AntigravityHarness(model_name="unsupported-model-404")

    class MockCascadeResponse:
        def __init__(self, status_code, data_text=""):
            self.status_code = status_code
            self._text = data_text
            self.text = data_text

        def json(self):
            return {
                "candidates": [{
                    "content": {
                        "parts": [{
                            "text": self._text
                        }]
                    }
                }]
            }

    import httpx
    async def mock_post(self, url, **kwargs):
        if "unsupported-model-404" in str(url):
            return MockCascadeResponse(404, "")
        return MockCascadeResponse(
            200,
            '{"intent_category": "qa_research", "objective": "Explain Grafana alert rules", "steps": [{"id": "step-1", "title": "Analyze Mimir and Prometheus alert queries", "status": "in_progress"}, {"id": "step-2", "title": "Break down Alerting and Pending state intervals", "status": "pending"}, {"id": "step-3", "title": "Synthesize Contact Points and Notification Policies", "status": "pending"}]}'
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    async with httpx.AsyncClient() as client:
        plan = await harness._generate_dynamic_plan(
            client=client,
            api_key="AIzaSyTestKey",
            model_name="unsupported-model-404",
            title="Explain grafana alert rules",
            prompt="Explain grafana alert rules",
            persona_name="SoftwareEngineer"
        )

    assert plan["intent_category"] == "qa_research"
    assert plan["objective"] == "Explain Grafana alert rules"
    assert len(plan["steps"]) == 3
    assert "Mimir and Prometheus" in plan["steps"][0]["title"]
    assert "Contact Points" in plan["steps"][2]["title"]


@pytest.mark.asyncio
async def test_dynamic_plan_error_surfacing_without_fallback(monkeypatch):
    harness = AntigravityHarness()

    class MockErrorResponse:
        status_code = 500
        text = "Internal Server Error"
        def json(self):
            return {"error": {"message": "Server quota or internal error"}}

    import httpx
    async def mock_post(self, url, **kwargs):
        return MockErrorResponse()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    async with httpx.AsyncClient() as client:
        plan = await harness._generate_dynamic_plan(
            client=client,
            api_key="AIzaSyTestKey",
            model_name="gemini-3.7-flash",
            title="What is Redis LangCache",
            prompt="Explain Redis LangCache architecture",
            persona_name="SoftwareEngineer"
        )

    assert plan["intent_category"] == "qa_research"
    assert len(plan["steps"]) == 1
    assert plan["steps"][0]["status"] == "failed"
    assert "Plan Generation Failed:" in plan["steps"][0]["title"]
    assert "500" in plan["steps"][0]["title"]
    assert plan["evaluation"]["status"] == "needs_revision"
    assert "Could not generate dynamic execution plan" in plan["evaluation"]["summary"]


@pytest.mark.asyncio
async def test_dynamic_plan_conversational_greeting():
    harness = AntigravityHarness()
    import httpx
    async with httpx.AsyncClient() as client:
        plan = await harness._generate_dynamic_plan(
            client=client,
            api_key="",
            model_name="gemini-3.7-flash",
            title="hey",
            prompt="hey",
            persona_name="SoftwareEngineer"
        )
    assert plan["intent_category"] == "qa_research"
    assert "greeting" in plan["objective"].lower()
    assert len(plan["steps"]) == 1
    assert plan["steps"][0]["status"] == "in_progress"
    assert "greeting" in plan["steps"][0]["title"].lower()


@pytest.mark.asyncio
async def test_dynamic_plan_missing_api_key():
    harness = AntigravityHarness()
    import httpx
    async with httpx.AsyncClient() as client:
        plan = await harness._generate_dynamic_plan(
            client=client,
            api_key="",
            model_name="gemini-3.7-flash",
            title="Build App",
            prompt="Build a React app",
            persona_name="AppBuilder"
        )

    assert plan["intent_category"] == "app_building"
    assert len(plan["steps"]) == 1
    assert plan["steps"][0]["status"] == "failed"
    assert "Gemini API Key is missing" in plan["steps"][0]["title"]
    assert plan["evaluation"]["status"] == "needs_revision"


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
        persona_name="SoftwareEngineer",
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


@pytest.mark.asyncio
async def test_qa_explanation_evaluation_zero_tools_passes(monkeypatch, tmp_path):
    harness = AntigravityHarness()
    emitted_plans = []
    emitted_messages = []

    async def mock_on_plan(p):
        emitted_plans.append(p)

    async def mock_on_message(sender, content, plan=None):
        emitted_messages.append({"sender": sender, "content": content, "plan": plan})

    class MockGenericResponse:
        def __init__(self, text):
            self.status_code = 200
            self._text = text

        def json(self):
            return {
                "candidates": [{
                    "content": {
                        "parts": [{
                            "text": self._text
                        }]
                    }
                }]
            }

    import httpx
    async def mock_post(self, url, **kwargs):
        json_body = kwargs.get("json", {})
        parts = json_body.get("contents", [{}])[0].get("parts", [{}])
        first_text = parts[0].get("text", "") if parts else ""
        if "Cyclode Master Execution Planner" in first_text:
            return MockGenericResponse('{"intent_category": "qa_research", "objective": "Explain Grafana alert rules", "steps": [{"id": "step-1", "title": "Explain Grafana architecture", "status": "in_progress"}, {"id": "step-2", "title": "Explain alert conditions", "status": "pending"}, {"id": "step-3", "title": "Explain contact points", "status": "pending"}]}')
        return MockGenericResponse("### Grafana Alert Rules\n\nGrafana Alert Rules consist of rule definitions, evaluation groups, and conditions that transition between Normal, Pending, and Alerting states. Notifications are dispatched via Notification Policies to Contact Points.")

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    async def noop(*args, **kwargs):
        pass

    result = await harness.execute_task(
        task_id="task-grafana-qa",
        workspace_path=tmp_path,
        title="Explain grafana alert rules",
        description="Explain grafana alert rules",
        persona_name="SoftwareEngineer",
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
    assert not any(c["name"] == "Tool Execution" and not c["passed"] for c in final_plan["evaluation"]["checks"])


@pytest.mark.asyncio
async def test_qa_task_evaluation_accomplished_without_preview(monkeypatch, tmp_path):
    harness = AntigravityHarness()
    emitted_plans = []
    emitted_messages = []

    async def mock_on_plan(p):
        emitted_plans.append(p)

    async def mock_on_message(sender, content, plan=None):
        emitted_messages.append({"sender": sender, "content": content, "plan": plan})

    class MockGenericResponse:
        def __init__(self, text):
            self.status_code = 200
            self._text = text

        def json(self):
            return {
                "candidates": [{
                    "content": {
                        "parts": [{
                            "text": self._text
                        }]
                    }
                }]
            }

    import httpx
    async def mock_post(self, url, **kwargs):
        json_body = kwargs.get("json", {})
        parts = json_body.get("contents", [{}])[0].get("parts", [{}])
        first_text = parts[0].get("text", "") if parts else ""
        if "Cyclode Master Execution Planner" in first_text:
            return MockGenericResponse('{"intent_category": "qa_research", "objective": "Explain Redis LangCache caching architecture", "steps": [{"id": "step-1", "title": "Analyze Redis LangCache cache-aside semantics", "status": "in_progress"}, {"id": "step-2", "title": "Evaluate latency benchmarks", "status": "pending"}, {"id": "step-3", "title": "Synthesize architectural guide", "status": "pending"}]}')
        return MockGenericResponse("Redis LangCache is an intelligent caching layer designed for LLM prompts and vector embeddings, reducing inference latency by up to 80%.")

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    async def noop(*args, **kwargs):
        pass

    result = await harness.execute_task(
        task_id="task-qa-test",
        workspace_path=tmp_path,
        title="What is Redis LangCache",
        description="Explain Redis LangCache and how it works",
        persona_name="SoftwareEngineer",
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


def test_extract_plan_from_markdown():
    from app.agent.harness import extract_plan_from_markdown

    sample_md = """# Implementation Plan: Cyclode Architecture Hardening & Codebase Remediation

This plan hardens the dynamic plan generation cascade and establishes bidirectional plan synchronization.

### Phase 1: Hardened Multi-Candidate Dynamic Plan Generation
**Objective**: Guarantee that dynamic plan synthesis cascades through valid models.
- **File Touchpoints**:
  - `backend/app/agent/providers/gemini.py`: Normalize models
  - `backend/app/agent/harness.py`: Map model candidates
- **Verification Criteria**:
  - Run pytest tests/test_harness.py

### Phase 2: Bi-Directional Plan Synchronization
**Objective**: Synchronize agent response to the execution plan state.
- **File Touchpoints**:
  - `backend/app/agent/harness.py`: Assign markdown and parse steps
- **Verification Criteria**:
  - Verify on_plan receives updated markdown and pending steps
"""

    parsed = extract_plan_from_markdown(sample_md, default_title="Fallback Title")
    assert parsed["intent_category"] == "planning"
    assert "Cyclode Architecture Hardening" in parsed["title"]
    assert len(parsed["phases"]) == 2
    assert len(parsed["steps"]) == 2
    assert "Hardened Multi-Candidate Dynamic Plan Generation" in parsed["steps"][0]["title"]
    assert parsed["steps"][0]["status"] == "pending"
    assert "Bi-Directional Plan Synchronization" in parsed["steps"][1]["title"]
    assert parsed["steps"][1]["status"] == "pending"
    assert parsed["evaluation"]["status"] == "ready_for_review"
    assert parsed["markdown"] == sample_md


@pytest.mark.asyncio
async def test_plan_mode_promotes_agent_markdown(tmp_path, monkeypatch):
    from app.agent.harness import AntigravityHarness
    from app.db.session import init_db

    await init_db()
    harness = AntigravityHarness(model_name="gemini-3.7-flash")

    emitted_plans = []
    async def mock_on_plan(p):
        emitted_plans.append(p)

    agent_plan_text = """# Implementation Plan: Test Task Remediation

Overview of the implementation plan.

### Phase 1: Scaffolding Endpoints
**Objective**: Set up basic routes.
- **File Touchpoints**:
  - `app/api/test.py`: Add route

### Phase 2: Writing Test Suite
**Objective**: Ensure 100% test coverage.
"""

    class MockGenericResponse:
        def __init__(self, text):
            self.status_code = 200
            self._text = text

        def json(self):
            return {
                "candidates": [{
                    "content": {
                        "parts": [{
                            "text": self._text
                        }]
                    }
                }]
            }

    import httpx
    async def mock_post(self, url, **kwargs):
        json_body = kwargs.get("json", {})
        parts = json_body.get("contents", [{}])[0].get("parts", [{}])
        first_text = parts[0].get("text", "") if parts else ""
        if "Cyclode Master Execution Planner" in first_text:
            # Simulate initial dynamic plan failing or returning fallback
            return MockGenericResponse("")
        return MockGenericResponse(agent_plan_text)

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    async def noop(*args, **kwargs):
        pass

    result = await harness.execute_task(
        task_id="task-plan-mode-test",
        workspace_path=tmp_path,
        title="So what's the plan",
        description="Plan out the remediation",
        persona_name="SoftwareEngineer",
        on_thought=noop,
        on_tool_start=noop,
        on_tool_end=noop,
        on_message=noop,
        on_approval_required=noop,
        on_diff_updated=noop,
        on_plan=mock_on_plan
    )

    assert result["status"] == "COMPLETED"
    assert len(emitted_plans) >= 2
    final_plan = emitted_plans[-1]
    assert final_plan["markdown"] == agent_plan_text.strip()
    assert len(final_plan["steps"]) == 2
    assert "Scaffolding Endpoints" in final_plan["steps"][0]["title"]
    assert final_plan["steps"][0]["status"] == "pending"
    assert final_plan["evaluation"]["status"] == "ready_for_review"


@pytest.mark.asyncio
async def test_get_task_plan_document_self_heals_from_agent_message():
    from app.db.session import async_session_factory, init_db
    from app.db.models import TaskModel, TaskMessageModel
    from app.api.tasks import get_task_plan_document

    await init_db()

    failed_plan = {
        "intent_category": "planning",
        "objective": "Architecture plan",
        "steps": [
            {"id": "step-1", "title": "Plan Generation Failed: Model legacy-model returned HTTP 404", "status": "failed"}
        ],
        "markdown": "# Plan Generation Failed: Model legacy-model returned HTTP 404"
    }

    async with async_session_factory() as session:
        task = TaskModel(
            id="task-heal-test-1",
            title="Cyclode Architecture Hardening",
            description="Remediation plan",
            persona="SoftwareEngineer",
            status="COMPLETED",
            plan=failed_plan
        )
        session.add(task)

        # Add agent message containing the actual architectural plan
        agent_msg = TaskMessageModel(
            task_id="task-heal-test-1",
            sender="agent",
            content=(
                "# Implementation Plan: Cyclode Architecture Hardening\n\n"
                "### Phase 1: Harden Gemini Model Cascades\n"
                "**Objective**: Normalize models.\n\n"
                "### Phase 2: Synchronize Agent Output to Plan\n"
                "**Objective**: Promote markdown."
            )
        )
        session.add(agent_msg)
        await session.commit()

    async with async_session_factory() as session:
        doc = await get_task_plan_document("task-heal-test-1", db=session)
        assert doc["task_id"] == "task-heal-test-1"
        assert "Plan Generation Failed" not in doc["markdown"]
        assert "# Implementation Plan: Cyclode Architecture Hardening" in doc["markdown"]
        assert len(doc["plan"]["steps"]) == 2
        assert "Harden Gemini Model Cascades" in doc["plan"]["steps"][0]["title"]
        assert doc["plan"]["evaluation"]["status"] == "ready_for_review"


@pytest.mark.asyncio
async def test_get_task_diff_endpoint(tmp_path):
    from app.api.tasks import get_task_diff
    from app.db.models import TaskModel, TaskDiffModel
    from app.db.session import async_session_factory, init_db

    await init_db()
    task_id = "task-diff-test-endpoint"

    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Task with Diffs",
            description="Testing diff endpoint",
            workspace_path=str(tmp_path),
            git_branch="cyclode/feature-test-diff",
            status="RUNNING"
        )
        session.add(task)

        diff1 = TaskDiffModel(
            task_id=task_id,
            file_path="src/components/App.tsx",
            diff_content="@@ -1,2 +1,3 @@\n+import React from 'react';\n",
            additions=1,
            deletions=0
        )
        session.add(diff1)
        await session.commit()

    async with async_session_factory() as session:
        res = await get_task_diff(task_id, db=session)
        assert res["ok"] is True
        assert res["task_id"] == task_id
        assert res["branch"] == "cyclode/feature-test-diff"
        assert res["total_files"] == 1
        assert res["total_additions"] == 1
        assert res["total_deletions"] == 0
        assert res["diffs"][0]["file_path"] == "src/components/App.tsx"


@pytest.mark.asyncio
async def test_get_task_commits_endpoint(tmp_path):
    from app.api.tasks import get_task_commits, get_task_diff
    from app.db.models import TaskModel
    from app.db.session import async_session_factory, init_db
    import subprocess

    await init_db()
    task_id = "task-commits-test-endpoint"

    # Initialize a git repo with two commits in tmp_path
    git_env = {"GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1", "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin"}
    subprocess.run(["git", "init"], cwd=str(tmp_path), capture_output=True, env=git_env)
    subprocess.run(["git", "config", "user.name", "Cyclode Agent"], cwd=str(tmp_path), capture_output=True, env=git_env)
    subprocess.run(["git", "config", "user.email", "agent@cyclode.ai"], cwd=str(tmp_path), capture_output=True, env=git_env)

    f1 = tmp_path / "index.ts"
    f1.write_text("console.log('v1');\n")
    subprocess.run(["git", "add", "."], cwd=str(tmp_path), capture_output=True, env=git_env)
    subprocess.run(["git", "commit", "-m", "initial workspace commit"], cwd=str(tmp_path), capture_output=True, env=git_env)

    f1.write_text("console.log('v1');\nconsole.log('v2');\n")
    subprocess.run(["git", "add", "."], cwd=str(tmp_path), capture_output=True, env=git_env)
    subprocess.run(["git", "commit", "-m", "cyclode:turn_1 - added v2 log"], cwd=str(tmp_path), capture_output=True, env=git_env)

    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Task with Commits",
            description="Testing commits endpoint",
            workspace_path=str(tmp_path),
            git_branch="main",
            status="RUNNING"
        )
        session.add(task)
        await session.commit()

    async with async_session_factory() as session:
        # Test /commits
        res_commits = await get_task_commits(task_id, db=session)
        assert res_commits["ok"] is True
        assert res_commits["total"] == 2
        assert res_commits["commits"][0]["turn_label"] == "Turn 1"
        assert "cyclode:turn_1" in res_commits["commits"][0]["message"]
        assert res_commits["commits"][0]["additions"] == 1

        # Test /diff with mode=commit
        head_sha = res_commits["commits"][0]["sha"]
        res_diff_commit = await get_task_diff(task_id, mode="commit", commit_sha=head_sha, db=session)
        assert res_diff_commit["ok"] is True
        assert res_diff_commit["total_files"] == 1
        assert res_diff_commit["diffs"][0]["file_path"] == "index.ts"
        assert res_diff_commit["total_additions"] == 1


@pytest.mark.asyncio
async def test_get_task_diff_filters_cyclode_cache_and_aligns_branch(tmp_path):
    from app.api.tasks import get_task_diff
    from app.db.models import TaskModel
    from app.db.session import async_session_factory, init_db
    import subprocess

    await init_db()
    task_id = "task-diff-cache-filter-test"
    target_branch = "cyclode/task-20260922120000"

    git_env = {"GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1", "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin"}
    subprocess.run(["git", "init", "-b", "main"], cwd=str(tmp_path), capture_output=True, env=git_env)
    subprocess.run(["git", "config", "user.name", "Cyclode Agent"], cwd=str(tmp_path), capture_output=True, env=git_env)
    subprocess.run(["git", "config", "user.email", "agent@cyclode.ai"], cwd=str(tmp_path), capture_output=True, env=git_env)

    # Initial file on main
    (tmp_path / "README.md").write_text("# Project\n")
    subprocess.run(["git", "add", "."], cwd=str(tmp_path), capture_output=True, env=git_env)
    subprocess.run(["git", "commit", "-m", "initial commit"], cwd=str(tmp_path), capture_output=True, env=git_env)

    # Agent creates real change and also creates internal symbols cache file
    (tmp_path / "app.py").write_text("print('hello world')\n")
    (tmp_path / ".cyclode_symbols_cache.json").write_text('{"symbols": []}\n')

    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Task with Cache and Real File",
            description="Testing cache exclusion",
            workspace_path=str(tmp_path),
            git_branch=target_branch,
            status="RUNNING"
        )
        session.add(task)
        await session.commit()

    async with async_session_factory() as session:
        res = await get_task_diff(task_id, db=session)
        assert res["ok"] is True
        assert res["branch"] == target_branch
        file_paths = [d["file_path"] for d in res["diffs"]]
        assert "app.py" in file_paths
        assert ".cyclode_symbols_cache.json" not in file_paths





