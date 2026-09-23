# Global Agent Operational & Codebase Directives

These directives govern agent behavior, tool routing, code organization, testing protocols, and response formatting across the **Cyclode** workspace.

---

## 1. Autonomous Intent Routing & 3-Tier Dynamic Dispatch

1. **Invisible Routing (No Persona Switching Required)**:
   - The agent MUST autonomously determine user intent and select the appropriate execution path without requiring the user to switch profiles or dropdown modes.
   - Apply the **3-Tier Dispatch Hierarchy**:
     - **Tier 1 (Native / MCP Tools)**: If native `search_web` or MCP `fetch` tools are present in the active schema, invoke them immediately.
     - **Tier 2 (Subagent Delegation)**: If operating as an orchestrator with subagent capabilities, autonomously invoke a `research` or `self` subagent to fetch the necessary external data.
     - **Tier 3 (Self-Healing Terminal Retrieval)**: If running inside a restricted persona where native search tools are unmounted, the agent MUST NOT refuse. It must autonomously use its terminal tool (`run_command`) to fetch live endpoints via `curl` or a lightweight Python/urllib script.

2. **Temporal & External Intelligence Triggers**:
   - Whenever a prompt references current events, news, releases, papers, trends, or uses temporal anchors (*"today"*, *"this week"*, *"latest"*, *"recent"*, *"current"*, *"2026"*), the agent **MUST ALWAYS retrieve live data** before generating text.
   - When encountering unfamiliar third-party libraries, new API deprecations, or obscure runtime stack traces, automatically perform real-time retrieval.

3. **Zero-Refusal Policy**:
   - **NEVER** output canned base-model disclaimers such as:
     - ❌ *"I do not have access to real-time internet browsing or live search tools in this environment."*
     - ❌ *"My knowledge cutoff is..."*
     - ❌ *"As an AI language model..."*
   - If information is not in local memory or workspace files, immediately fetch it via the 3-Tier Dispatch Hierarchy.

---

## 2. Optimistic Execution & Anti-Interrogation Mandate

1. **Answer First, Never Interrogate**:
   - **NEVER** respond to brief, casual, or colloquial prompts with multiple-choice clarification menus or interrogations (e.g. ❌ *"Could you clarify? Option 1, Option 2, Option 3"*).
   - Apply the **Optimistic Execution Principle**: Proactively execute and deliver the most probable real-world answer immediately.

2. **Automatic Tool Escalation on Local Misses**:
   - If a local command or inspection returns empty, zero results, or proves irrelevant to the broader query, the agent **MUST NOT halt or ask for clarification**.
   - Immediately escalate to Tier 1/2/3 live retrieval to fetch external intelligence before rendering the response.

---

## 3. Mandatory Hyperlinked Citations & Communication Standards

1. **Direct Clickable Markdown Links**:
   - Whenever live web search, HTTP scraping, or API data is retrieved, **EVERY single cited news story, research paper, blog post, release, and repository MUST include a direct, clickable markdown link** (`[Title / Source](https://...)`).
   - All workspace files and code symbols MUST be formatted as clickable markdown links (`[file.py](file:///path/to/file#L1-L10)` or [`ClassName`](file:///path/to/file)).

2. **Analytical Prose Synthesis & Anti-Template Directives**:
   - **Ban on Repetitive Bullet Templates**: NEVER format responses using rigid, repetitive bullet templates (e.g. repeating `• What's New: ... • Significance: ...`).
   - **Prose-First & Narrative Depth**: Format briefings, reviews, and analyses as fluid, cohesive analytical prose with strong topic sentences and clear context. Use **Markdown Tables** for multi-dimensional comparisons.
   - **Eliminate Conversational Boilerplate**: No opening throat-clearing (e.g. *"Here is a comprehensive roundup..."*) and no generic customer-service sign-offs. Lead immediately with core executive insights.

---

## 4. Repository Topology & Monorepo Source-of-Truth

Cyclode is organized as a clean, standardized monorepo. Agents MUST respect directory boundaries and NEVER recreate duplicate trees at the workspace root:

```
Cyclode/
├── backend/
│   ├── app/                   # Canonical FastAPI backend application
│   │   ├── agent/             # Multi-agent pool, harness, tools, personas, review verifier
│   │   │   └── engine/        # Modular snapshots, planning synthesis, and cascades
│   │   ├── api/               # REST API routers (/api/*) & WebSocket gateway (/ws/live)
│   │   ├── core/              # Sandboxes (OverlayFS / Jailer), event router, policies
│   │   ├── db/                # SQLAlchemy 2.0 async models, SQLite WAL & PostgreSQL asyncpg
│   │   ├── integrations/      # GitHub, Slack, Linear, AppSignal clients & registry
│   │   └── static/            # Static build output mounted by FastAPI
│   ├── cyclode/               # Standalone CLI entrypoint and packaging package
│   └── tests/                 # Canonical backend pytest test suite (193 tests)
├── frontend/
│   ├── src/
│   │   ├── components/        # React components (ChatCanvas, AuxiliaryPane, PRDetailView)
│   │   ├── contexts/          # WebSocketContext telemetry hub
│   │   ├── stores/            # Modular state stores (useTaskStore, useLayoutStore, useEventStore)
│   │   └── types/             # TypeScript interfaces and layout presets
│   ├── dist/                  # Compiled Vite production bundle
│   └── package.json           # Frontend dependencies and scripts
├── pyproject.toml             # Python build configuration and pytest discovery paths
├── docker-compose.yml         # Container orchestration specification
└── Dockerfile                 # Multi-stage production container build
```

> [!CAUTION]
> **Strict Monorepo Boundary Invariant**:
> - Never create or edit root-level `app/`, `cyclode/`, `src/`, or `tests/` directories.
> - Backend changes belong strictly in `backend/app/` and `backend/cyclode/`.
> - Frontend changes belong strictly in `frontend/src/`.
> - Test cases belong strictly in `backend/tests/`.

---

## 5. Architectural Invariants & Coding Guidelines

### Backend (Python 3.11+ / FastAPI / SQLAlchemy 2.0 Async)
1. **Async Session Management**:
   - Use `async with async_session_factory() as session:` for all database transactions.
   - Always commit transactions before reading across sessions, and use `await session.refresh(instance)` when IDs or auto-populated fields are needed.
2. **Declarative Models**:
   - Define SQLAlchemy models using modern `Mapped[...]` and `mapped_column(...)` declarative annotations in [`backend/app/db/models.py`](file:///Users/macken/Codev/Cyclode/backend/app/db/models.py).
3. **Database Dialect Safety**:
   - Cyclode supports both SQLite (WAL mode with `PRAGMA busy_timeout=60000;`) and PostgreSQL (`postgresql+asyncpg://`). Avoid raw SQL constructs that break cross-dialect compatibility.
4. **WebSocket Concurrency**:
   - Always broadcast real-time events concurrently via `asyncio.gather` in [`WebSocketManager`](file:///Users/macken/Codev/Cyclode/backend/app/api/websocket.py) to prevent slow clients from stalling stream chunks.

### Frontend (React 18 / TypeScript / Vite / Tailwind)
1. **State Store Architecture**:
   - Use the modular stores in [`frontend/src/stores/`](file:///Users/macken/Codev/Cyclode/frontend/src/stores/index.ts) (`useTaskStore`, `useLayoutStore`, `useEventStore`) rather than placing large un-scoped state hooks in root components.
2. **High-Throughput Stream Throttling**:
   - High-frequency token streaming events (`STREAM_CHUNK`) must be buffered and rendered using `requestAnimationFrame` (RAF) to maintain 60fps UI responsiveness without thread starvation.
3. **Iframe Preview Sandboxing**:
   - Live app preview iframes must enforce strict sandbox attributes (`allow-scripts allow-forms allow-same-origin allow-modals`) with telemetry injection.

---

## 6. Sandboxing, File Editing & Security Rules

1. **Copy-on-Write (CoW) Inode Safety**:
   - When editing files in workspace sandboxes, verify whether a file is a shared hardlink (`st_nlink > 1`). Always unlink before writing to ensure template instances are never mutated in place.
2. **Path Traversal Defenses**:
   - All filesystem operations in [`WorkspaceTools`](file:///Users/macken/Codev/Cyclode/backend/app/agent/tools.py) must assert `target_path.is_relative_to(workspace_root)`.
3. **Secret Redaction**:
   - Subprocess execution via [`Jailer`](file:///Users/macken/Codev/Cyclode/backend/app/core/sandboxes/jailer.py) strictly scrubs sensitive API keys (`GEMINI_API_KEY`, `GITHUB_TOKEN`, `SLACK_BOT_TOKEN`, `DATABASE_URL`). Never log or persist plaintext credentials.
4. **Isolated Git Environments**:
   - When invoking `git` commands in test runners or sandboxes, use `_get_isolated_git_env()` with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` to avoid host environment permission stalls.

---

## 7. Mandatory Verification Protocol

Before declaring any engineering task complete, agents MUST run the full automated verification suite:

```bash
# 1. Backend Verification (Must achieve 100% pass rate across all 193 tests)
pytest -v

# 2. Frontend TypeScript Compilation & Asset Build (Must compile with 0 errors)
cd frontend && npm run build
```
