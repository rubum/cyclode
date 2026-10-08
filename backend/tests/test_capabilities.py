import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.integrations.manager import integration_manager
from app.agent.tools import WorkspaceTools


@pytest.mark.asyncio
async def test_capability_manager_toggle_and_batch():
    # Initial state
    assert integration_manager.is_capability_enabled("linear.get_issue") is True

    # Toggle off
    res = integration_manager.toggle_capability("linear.get_issue", enabled=False)
    assert res is False
    assert integration_manager.is_capability_enabled("linear.get_issue") is False
    assert "linear.get_issue" in integration_manager.get_disabled_capabilities()

    # Canonical mapping check (get_linear_issue maps to linear.get_issue)
    assert integration_manager.is_capability_enabled("get_linear_issue") is False

    # Toggle on
    res = integration_manager.toggle_capability("linear.get_issue", enabled=True)
    assert res is True
    assert integration_manager.is_capability_enabled("linear.get_issue") is True
    assert integration_manager.is_capability_enabled("get_linear_issue") is True

    # Batch disable
    tools = ["linear.create_issue", "linear.update_status"]
    integration_manager.set_capabilities_for_service(tools, enabled=False)
    assert integration_manager.is_capability_enabled("linear.create_issue") is False
    assert integration_manager.is_capability_enabled("linear.update_status") is False

    # Batch enable
    integration_manager.set_capabilities_for_service(tools, enabled=True)
    assert integration_manager.is_capability_enabled("linear.create_issue") is True
    assert integration_manager.is_capability_enabled("linear.update_status") is True


@pytest.mark.asyncio
async def test_capability_api_endpoints():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # GET integrations status includes disabled_capabilities
        get_res = await client.get("/api/integrations")
        assert get_res.status_code == 200
        data = get_res.json()
        assert "disabled_capabilities" in data
        assert isinstance(data["disabled_capabilities"], list)

        # Toggle capability off
        toggle_res = await client.post("/api/integrations/capabilities/toggle", json={
            "tool_name": "linear.post_comment",
            "enabled": False
        })
        assert toggle_res.status_code == 200
        toggle_data = toggle_res.json()
        assert toggle_data["ok"] is True
        assert toggle_data["tool_name"] == "linear.post_comment"
        assert toggle_data["enabled"] is False
        assert "linear.post_comment" in toggle_data["disabled_capabilities"]

        # Tool execution guard
        res_tool = await WorkspaceTools.post_linear_comment("TEST-123", "Hello")
        assert "error" in res_tool
        assert "disabled by integration capability policy" in res_tool["error"]

        # Toggle capability back on
        toggle_on_res = await client.post("/api/integrations/capabilities/toggle", json={
            "tool_name": "linear.post_comment",
            "enabled": True
        })
        assert toggle_on_res.status_code == 200
        assert toggle_on_res.json()["enabled"] is True

        # Batch endpoint
        batch_res = await client.post("/api/integrations/capabilities/batch", json={
            "tools": ["linear.list_teams", "linear.create_comment"],
            "enabled": False
        })
        assert batch_res.status_code == 200
        assert "linear.list_teams" in batch_res.json()["disabled_capabilities"]

        # Restore
        batch_restore = await client.post("/api/integrations/capabilities/batch", json={
            "tools": ["linear.list_teams", "linear.create_comment"],
            "enabled": True
        })
        assert batch_restore.status_code == 200
        assert "linear.list_teams" not in batch_restore.json()["disabled_capabilities"]

        # Read-only mode preset test
        batch_ro = await client.post("/api/integrations/capabilities/batch", json={
            "tools": ["linear.get_issue", "linear.update_status", "linear.post_comment"],
            "mode": "read_only"
        })
        assert batch_ro.status_code == 200
        disabled = batch_ro.json()["disabled_capabilities"]
        assert "linear.get_issue" not in disabled
        assert "linear.update_status" in disabled
        assert "linear.post_comment" in disabled

        # Clean up
        await client.post("/api/integrations/capabilities/batch", json={
            "tools": ["linear.get_issue", "linear.update_status", "linear.post_comment"],
            "mode": "all_on"
        })
