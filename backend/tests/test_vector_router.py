import pytest
from pathlib import Path
from app.agent.handlers import intent_registry
from app.agent.handlers.base import IntentContext
from app.agent.handlers.vector_router import SemanticVectorRouter
from app.agent.handlers.intelligence_handlers import WebIntelligenceHandler, AuthGuidanceHandler
from app.agent.handlers.repo_handlers import RepoConnectionHandler, RepoAnalysisHandler, URLSummarizeHandler
from app.agent.handlers.dev_handlers import (
    CasualGreetingHandler,
    IdentityHandler,
    WorkspaceListingHandler,
    TestRunnerHandler,
    CodeReviewHandler,
    CommitVerificationHandler,
    TechnicalExampleHandler,
    FileInspectorHandler,
    CodingActionHandler
)


def make_ctx(prompt: str, extra: dict = None, persona_name: str = "PairProgrammer") -> IntentContext:
    async def mock_thought(t): pass
    async def mock_msg(s, m): pass
    async def mock_tool_start(n, a): pass
    async def mock_tool_end(*args, **kwargs): pass

    return IntentContext(
        task_id="test-task-1",
        title=prompt,
        prompt=prompt,
        lower_prompt=prompt.lower().strip(),
        persona_name=persona_name,
        workspace_path=Path("/tmp"),
        emit_thought=mock_thought,
        emit_message=mock_msg,
        call_tool_start=mock_tool_start,
        call_tool_end=mock_tool_end,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None,
        extra=extra or {}
    )


def test_vector_router_semantic_ranking():
    router = intent_registry._vector_router
    assert router._is_indexed

    # Unseen M&A / news query
    ranked_news = router.rank("Explain this Nvidia agrees to acquire Hugging Face for $13B")
    best_handler, score = ranked_news[0]
    assert isinstance(best_handler, WebIntelligenceHandler)
    assert score > 0.20

    # Another unseen entity acquisition
    ranked_stripe = router.rank("Explain this Stripe buys Bridge for $1.1B")
    best_handler, score = ranked_stripe[0]
    assert isinstance(best_handler, WebIntelligenceHandler)
    assert score > 0.20

    # Architecture analysis query
    ranked_arch = router.rank("Audit the monorepo subprojects and code topology")
    best_handler, score = ranked_arch[0]
    assert isinstance(best_handler, RepoAnalysisHandler)
    assert score > 0.20

    # Test execution query
    ranked_test = router.rank("Run the automated unit test suite with pytest")
    best_handler, score = ranked_test[0]
    assert isinstance(best_handler, TestRunnerHandler)
    assert score > 0.20

    # Token guidance query
    ranked_token = router.rank("Where do I find my personal access token to authenticate?")
    best_handler, score = ranked_token[0]
    assert isinstance(best_handler, AuthGuidanceHandler)
    assert score > 0.20


@pytest.mark.asyncio
async def test_intent_registry_dispatch_web_intelligence():
    messages = []
    thoughts = []

    async def mock_msg(sender, content):
        messages.append((sender, content))

    async def mock_thought(t):
        thoughts.append(t)

    async def mock_tool_start(n, a): pass
    async def mock_tool_end(*args, **kwargs): pass

    ctx = IntentContext(
        task_id="task-news-m-and-a",
        title="Explain this Nvidia agrees to acquire Hugging Face for $13B",
        prompt="Explain this Nvidia agrees to acquire Hugging Face for $13B",
        lower_prompt="explain this nvidia agrees to acquire hugging face for $13b",
        persona_name="PairProgrammer",
        workspace_path=Path("/tmp"),
        emit_thought=mock_thought,
        emit_message=mock_msg,
        call_tool_start=mock_tool_start,
        call_tool_end=mock_tool_end,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    res = await intent_registry.dispatch(ctx)
    assert res["status"] == "COMPLETED"
    assert len(messages) >= 1
    content = messages[0][1]
    assert "Nvidia" in content or "developer feeds" in content or "discussions" in content


@pytest.mark.asyncio
async def test_strict_credentials_override_takes_precedence():
    ctx = make_ctx(
        "Check this repo https://github.com/private/repo",
        extra={"github_token": "ghp_mockSecretTokenForTesting1234567890"}
    )
    # Strict matching should route to RepoConnectionHandler because of credentials
    routed = intent_registry._vector_router.route(ctx)
    assert isinstance(routed[0], RepoConnectionHandler)


def test_vector_router_technical_example_ranking():
    router = intent_registry._vector_router

    ranked_agent = router.rank("Show a Comprehensive example of a Real-Time Distributed Multi-Agent Coordination")
    best_handler, score = ranked_agent[0]
    assert isinstance(best_handler, TechnicalExampleHandler)
    assert score > 0.20

    ranked_pubsub = router.rank("Provide a code example for Phoenix PubSub with GenServer")
    best_handler, score = ranked_pubsub[0]
    assert isinstance(best_handler, TechnicalExampleHandler)
    assert score > 0.20


@pytest.mark.asyncio
async def test_intent_registry_dispatch_technical_example(tmp_path):
    messages = []
    thoughts = []

    async def mock_msg(sender, content):
        messages.append((sender, content))

    async def mock_thought(t):
        thoughts.append(t)

    async def mock_tool_start(n, a): pass
    async def mock_tool_end(*args, **kwargs): pass

    ctx = IntentContext(
        task_id="task-multi-agent-example",
        title="Show a Comprehensive example of a Real-Time Distributed Multi-Agent Coordination",
        prompt="Show a Comprehensive example of a Real-Time Distributed Multi-Agent Coordination",
        lower_prompt="show a comprehensive example of a real-time distributed multi-agent coordination",
        persona_name="PairProgrammer",
        workspace_path=tmp_path,
        emit_thought=mock_thought,
        emit_message=mock_msg,
        call_tool_start=mock_tool_start,
        call_tool_end=mock_tool_end,
        on_approval_required=lambda a, d: None,
        on_diff_updated=lambda d: None
    )

    res = await intent_registry.dispatch(ctx)
    assert res["status"] == "COMPLETED"
    assert len(messages) >= 1
    content = messages[0][1]
    # Verify rich architecture & code contents are present and no hollow stubs
    assert "Phoenix.PubSub" in content or "Sagents" in content or "DynamicSupervisor" in content
    assert "Standing by for next instruction" not in content
    assert "Workspace inspected and validated" not in content


@pytest.mark.asyncio
async def test_find_all_services_routes_to_coding_action(tmp_path):
    cargo_dir = tmp_path / "src" / "my_service" / "src"
    cargo_dir.mkdir(parents=True)
    (cargo_dir / "main.rs").write_text("fn main() {}")

    messages = []
    async def mock_msg(s, c):
        messages.append((s, c))

    ctx = make_ctx("Find all services in the codebase")
    ctx.workspace_path = tmp_path
    ctx.emit_message = mock_msg

    res = await intent_registry.dispatch(ctx)
    assert res["status"] == "COMPLETED"
    assert len(messages) >= 1
    content = messages[0][1]
    assert "my_service" in content
    assert any(w in content for w in ("Discovered Services", "Component", "Service", "Architectural Classification"))


@pytest.mark.asyncio
async def test_what_is_a_service_does_not_trigger_test_runner(tmp_path):
    cargo_dir = tmp_path / "src" / "my_service" / "src"
    cargo_dir.mkdir(parents=True)
    (cargo_dir / "main.rs").write_text("fn main() {}")

    messages = []
    async def mock_msg(s, c):
        messages.append((s, c))

    ctx = make_ctx("What is a service in this project")
    ctx.workspace_path = tmp_path
    ctx.emit_message = mock_msg

    res = await intent_registry.dispatch(ctx)
    assert res["status"] == "COMPLETED"
    assert len(messages) >= 1
    content = messages[0][1]
    assert "Test Execution Results" not in content
    assert "cargo test" not in content
    assert "my_service" in content


@pytest.mark.asyncio
async def test_what_is_a_service_firecracker_conceptual_explanation(tmp_path):
    # Simulate Firecracker workspace layout with real documentation and code snippets
    (tmp_path / "README.md").write_text(
        "Firecracker is an open-source Virtual Machine Monitor (VMM) purpose-built for creating and managing secure, multi-tenant container and function-based services.\n\n"
        "Firecracker provides a REST API server listening on a UNIX domain socket. Guest communication is handled via virtio-vsock."
    )

    fc_dir = tmp_path / "src" / "firecracker" / "src"
    fc_dir.mkdir(parents=True)
    (fc_dir / "main.rs").write_text("use std::os::unix::net::UnixListener;\nfn main() { let _ = UnixListener::bind(\"/tmp/firecracker.socket\"); }")

    jailer_dir = tmp_path / "src" / "jailer" / "src"
    jailer_dir.mkdir(parents=True)
    (jailer_dir / "main.rs").write_text("fn main() {\n    // chroot, seccomp, and cgroup isolation\n}")

    # Add overlay test fixture that should never be labeled as a service
    overlay_dir = tmp_path / "resources" / "rootfs" / "overlay" / "usr" / "local" / "bin"
    overlay_dir.mkdir(parents=True)
    (overlay_dir / "main.go").write_text("package main\nfunc main() {}")

    messages = []
    async def mock_msg(s, c):
        messages.append((s, c))

    ctx = make_ctx("What is a service in this project")
    ctx.workspace_path = tmp_path
    ctx.emit_message = mock_msg

    res = await intent_registry.dispatch(ctx)
    assert res["status"] == "COMPLETED"
    assert len(messages) >= 1
    content = messages[0][1]

    # Must provide conceptual architectural prose explaining Firecracker's process model
    lower_content = content.lower()
    assert "virtual machine monitor" in lower_content or "vmm" in lower_content
    assert "unix" in lower_content and "socket" in lower_content
    assert "jailer" in lower_content
    assert "firecracker" in lower_content
    assert "vsock" in lower_content

    # Must not contain false positives from test overlays
    assert "resources/rootfs" not in content
    assert "Go Service Binary" not in content
