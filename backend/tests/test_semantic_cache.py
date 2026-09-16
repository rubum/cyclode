import pytest
import math
import json
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
import httpx

from app.db.models import Base, SemanticCacheModel
from app.agent.semantic_cache import (
    normalize_query,
    compute_fallback_embedding,
    cosine_similarity,
    generate_query_embedding,
    lookup_semantic_cache,
    store_semantic_cache
)
from app.agent.harness import AntigravityHarness


def test_cosine_similarity_computation():
    v1 = [1.0, 0.0, 0.0]
    v2 = [1.0, 0.0, 0.0]
    assert math.isclose(cosine_similarity(v1, v2), 1.0)

    v3 = [0.0, 1.0, 0.0]
    assert math.isclose(cosine_similarity(v1, v3), 0.0)

    v4 = [-1.0, 0.0, 0.0]
    assert math.isclose(cosine_similarity(v1, v4), -1.0)

    assert cosine_similarity([], []) == 0.0
    assert cosine_similarity([0.0, 0.0], [0.0, 0.0]) == 0.0


def test_normalize_query():
    assert normalize_query("  What is Redis LangCache?!  ") == "what is redis langcache"
    assert normalize_query("Explain   Grafana    Alert Rules...") == "explain grafana alert rules"


def test_compute_fallback_embedding():
    vec = compute_fallback_embedding("What is Redis LangCache", dim=128)
    assert len(vec) == 128
    mag = math.sqrt(sum(x * x for x in vec))
    assert math.isclose(mag, 1.0, rel_tol=1e-5)

    vec_similar = compute_fallback_embedding("What is Redis LangCache caching architecture", dim=128)
    sim = cosine_similarity(vec, vec_similar)
    assert sim > 0.70

    vec_unrelated = compute_fallback_embedding("Deploy Kubernetes ingress nginx on GCP", dim=128)
    sim_unrelated = cosine_similarity(vec, vec_unrelated)
    assert sim_unrelated < 0.40


@pytest.mark.asyncio
async def test_generate_query_embedding_mocked(monkeypatch):
    class MockEmbeddingResponse:
        status_code = 200
        def json(self):
            return {
                "embedding": {
                    "values": [0.6, 0.8, 0.0]
                }
            }

    async def mock_post(self, url, **kwargs):
        return MockEmbeddingResponse()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    async with httpx.AsyncClient() as client:
        emb = await generate_query_embedding("Test Query", api_key="AIzaSyTest", client=client)

    assert len(emb) == 3
    mag = math.sqrt(sum(x * x for x in emb))
    assert math.isclose(mag, 1.0, rel_tol=1e-5)


@pytest.mark.asyncio
async def test_semantic_cache_exact_and_vector_lookup(tmp_path):
    test_db_path = tmp_path / "test_semantic.db"
    db_url = f"sqlite+aiosqlite:///{test_db_path}"
    test_engine = create_async_engine(db_url)
    async_session = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        # 1. Store a response in semantic cache
        plan = {
            "intent_category": "qa_research",
            "objective": "Explain Redis LangCache architecture",
            "steps": [
                {"id": "step-1", "title": "Analyze Redis LangCache cache-aside semantics", "status": "completed"},
                {"id": "step-2", "title": "Evaluate latency benchmarks", "status": "completed"},
                {"id": "step-3", "title": "Synthesize architectural guide", "status": "completed"}
            ]
        }
        resp_text = "Redis LangCache is an intelligent semantic caching layer for LLMs that matches queries using vector embeddings."
        
        entry = await store_semantic_cache(
            db=session,
            query="What is Redis LangCache",
            plan=plan,
            response_text=resp_text,
            intent="qa_research",
            threshold=0.85
        )
        assert entry is not None
        assert entry.query_norm == "what is redis langcache"

        # 2. Exact match lookup
        exact_hit = await lookup_semantic_cache(
            db=session,
            query="  What is Redis LangCache?  ",
            intent="qa_research",
            threshold=0.85
        )
        assert exact_hit is not None
        cached_obj, score = exact_hit
        assert cached_obj.response_text == resp_text
        assert score == 1.0

        # 3. Vector similarity lookup on paraphrased query
        vector_hit = await lookup_semantic_cache(
            db=session,
            query="What is Redis LangCache architecture and caching layer",
            intent="qa_research",
            threshold=0.70
        )
        assert vector_hit is not None
        v_cached, v_score = vector_hit
        assert v_cached.response_text == resp_text
        assert v_score >= 0.70

        # 4. Cache miss on dissimilar query
        miss = await lookup_semantic_cache(
            db=session,
            query="How to configure Vite with Tailwind CSS in React",
            intent="qa_research",
            threshold=0.85
        )
        assert miss is None

        # 5. Intent safety isolation (app_building skips cache)
        app_miss = await lookup_semantic_cache(
            db=session,
            query="What is Redis LangCache",
            intent="app_building",
            threshold=0.85
        )
        assert app_miss is None


@pytest.mark.asyncio
async def test_execute_task_semantic_cache_hit_zero_tokens(monkeypatch, tmp_path):
    test_db_path = tmp_path / "test_exec_cache.db"
    db_url = f"sqlite+aiosqlite:///{test_db_path}"
    test_engine = create_async_engine(db_url)
    async_session = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Monkeypatch async_session_factory in session & harness
    import app.db.session
    monkeypatch.setattr(app.db.session, "async_session_factory", async_session)

    # Seed the semantic cache
    async with async_session() as session:
        await store_semantic_cache(
            db=session,
            query="Explain grafana alert rules",
            plan={
                "intent_category": "qa_research",
                "objective": "Explain grafana alert rules",
                "steps": [
                    {"id": "step-1", "title": "Explain Grafana query architecture", "status": "completed"},
                    {"id": "step-2", "title": "Explain alert conditions and evaluation intervals", "status": "completed"},
                    {"id": "step-3", "title": "Synthesize contact points", "status": "completed"}
                ]
            },
            response_text="### Grafana Alert Rules Architecture\n\nGrafana alert rules query time-series databases to evaluate thresholds across evaluation intervals.",
            intent="qa_research",
            threshold=0.85
        )

    harness = AntigravityHarness()
    emitted_plans = []
    emitted_messages = []
    emitted_thoughts = []

    async def mock_on_plan(p):
        emitted_plans.append(p)

    async def mock_on_message(sender, content, plan=None):
        emitted_messages.append({"sender": sender, "content": content, "plan": plan})

    async def mock_on_thought(t):
        emitted_thoughts.append(t)

    async def noop(*args, **kwargs):
        pass

    # Ensure no external HTTP requests are made during cache hit
    async def forbidden_post(self, url, **kwargs):
        pytest.fail(f"HTTP call should not be triggered during a semantic cache hit! URL: {url}")

    monkeypatch.setattr(httpx.AsyncClient, "post", forbidden_post)

    result = await harness.execute_task(
        task_id="task-cache-hit-test",
        workspace_path=tmp_path,
        title="Explain grafana alert rules",
        description="Explain grafana alert rules",
        persona_name="PairProgrammer",
        on_thought=mock_on_thought,
        on_tool_start=noop,
        on_tool_end=noop,
        on_message=mock_on_message,
        on_approval_required=noop,
        on_diff_updated=noop,
        on_plan=mock_on_plan
    )

    assert result["status"] == "COMPLETED"
    assert result.get("cached") is True
    assert len(emitted_plans) >= 1
    final_plan = emitted_plans[-1]
    assert final_plan["evaluation"]["status"] == "accomplished"
    assert all(s["status"] == "completed" for s in final_plan["steps"])
    assert any("Semantic Vector Cache" in c["name"] for c in final_plan["evaluation"]["checks"])
    assert any("Grafana Alert Rules Architecture" in m["content"] for m in emitted_messages)
    assert any("Semantic Vector Cache Hit" in t for t in emitted_thoughts)
