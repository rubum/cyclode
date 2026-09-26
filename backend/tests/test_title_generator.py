import pytest
from app.agent.title_generator import generate_heuristic_title


def test_generate_heuristic_title_github_url():
    prompt = "Analyse https://github.com/open-telemetry/opentelemetry-python and explain the tracing architecture"
    title = generate_heuristic_title(prompt)
    assert "opentelemetry-python" in title
    assert "http" not in title
    assert len(title) <= 55


def test_generate_heuristic_title_raw_repo_url():
    prompt = "https://github.com/facebook/react.git"
    title = generate_heuristic_title(prompt)
    assert "react" in title.lower()
    assert "http" not in title


def test_generate_heuristic_title_filler_removal():
    prompt = "Please can you help me to fix null pointer exception in user service"
    title = generate_heuristic_title(prompt)
    assert not title.lower().startswith("please")
    assert not title.lower().startswith("can you")
    assert "Fix" in title or "fix" in title
    assert "Null" in title or "null" in title


def test_generate_heuristic_title_empty():
    title = generate_heuristic_title("", "my-repo")
    assert "my-repo" in title

    title_none = generate_heuristic_title("")
    assert title_none == "New Session"


def test_generate_heuristic_title_short_prompt_retention():
    prompt = "Build a simple Flutter app for ecommerce"
    title = generate_heuristic_title(prompt)
    assert title == "Build a simple Flutter app for ecommerce"
    assert not title.endswith("for")


def test_generate_heuristic_title_trailing_preposition_stripping():
    prompt = "Design modern landing page with animations and full One Dark Pro theme tokens for"
    title = generate_heuristic_title(prompt)
    assert not title.endswith("for")
    assert not title.endswith("and")
    assert not title.endswith("with")


@pytest.mark.asyncio
async def test_generate_ai_title_mocked():
    from unittest.mock import MagicMock, patch
    from app.agent.title_generator import generate_ai_title

    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json.return_value = {
        "candidates": [
            {
                "content": {
                    "parts": [{"text": '"OpenTelemetry Tracing Pipeline"'}]
                }
            }
        ]
    }

    with patch("httpx.AsyncClient.post", return_value=fake_response):
        title = await generate_ai_title(
            prompt="Analyse opentelemetry tracing and explain",
            repo_name="opentelemetry-python",
            api_key="fake-key-123"
        )
        assert title == "OpenTelemetry Tracing Pipeline"


@pytest.mark.asyncio
async def test_update_task_title_api():
    from httpx import AsyncClient, ASGITransport
    from app.main import app
    from app.agent.pool import agent_pool

    # Spawn a temporary task
    task_id = await agent_pool.spawn_task(
        title="Initial Title",
        description="Analyse https://github.com/org/repo-demo and fix bugs",
        persona="SoftwareEngineer"
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Check task details has custom_title=False initially
        res = await ac.get(f"/api/tasks/{task_id}")
        assert res.status_code == 200
        data = res.json()
        assert data["custom_title"] is False

        # Update title
        patch_res = await ac.patch(f"/api/tasks/{task_id}/title", json={"title": "Custom Renamed Title"})
        assert patch_res.status_code == 200
        patch_data = patch_res.json()
        assert patch_data["title"] == "Custom Renamed Title"
        assert patch_data["custom_title"] is True

        # Check updated task details
        updated_res = await ac.get(f"/api/tasks/{task_id}")
        assert updated_res.status_code == 200
        updated_data = updated_res.json()
        assert updated_data["title"] == "Custom Renamed Title"
        assert updated_data["custom_title"] is True

        # Test empty title validation
        bad_res = await ac.patch(f"/api/tasks/{task_id}/title", json={"title": "   "})
        assert bad_res.status_code == 400

        # Test 404 for nonexistent task
        nf_res = await ac.patch("/api/tasks/nonexistent-id-123/title", json={"title": "Test"})
        assert nf_res.status_code == 404
