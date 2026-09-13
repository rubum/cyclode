import pytest
from app.core.router import event_router
from app.agent.pool import estimate_tokens


def test_router_param_resolution():
    # GitHub issue event
    gh_payload = {"issue": {"number": 104, "title": "Crash on empty user profile", "body": "Details here"}}
    title, desc, persona, action = event_router._resolve_task_params("github", "issues.opened", gh_payload)
    assert "GitHub Issue #104" in title
    assert persona == "IssueResolver"
    assert action == "spawn_task"

    # GitHub PR opened
    pr_payload = {
        "repository": {"full_name": "octocat/fintech-api"},
        "pull_request": {"number": 42, "title": "Add Stripe webhooks", "body": "Security fix"}
    }
    title, desc, persona, action = event_router._resolve_task_params("github", "pull_request.opened", pr_payload)
    assert "PR #42" in title
    assert persona == "CodeReviewer"
    assert action == "spawn_task"

    # GitHub PR synchronize (new commit)
    sync_payload = {
        "repository": {"full_name": "octocat/fintech-api"},
        "pull_request": {"number": 42, "head": {"sha": "98a1c4f"}},
        "after": "98a1c4f9999"
    }
    title, desc, persona, action = event_router._resolve_task_params("github", "pull_request.synchronize", sync_payload)
    assert "Incremental Review on PR #42" in title
    assert action == "awaken_session"

    # AppSignal exception alert
    as_payload = {"incident": {"exception_name": "NoMethodError", "error_message": "undefined method for nil"}}
    title, desc, persona, action = event_router._resolve_task_params("appsignal", "exception", as_payload)
    assert "AppSignal Alert: NoMethodError" in title
    assert persona == "APMTriage"

    # Slack slash command
    slack_payload = {"text": "/adappty fix memory leak in worker pool"}
    title, desc, persona, action = event_router._resolve_task_params("slack", "slash_command", slack_payload)
    assert persona == "IssueResolver"


def test_router_metadata_extraction():
    # GitHub PR session key
    pr_payload = {
        "repository": {"full_name": "acme/payment-gw", "clone_url": "https://github.com/acme/payment-gw.git"},
        "pull_request": {
            "number": 108,
            "head": {"ref": "feature/idempotency", "sha": "abc1234"}
        }
    }
    session_key, repo_name, repo_url, branch, commit_sha = event_router._extract_metadata("github", "pull_request.opened", pr_payload)
    assert session_key == "github:acme/payment-gw:pr:108"
    assert repo_name == "acme/payment-gw"
    assert branch == "feature/idempotency"
    assert commit_sha == "abc1234"

    # Sentry session key
    sentry_payload = {
        "project": "auth-service",
        "incident": {"id": "SENTRY-99"}
    }
    session_key, repo_name, repo_url, branch, commit_sha = event_router._extract_metadata("sentry", "issue.created", sentry_payload)
    assert session_key == "sentry:auth-service:issue:SENTRY-99"


def test_token_estimation():
    short_text = "Hello world"
    tokens = estimate_tokens(short_text)
    assert tokens >= 2

    long_code = "def authenticate_user(username: str, token: str) -> bool:\n    return hmac.compare_digest(hash(token), expected)"
    code_tokens = estimate_tokens(long_code)
    assert code_tokens > 10


def test_clone_exceptions():
    from app.core.sandboxes.base import CloneAuthRequiredException, CloneFailedException
    auth_exc = CloneAuthRequiredException(repo_url="https://github.com/private/repo", stderr="fatal: could not read Username")
    assert "https://github.com/private/repo" in str(auth_exc)
    assert "fatal: could not read Username" in auth_exc.stderr

    fail_exc = CloneFailedException(repo_url="https://github.com/invalid/repo", stderr="Repository not found")
    assert "Failed to clone repository" in str(fail_exc)


@pytest.mark.asyncio
async def test_conversational_auth_guidance(tmp_path):
    from app.agent.harness import antigravity_harness
    messages_captured = []

    async def mock_msg(sender, content):
        messages_captured.append((sender, content))

    res = await antigravity_harness._execute_local_intent(
        task_id="task-test",
        title="how do I get that?",
        prompt='"Paste your Token here in Chat" - how do I get that?',
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res.get("status") == "AWAITING_INPUT"
    assert len(messages_captured) > 0
    sender, content = messages_captured[0]
    assert sender == "agent"
    assert "Personal Access Token" in content
    assert "github.com/settings/tokens" in content
    assert "repo" in content


@pytest.mark.asyncio
async def test_repository_analysis_intent(tmp_path):
    from app.agent.harness import antigravity_harness
    from app.core.worktree import worktree_manager

    # Initialize sample repo in tmp_path
    worktree_manager.init_sample_repo_if_needed(tmp_path)

    messages_captured = []
    async def mock_msg(sender, content):
        messages_captured.append((sender, content))

    # Test 1: "Analyse it"
    res1 = await antigravity_harness._execute_local_intent(
        task_id="task-analysis-1",
        title="Analyse it",
        prompt="Analyse it",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res1.get("status") == "COMPLETED"
    assert len(messages_captured) == 1
    sender, content = messages_captured[0]
    assert sender == "agent"
    assert "Repository & Architecture Analysis" in content
    assert "Tech Stack & Environment" in content
    assert "app/auth_service.py" in content or "app" in content

    # Test 2: Follow-up question "Where is the repo analysis"
    messages_captured.clear()
    res2 = await antigravity_harness._execute_local_intent(
        task_id="task-analysis-2",
        title="Where is the repo analysis",
        prompt="Where is the repo analysis",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res2.get("status") == "COMPLETED"
    assert len(messages_captured) == 1
    sender, content = messages_captured[0]
    assert "Repository & Architecture Analysis" in content
    assert "Quick Navigation" not in content


@pytest.mark.asyncio
async def test_repository_use_cases_intent(tmp_path):
    from app.agent.harness import antigravity_harness
    from app.core.worktree import worktree_manager

    worktree_manager.init_sample_repo_if_needed(tmp_path)
    (tmp_path / "README.md").write_text("# Sage Agents\n\n- Fault-Tolerant Autonomous Agent Swarms\n- Real-Time Multi-Agent Coordination\n- Stateful Workflow & Memory Management\n", encoding="utf-8")

    messages_captured = []
    res = await antigravity_harness._execute_local_intent(
        task_id="task-use-cases-1",
        title="Use cases of this lib are",
        prompt="Use cases of this lib are",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=lambda s, c: messages_captured.append((s, c)),
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res.get("status") == "COMPLETED"
    assert len(messages_captured) == 1
    sender, content = messages_captured[0]
    assert sender == "agent"
    assert "Key Use Cases & Applications" in content
    assert "Language Breakdown" not in content
    assert "Workspace Topology" not in content


@pytest.mark.asyncio
async def test_unauthenticated_private_repo_connect_and_analyze(tmp_path):
    from app.agent.harness import antigravity_harness
    messages_captured = []

    async def mock_msg(sender, content):
        messages_captured.append((sender, content))

    res = await antigravity_harness._execute_local_intent(
        task_id="task-private-repo",
        title="Connect and analyze repository https://github.com/acme-private/internal-service-api",
        prompt="Connect and analyze repository https://github.com/acme-private/internal-service-api",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res.get("status") == "AWAITING_INPUT"
    assert len(messages_captured) == 1
    sender, content = messages_captured[0]
    assert sender == "agent"
    assert "GitHub Authentication Required" in content
    assert "private repository" in content
    assert "Personal Access Token" in content
    assert "Integration & Repository Configuration Updated" not in content
    assert "Ready to execute autonomous tasks" not in content


@pytest.mark.asyncio
async def test_elixir_polyglot_repository_analysis(tmp_path):
    from app.agent.harness import antigravity_harness

    # Create mock Elixir / Phoenix / Oban / Fly.io workspace
    lib_dir = tmp_path / "lib" / "sample_app"
    lib_dir.mkdir(parents=True, exist_ok=True)
    (lib_dir / "worker.ex").write_text("defmodule SampleApp.Worker do\n  use Oban.Worker\nend")
    (lib_dir / "application.ex").write_text("defmodule SampleApp.Application do\n  use Application\nend")

    test_dir = tmp_path / "test"
    test_dir.mkdir(parents=True, exist_ok=True)
    (test_dir / "sample_app_test.exs").write_text("defmodule SampleAppTest do\n  use ExUnit.Case\nend")
    (test_dir / "worker_test.exs").write_text("defmodule WorkerTest do\n  use ExUnit.Case\nend")

    (tmp_path / "mix.exs").write_text(
        'defmodule SampleApp.MixProject do\n'
        '  use Mix.Project\n'
        '  def project do\n'
        '    [app: :sample_app, deps: [{:phoenix, "~> 1.7"}, {:oban, "~> 2.15"}, {:ecto_sql, "~> 3.10"}]]\n'
        '  end\n'
        'end'
    )
    (tmp_path / ".iex.exs").write_text("import IEx.Helpers\n")
    (tmp_path / "fly-redis-demo.toml").write_text('app = "sample-app-redis"\n')
    (tmp_path / "start-session.sh").write_text('#!/bin/bash\nmix phx.server\n')

    infra_dir = tmp_path / "terraform"
    infra_dir.mkdir(parents=True, exist_ok=True)
    (infra_dir / "main.tf").write_text('resource "aws_s3_bucket" "b" {}\n')

    messages_captured = []
    async def mock_msg(sender, content):
        messages_captured.append((sender, content))

    res = await antigravity_harness._execute_local_intent(
        task_id="task-elixir-analysis",
        title="Analyse it",
        prompt="Analyse it",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res.get("status") == "COMPLETED"
    assert len(messages_captured) == 1
    sender, content = messages_captured[0]
    assert sender == "agent"

    # Core runtime & frameworks
    assert "Elixir" in content
    assert "Phoenix" in content
    assert "Oban" in content
    assert "Ecto" in content

    # Build & Infrastructure
    assert "Fly.io" in content
    assert "Terraform" in content
    assert "Mix / Hex" in content

    # Test runner & file count
    assert "mix test" in content
    assert "2 test files in `test/`" in content
    assert "pytest" not in content
    assert "unittest" not in content

    # Zero fake python paths
    assert "app/auth_service.py" not in content
    assert "Python / Modular Service" not in content
    assert "fly-redis-demo.toml" in content or "mix.exs" in content or "lib/" in content


@pytest.mark.asyncio
async def test_typescript_repository_analysis(tmp_path):
    from app.agent.harness import antigravity_harness

    src_dir = tmp_path / "src"
    src_dir.mkdir(parents=True, exist_ok=True)
    (src_dir / "App.tsx").write_text("export function App() { return <div>Hello</div>; }")
    (src_dir / "main.ts").write_text("console.log('boot');")

    test_dir = tmp_path / "src" / "__tests__"
    test_dir.mkdir(parents=True, exist_ok=True)
    (test_dir / "App.test.tsx").write_text("test('renders', () => {});")

    (tmp_path / "package.json").write_text(
        '{"name": "my-react-app", "dependencies": {"react": "^18.2.0", "tailwindcss": "^3.0"}, "devDependencies": {"vite": "^5.0", "vitest": "^1.0"}}'
    )

    messages_captured = []
    async def mock_msg(sender, content):
        messages_captured.append((sender, content))

    res = await antigravity_harness._execute_local_intent(
        task_id="task-ts-analysis",
        title="Analyze codebase",
        prompt="Analyze codebase",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res.get("status") == "COMPLETED"
    assert len(messages_captured) == 1
    sender, content = messages_captured[0]

    assert "TypeScript" in content
    assert "React" in content
    assert "Vite" in content
    assert "TailwindCSS" in content
    assert "vitest" in content
    assert "pytest" not in content


@pytest.mark.asyncio
async def test_monorepo_and_shebang_and_dsl_analysis(tmp_path):
    from app.agent.harness import antigravity_harness

    # 1. Monorepo web package with Vue & TypeScript
    web_dir = tmp_path / "apps" / "web"
    (web_dir / "src").mkdir(parents=True, exist_ok=True)
    (web_dir / "src" / "App.vue").write_text("<template><div>Hello Vue</div></template>\n<script lang='ts'>export default {};</script>\n")
    (web_dir / "src" / "main.ts").write_text("import App from './App.vue';\nconsole.log(App);\n")
    (web_dir / "package.json").write_text('{"name": "@monorepo/web", "dependencies": {"vue": "^3.4.0", "tailwindcss": "^3.4.0"}}')

    # 2. Monorepo worker package with Elixir, Phoenix, Oban and HEEx template
    worker_dir = tmp_path / "apps" / "worker"
    (worker_dir / "lib").mkdir(parents=True, exist_ok=True)
    (worker_dir / "lib" / "worker.ex").write_text("defmodule Worker do\n  use Oban.Worker\nend\n")
    (worker_dir / "lib" / "view.heex").write_text("<div class='hero'>Phoenix HEEx template</div>\n")
    (worker_dir / "mix.exs").write_text('defmodule Worker.MixProject do\n  use Mix.Project\n  def project do\n    [app: :worker, deps: [{:phoenix, "~> 1.7"}, {:oban, "~> 2.15"}]]\n  end\nend\n')

    # 3. Extensionless script with Shebang
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    (bin_dir / "deploy").write_text("#!/usr/bin/env bash\necho 'Deploying multi-package monorepo...'\n")

    # 4. Schema DSL (Prisma)
    prisma_dir = tmp_path / "prisma"
    prisma_dir.mkdir(parents=True, exist_ok=True)
    (prisma_dir / "schema.prisma").write_text("model User {\n  id Int @id @default(autoincrement())\n  email String @unique\n}\n")

    messages_captured = []
    async def mock_msg(sender, content):
        messages_captured.append((sender, content))

    res = await antigravity_harness._execute_local_intent(
        task_id="task-monorepo-analysis",
        title="Analyze monorepo architecture",
        prompt="Analyze monorepo architecture",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=lambda t: None,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res.get("status") == "COMPLETED"
    assert len(messages_captured) == 1
    sender, content = messages_captured[0]

    # Monorepo topology
    assert "Monorepo & Sub-Project Topology" in content
    assert "apps/web" in content
    assert "apps/worker" in content

    # Frameworks from sub-manifests
    assert "Vue" in content
    assert "Oban" in content
    assert "Phoenix" in content

    # LOC Weighted breakdown
    assert "% LOC" in content
    assert "Elixir" in content

    # Zero fake python defaults
    assert "pytest" not in content
    assert "app/auth_service.py" not in content


@pytest.mark.asyncio
async def test_sandbox_file_content_retrieval_and_security(tmp_path):
    from httpx import AsyncClient, ASGITransport
    from app.main import app
    import uuid
    from app.db.session import async_session_factory
    from app.db.models import TaskModel

    # Create dummy files in tmp_path
    script_dir = tmp_path / ".github" / "scripts"
    script_dir.mkdir(parents=True, exist_ok=True)
    sh_file = script_dir / "docs-only.sh"
    sh_file.write_text("#!/bin/bash\necho 'Docs verified'\n")

    task_id = str(uuid.uuid4())
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Test sandbox explorer",
            description="Verify file viewer endpoint",
            persona="IssueResolver",
            model_name="gemini-3.7-flash",
            status="RUNNING",
            sandbox_status="ACTIVE",
            workspace_path=str(tmp_path),
            git_branch="main"
        )
        session.add(task)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Successful file read
        res = await client.get(f"/api/tasks/{task_id}/files/content?path=.github/scripts/docs-only.sh")
        assert res.status_code == 200
        data = res.json()
        assert data["name"] == "docs-only.sh"
        assert "echo 'Docs verified'" in data["content"]
        assert data["language"] == "bash"
        assert data["lines"] == 2

        # 2. Path traversal attack attempt
        res_traversal = await client.get(f"/api/tasks/{task_id}/files/content?path=../../etc/passwd")
        assert res_traversal.status_code == 403 or res_traversal.status_code == 404

        # 3. Non-existent file
        res_missing = await client.get(f"/api/tasks/{task_id}/files/content?path=.github/scripts/missing.sh")
        assert res_missing.status_code == 404


@pytest.mark.asyncio
async def test_sandbox_persists_for_session_and_cleans_up_on_deletion(tmp_path):
    from httpx import AsyncClient, ASGITransport
    from app.main import app
    import uuid
    from app.db.session import async_session_factory
    from app.db.models import TaskModel
    from app.core.sandboxes.manager import sandbox_manager

    # Create dummy workspace
    ws_dir = tmp_path / "session_ws"
    ws_dir.mkdir(parents=True, exist_ok=True)
    sample_file = ws_dir / "app.py"
    sample_file.write_text("print('hello world')")

    task_id = str(uuid.uuid4())
    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Session persistence test",
            description="Verify sandbox stays active until deletion",
            persona="IssueResolver",
            model_name="gemini-3.7-flash",
            status="COMPLETED",
            sandbox_status="ACTIVE",
            workspace_path=str(ws_dir),
            git_branch="main"
        )
        session.add(task)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Verify sandbox info is active and accessible even when task is COMPLETED
        res = await client.get(f"/api/tasks/{task_id}/sandbox")
        assert res.status_code == 200
        data = res.json()
        assert data["sandbox_status"] == "ACTIVE"
        assert data["exists_on_disk"] is True
        assert data["file_count"] >= 1

        # 2. Verify file content is readable while session exists
        res_f = await client.get(f"/api/tasks/{task_id}/files/content?path=app.py")
        assert res_f.status_code == 200
        assert "hello world" in res_f.json()["content"]

        # 3. Delete session -> should trigger sandbox destruction
        res_del = await client.delete(f"/api/tasks/{task_id}")
        assert res_del.status_code == 200
        assert not ws_dir.exists()


@pytest.mark.asyncio
async def test_create_task_with_github_url_in_prompt_extracts_repo():
    from httpx import AsyncClient, ASGITransport
    from app.main import app
    from app.db.session import async_session_factory
    from app.db.models import TaskModel
    from sqlalchemy import select

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/api/tasks", json={
            "title": "Analyse this https://github.com/confident-ai/deepeval",
            "persona": "PairProgrammer"
        })
        assert res.status_code == 200
        task_id = res.json()["task_id"]

        async with async_session_factory() as session:
            stmt = select(TaskModel).where(TaskModel.id == task_id)
            res_db = await session.execute(stmt)
            task = res_db.scalars().first()
            assert task is not None
            assert task.repo_url == "https://github.com/confident-ai/deepeval"
            assert task.repo_name == "confident-ai/deepeval"

@pytest.mark.asyncio
async def test_ephemeral_provider_clone_flags_and_timeout(monkeypatch):
    from app.core.sandboxes.ephemeral_provider import EphemeralSandboxProvider
    import subprocess

    captured_cmds = []
    captured_timeouts = []
    captured_envs = []

    def mock_run(cmd, capture_output=True, text=True, timeout=None, env=None, cwd=None):
        captured_cmds.append(cmd)
        captured_timeouts.append(timeout)
        captured_envs.append(env)
        class MockCompletedProcess:
            returncode = 0
            stdout = "Cloning..."
            stderr = ""
        return MockCompletedProcess()

    monkeypatch.setattr(subprocess, "run", mock_run)

    provider = EphemeralSandboxProvider()
    sandbox = await provider.create_sandbox(
        task_id="test-clone-timeout",
        repo_url="https://github.com/confident-ai/deepeval"
    )
    assert sandbox is not None
    assert len(captured_cmds) >= 1
    clone_cmd = captured_cmds[0]
    assert "--no-tags" in clone_cmd
    assert "--depth" in clone_cmd
    assert captured_timeouts[0] == 300
    assert captured_envs[0].get("GIT_TERMINAL_PROMPT") == "0"


@pytest.mark.asyncio
async def test_what_is_this_on_and_explain_repo_intent(tmp_path):
    from app.agent.harness import AntigravityHarness

    # Create dummy README.md and pyproject.toml in workspace
    readme = tmp_path / "README.md"
    readme.write_text("# DeepEval\n\nDeepEval is an open-source LLM evaluation framework for unit testing LLM apps.\n\n## Features\n- G-Eval")
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text('[project]\nname = "deepeval"\nversion = "1.0.0"')

    harness = AntigravityHarness()
    messages = []
    thoughts = []

    async def mock_msg(sender, content):
        messages.append((sender, content))

    async def mock_thought(text):
        thoughts.append(text)

    # 1. Test "What is this on"
    res1 = await harness._execute_local_intent(
        task_id="test-task-1",
        title="What is this on",
        prompt="What is this on",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=mock_thought,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )
    assert res1["status"] == "COMPLETED"
    assert len(messages) >= 1
    content1 = messages[-1][1]
    assert "Repository & Architecture Analysis" in content1
    assert "DeepEval is an open-source LLM evaluation framework" in content1

    # 2. Test "Explain the repo"
    messages.clear()
    res2 = await harness._execute_local_intent(
        task_id="test-task-2",
        title="Explain the repo",
        prompt="Explain the repo",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=mock_thought,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )
    assert res2["status"] == "COMPLETED"
    assert len(messages) >= 1
    content2 = messages[-1][1]
    assert "Repository & Architecture Analysis" in content2
    assert "DeepEval is an open-source LLM evaluation framework" in content2

    # 3. Test specific file question "What is in pyproject.toml?"
    messages.clear()
    res3 = await harness._execute_local_intent(
        task_id="test-task-3",
        title="What is in pyproject.toml?",
        prompt="What is in pyproject.toml?",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=mock_thought,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )
    assert res3["status"] == "COMPLETED"
    assert len(messages) >= 1
    content3 = messages[-1][1]
    assert "pyproject.toml" in content3
    assert "deepeval" in content3


@pytest.mark.asyncio
async def test_in_chat_gemini_key_provisioning_and_live_mode(tmp_path, monkeypatch):
    from app.agent.harness import AntigravityHarness
    from app.integrations.manager import integration_manager

    harness = AntigravityHarness()
    messages = []
    thoughts = []

    async def mock_msg(sender, content):
        messages.append((sender, content))

    async def mock_thought(text):
        thoughts.append(text)

    # Mock _execute_with_gemini_api so it doesn't make real network calls
    async def mock_gemini_exec(**kwargs):
        messages.append(("agent", "Hello! I am Gemini. I have analyzed your workspace."))
        return {"status": "COMPLETED", "summary": "Gemini answered prompt"}

    monkeypatch.setattr(harness, "_execute_with_gemini_api", mock_gemini_exec)

    # Prompt containing a Gemini API key
    sample_key = "AIzaSyB_1234567890abcdefghijklmnopqrstuvwxyz"
    res = await harness.execute_task(
        task_id="test-key-task",
        title=f"Use this API key: {sample_key} and analyze the project",
        description=f"Use this API key: {sample_key} and analyze the project",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=mock_thought,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res["status"] == "COMPLETED"
    assert len(messages) >= 1
    assert "Gemini" in messages[-1][1]
    # Check that integration manager received the key
    assert integration_manager._custom_credentials.get("gemini", {}).get("api_key") == sample_key


@pytest.mark.asyncio
async def test_what_is_in_this_repo_url_synthesizes_analysis(tmp_path, monkeypatch):
    from app.agent.harness import AntigravityHarness
    from app.integrations.manager import integration_manager

    harness = AntigravityHarness()
    messages = []
    thoughts = []

    async def mock_msg(sender, content):
        messages.append((sender, content))

    async def mock_thought(text):
        thoughts.append(text)

    # Mock test_remote_repo so it reports accessible
    async def mock_test_remote(repo_url, token=None):
        return {"accessible": True, "branches": ["main"]}

    monkeypatch.setattr(integration_manager, "test_remote_repo", mock_test_remote)

    # Mock subprocess.run for git clone
    import subprocess
    orig_run = subprocess.run
    def mock_run(cmd, *args, **kwargs):
        if isinstance(cmd, list) and "clone" in cmd:
            class MockCompleted:
                returncode = 0
                stdout = "Cloned"
                stderr = ""
            return MockCompleted()
        return orig_run(cmd, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", mock_run)

    from app.agent.handlers.repo_handlers import RepoAnalysisHandler

    async def mock_synth(self, ctx):
        await ctx.emit_message("agent", "### 📊 Repository Architecture & Technical Audit\nDeepEval LLM Evaluation Framework")
        return {"status": "COMPLETED", "summary": "DeepEval analysis complete"}

    monkeypatch.setattr(RepoAnalysisHandler, "execute", mock_synth)

    res = await harness._execute_local_intent(
        task_id="test-what-is-in-this",
        title="What is in this https://github.com/confident-ai/deepeval",
        prompt="What is in this https://github.com/confident-ai/deepeval",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        on_thought=mock_thought,
        on_tool_start=lambda n, a: None,
        on_tool_end=lambda n, o, e, d, a=None: None,
        on_message=mock_msg,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    assert res["status"] == "COMPLETED"
    assert len(messages) == 1
    assert "Repository Architecture & Technical Audit" in messages[0][1]
    assert "Integration & Repository Configuration Updated" not in messages[0][1]


@pytest.mark.asyncio
async def test_realtime_event_broadcast_and_webhook_listener_registration(monkeypatch):
    from app.core.router import event_router
    from app.api.websocket import ws_manager
    from app.integrations.github_client import github_client
    from app.integrations.manager import integration_manager

    # 1. Test EventRouter broadcasts EVENT_RECEIVED over WebSocket
    broadcasts = []
    async def mock_broadcast(event_type, data):
        broadcasts.append((event_type, data))

    monkeypatch.setattr(ws_manager, "broadcast", mock_broadcast)

    payload = {
        "repository": {"full_name": "listener-org/listener-service", "clone_url": "https://github.com/listener-org/listener-service"},
        "pull_request": {"number": 15, "head": {"ref": "fix-stripe-checkout", "sha": "a1b2c3d"}},
        "sender": {"login": "octocat"}
    }

    res = await event_router.route_and_dispatch(
        source="github",
        event_type="pull_request.opened",
        payload=payload,
        signature_valid=True
    )

    assert res["ok"] is True
    assert res["session_key"] == "github:listener-org/listener-service:pr:15"
    assert res["persona"] == "CodeReviewer"

    # Verify WebSocket broadcast occurred
    event_broadcasts = [b for b in broadcasts if b[0] == "EVENT_RECEIVED"]
    assert len(event_broadcasts) >= 1
    ev_type, ev_data = event_broadcasts[0]
    assert ev_type == "EVENT_RECEIVED"
    assert ev_data["source"] == "github"
    assert ev_data["event_type"] == "pull_request.opened"
    assert ev_data["signature_valid"] is True
    assert ev_data["task_id"] == res["task_id"]

    # 2. Test GitHub Webhook Listener Creation via IntegrationManager
    async def mock_create_hook(owner, repo, webhook_url, secret=None, events=None, custom_token=None):
        return {
            "success": True,
            "hook_id": 998877,
            "status": "active",
            "message": f"Successfully registered webhook listener on {owner}/{repo}.",
            "events": events or ["pull_request", "issues"],
            "webhook_url": webhook_url
        }

    monkeypatch.setattr(github_client, "create_or_update_webhook", mock_create_hook)

    hook_res = await integration_manager.install_repo_webhook(
        full_name="listener-org/listener-service",
        webhook_url="http://localhost:8000/api/webhooks/github",
        custom_token="ghp_mocktoken12345678"
    )

    assert hook_res["success"] is True
    assert hook_res["hook_id"] == 998877
    assert hook_res["status"] == "active"


@pytest.mark.asyncio
async def test_repository_simulate_event_endpoint(monkeypatch):
    import uuid
    from app.db.session import async_session_factory
    from app.db.models import RepositoryConfigModel, get_utc_now
    from app.core.security import encrypt_secret
    from app.api.repositories import simulate_repository_event

    u_id = uuid.uuid4().hex[:6]
    repo_name = f"sim-checkout-{u_id}"
    full_name = f"sim-org/{repo_name}"

    async with async_session_factory() as session:
        repo = RepositoryConfigModel(
            name=repo_name,
            full_name=full_name,
            clone_url=f"https://github.com/{full_name}",
            default_branch="main",
            encrypted_token=encrypt_secret("ghp_testtoken9999"),
            auth_provider="github",
            status="CONNECTED",
            created_at=get_utc_now(),
            updated_at=get_utc_now()
        )
        session.add(repo)
        await session.commit()
        await session.refresh(repo)
        repo_id = repo.id

    async with async_session_factory() as session:
        res = await simulate_repository_event(repo_id=repo_id, event_type="pull_request.opened", db=session)
        assert res["ok"] is True
        assert res["result"]["session_key"] == f"github:{full_name}:pr:99"
        assert res["result"]["persona"] == "CodeReviewer"




