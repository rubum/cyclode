import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.integrations.linear_client import linear_client
from app.integrations.manager import integration_manager
from app.integrations.registry import IntegrationRegistry


@pytest.mark.asyncio
async def test_linear_client_get_issue_mock():
    issue = await linear_client.get_issue("PD-1236")
    assert issue is not None
    assert issue["identifier"] == "PD-1236"
    assert "state" in issue
    assert "team" in issue
    assert "comments" in issue
    assert len(issue["comments"]["nodes"]) > 0


@pytest.mark.asyncio
async def test_linear_client_update_status_and_comment():
    status_res = await linear_client.update_issue_status("PD-1236", "st-done")
    assert status_res.get("success") is True

    comment_res = await linear_client.post_comment("PD-1236", "Automated test comment from Cyclode")
    assert comment_res.get("success") is True
    assert "comment" in comment_res
    assert comment_res["comment"]["body"] == "Automated test comment from Cyclode"


@pytest.mark.asyncio
async def test_linear_api_endpoints():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Get Issue
        resp = await client.get("/api/linear/issues/PD-1236")
        assert resp.status_code == 200
        data = resp.json()
        assert data["identifier"] == "PD-1236"
        assert "Refactor Comment Parser" in data["title"]

        # Update Status
        status_resp = await client.post(
            "/api/linear/issues/PD-1236/status",
            json={"state_id": "st-in-review"}
        )
        assert status_resp.status_code == 200
        assert status_resp.json().get("success") is True

        # Post Comment
        comment_resp = await client.post(
            "/api/linear/issues/PD-1236/comment",
            json={"body": "Testing Linear comment API endpoint"}
        )
        assert comment_resp.status_code == 200
        assert comment_resp.json().get("success") is True

        # Search Issues
        search_resp = await client.get("/api/linear/search?q=PD-1236")
        assert search_resp.status_code == 200
        assert len(search_resp.json().get("results", [])) > 0


@pytest.mark.asyncio
async def test_linear_registry_and_vault():
    status_list = IntegrationRegistry.get_status()
    linear_entry = next((item for item in status_list if item["id"] == "linear"), None)
    assert linear_entry is not None
    assert linear_entry["name"] == "Linear Issue Tracking"
    assert "linear.get_issue" in linear_entry["skills"]

    # Validate empty token handling
    val_empty = await integration_manager.validate_credentials("linear", {"token": ""})
    assert val_empty["valid"] is False


@pytest.mark.asyncio
async def test_reader_linear_url_interception():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/reader?url=https://linear.app/cyclode/issue/PD-1236/refactor-comments")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("type") == "linear"
        assert data.get("is_linear") is True
        assert "PD-1236" in data.get("title", "")
        assert "Discussion & Comments" in data.get("content_markdown", "")
