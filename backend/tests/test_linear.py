import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.integrations.linear_client import linear_client
from app.integrations.manager import integration_manager
from app.integrations.registry import IntegrationRegistry


@pytest.mark.asyncio
async def test_linear_client_unconfigured_behavior():
    linear_client.token = None
    assert linear_client.is_configured() is False
    issue = await linear_client.get_issue("PD-1236")
    assert issue is None

    status_res = await linear_client.update_issue_status("PD-1236", "st-done")
    assert status_res.get("success") is False

    comment_res = await linear_client.post_comment("PD-1236", "Test")
    assert comment_res.get("success") is False


@pytest.mark.asyncio
async def test_linear_client_graphql_fetch_and_mutations():
    linear_client.token = "lin_api_test123"

    mock_issue_data = {
        "id": "iss_123",
        "identifier": "PD-1236",
        "title": "Real Linear Ticket Title",
        "description": "Real description from workspace",
        "priority": 1,
        "priorityLabel": "Urgent",
        "url": "https://linear.app/cyclode/issue/PD-1236",
        "state": {"id": "st-todo", "name": "Todo", "color": "#e2e2e2"},
        "comments": {"nodes": []}
    }

    with patch("httpx.AsyncClient.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": {"issue": mock_issue_data}}
        mock_post.return_value = mock_resp

        issue = await linear_client.get_issue("PD-1236")
        assert issue is not None
        assert issue["identifier"] == "PD-1236"
        assert issue["title"] == "Real Linear Ticket Title"


@pytest.mark.asyncio
async def test_linear_api_unconfigured_error():
    linear_client.token = None
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/linear/issues/PD-1236")
        assert resp.status_code == 400
        assert "not configured" in resp.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_linear_registry_and_vault():
    status_list = IntegrationRegistry.get_status()
    linear_entry = next((item for item in status_list if item["id"] == "linear"), None)
    assert linear_entry is not None
    assert linear_entry["name"] == "Linear Issue Tracking"
    assert "linear.get_issue" in linear_entry["skills"]

    val_empty = await integration_manager.validate_credentials("linear", {"token": ""})
    assert val_empty["valid"] is False


@pytest.mark.asyncio
async def test_reader_linear_url_interception():
    linear_client.token = None
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/reader?url=https://linear.app/cyclode/issue/PD-1236/some-slug")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("type") == "linear"
        assert data.get("is_linear") is True
        assert "PD-1236" in data.get("title", "")
        assert "Unable to retrieve ticket `PD-1236`" in data.get("content_markdown", "")


@pytest.mark.asyncio
async def test_workspace_tools_linear_methods():
    from app.agent.tools import WorkspaceTools

    # 1. Unconfigured
    linear_client.token = None
    with patch.object(integration_manager, "get_custom_credential", return_value=None), \
         patch.object(linear_client, "is_configured", return_value=False):
        err_res = await WorkspaceTools.get_linear_issue("PD-1198")
        assert "error" in err_res
        assert "PD-1198" in err_res["error"]

        search_res = await WorkspaceTools.search_linear_issues("auth")
        assert search_res.get("issues") == []
        assert search_res.get("total_found") == 0

        comment_res = await WorkspaceTools.post_linear_comment("PD-1198", "Fixing bug")
        assert comment_res.get("success") is False

        status_res = await WorkspaceTools.update_linear_issue_status("PD-1198", "Done")
        assert status_res.get("success") is False

    # 2. Configured with mocked responses
    mock_ticket = {
        "id": "iss_pd1198",
        "identifier": "PD-1198",
        "title": "Fix tenant SSO origin allowlist",
        "description": "Fix local_docker_provisioner?/0 branching",
        "state": {"id": "st_in_progress", "name": "In Progress"}
    }

    with patch.object(integration_manager, "get_custom_credential", return_value="lin_vault_key"), \
         patch("app.integrations.linear_client.linear_client.get_issue", return_value=mock_ticket), \
         patch("app.integrations.linear_client.linear_client.search_issues", return_value=[mock_ticket]), \
         patch("app.integrations.linear_client.linear_client.post_comment", return_value={"success": True, "comment": {"id": "cmt_1"}}), \
         patch("app.integrations.linear_client.linear_client.update_issue_status", return_value={"success": True, "issue": {"id": "iss_pd1198", "state": {"name": "In Review"}}}):

        issue = await WorkspaceTools.get_linear_issue("PD-1198")
        assert issue["identifier"] == "PD-1198"
        assert issue["title"] == "Fix tenant SSO origin allowlist"

        search = await WorkspaceTools.search_linear_issues("SSO")
        assert search.get("total_found") == 1
        assert len(search.get("issues", [])) == 1
        assert search["issues"][0]["identifier"] == "PD-1198"

        comment = await WorkspaceTools.post_linear_comment("PD-1198", "PR opened at #42")
        assert comment.get("success") is True

        status = await WorkspaceTools.update_linear_issue_status("PD-1198", "In Review")
        assert status.get("success") is True


@pytest.mark.asyncio
async def test_linear_header_formatting():
    # 1. Personal API key starting with lin_api_
    linear_client.token = "lin_api_test_personal_key"
    headers = linear_client._get_headers()
    assert headers["Authorization"] == "lin_api_test_personal_key"
    assert "Bearer" not in headers["Authorization"]

    # 2. Key starting with Bearer lin_api_ should have Bearer stripped
    linear_client.token = "Bearer lin_api_test_personal_key"
    headers = linear_client._get_headers()
    assert headers["Authorization"] == "lin_api_test_personal_key"

    # 3. Standard OAuth or JWT token
    linear_client.token = "oauth_token_xyz"
    headers = linear_client._get_headers()
    assert headers["Authorization"] == "Bearer oauth_token_xyz"


@pytest.mark.asyncio
async def test_linear_credential_validation_scenarios():
    with patch("httpx.AsyncClient.post") as mock_post:
        # Case 1: HTTP 400 Bad Request (e.g. Bearer used with lin_api key)
        resp_400 = MagicMock()
        resp_400.status_code = 400
        resp_400.json.return_value = {"errors": [{"message": "It looks like you're trying to use an API key as a Bearer token."}]}
        mock_post.return_value = resp_400
        res = await integration_manager.validate_credentials("linear", {"token": "lin_api_bad"})
        assert res["valid"] is False
        assert "400 Bad Request" in res["message"]

        # Case 2: HTTP 401 Unauthorized
        resp_401 = MagicMock()
        resp_401.status_code = 401
        mock_post.return_value = resp_401
        res = await integration_manager.validate_credentials("linear", {"token": "lin_api_expired"})
        assert res["valid"] is False
        assert "401 Unauthorized" in res["message"]

        # Case 3: HTTP 200 with GraphQL error
        resp_err = MagicMock()
        resp_err.status_code = 200
        resp_err.json.return_value = {"errors": [{"message": "Internal GraphQL rejection"}]}
        mock_post.return_value = resp_err
        res = await integration_manager.validate_credentials("linear", {"token": "lin_api_xyz"})
        assert res["valid"] is False
        assert "Linear authentication error" in res["message"]

        # Case 4: HTTP 200 valid viewer
        resp_ok = MagicMock()
        resp_ok.status_code = 200
        resp_ok.json.return_value = {"data": {"viewer": {"id": "usr_1", "name": "Jane Developer", "email": "jane@example.com"}}}
        mock_post.return_value = resp_ok
        res = await integration_manager.validate_credentials("linear", {"token": "lin_api_good"})
        assert res["valid"] is True
        assert "Jane Developer" in res["message"]


@pytest.mark.asyncio
async def test_linear_create_issue_and_list_teams():
    from app.agent.tools import WorkspaceTools

    mock_team = {
        "id": "team_uuid_123",
        "name": "Product Dev",
        "key": "PD",
        "states": {"nodes": [{"id": "state_todo_1", "name": "Todo"}]}
    }
    mock_created = {
        "success": True,
        "issue": {
            "id": "iss_new_1",
            "identifier": "PD-789",
            "title": "New issue test",
            "url": "https://linear.app/issue/PD-789",
            "team": {"id": "team_uuid_123", "key": "PD", "name": "Product Dev"}
        }
    }

    with patch.object(integration_manager, "get_custom_credential", return_value="lin_api_test"), \
         patch("app.integrations.linear_client.linear_client.list_teams", return_value=[mock_team]), \
         patch("app.integrations.linear_client.linear_client.create_issue", return_value=mock_created):

        teams_res = await WorkspaceTools.list_linear_teams()
        assert teams_res["count"] == 1
        assert teams_res["teams"][0]["key"] == "PD"

        created_res = await WorkspaceTools.create_linear_issue(
            title="New issue test",
            team="PD",
            description="Testing creation",
            priority=2,
            state="Todo"
        )
        assert created_res["success"] is True
        assert created_res["issue"]["identifier"] == "PD-789"


