import pytest
from app.agent.tools import WorkspaceTools
from app.integrations.registry import IntegrationRegistry
from app.integrations.manager import integration_manager
from ingrations.auth import default_auth_manager


def test_ingrations_registry_status():
    status_list = IntegrationRegistry.get_status()
    ingrations_entry = next((item for item in status_list if item["id"] == "ingrations"), None)
    assert ingrations_entry is not None
    assert ingrations_entry["name"] == "Ingrations Catalog & Ecosystem"
    assert ingrations_entry["configured"] is True
    assert "ingrations.search_tools" in ingrations_entry["skills"]
    assert "ingrations.execute" in ingrations_entry["skills"]


def test_ingrations_search_tools():
    result = WorkspaceTools.ingrations_search_tools("jira issue", category="devtools", limit=3)
    assert "query" in result
    assert result["count"] > 0
    assert len(result["results"]) > 0

    first_hit = result["results"][0]
    assert "action_id" in first_hit
    assert "jira" in first_hit["action_id"]
    assert "parameters" in first_hit
    assert isinstance(first_hit["parameters"], list)


@pytest.mark.asyncio
async def test_ingrations_execute_dry_run():
    result = await WorkspaceTools.ingrations_execute(
        action_id="slack.post_message",
        params={"channel": "C-TEST", "text": "Automated deployment notice from Cyclode"},
        dry_run=True
    )
    assert result["success"] is True
    assert result["status_code"] == 200
    assert result["data"]["dry_run"] is True
    assert result["data"]["body"]["text"] == "Automated deployment notice from Cyclode"


def test_ingrations_credential_sync():
    integration_manager.set_custom_credential("jira", "token", "jira_secret_token_cyclode")
    integration_manager.sync_to_ingrations()

    cred = default_auth_manager.get_credential("jira")
    assert cred == "jira_secret_token_cyclode"


def test_harness_tools_declaration():
    from app.agent.harness import AntigravityHarness

    harness = AntigravityHarness()
    # In a full turn, tools_def contains the declarations
    # Let's verify by inspecting the module source or method
    import app.agent.harness as h_mod
    with open(h_mod.__file__, "r", encoding="utf-8") as f:
        src = f.read()

    assert '"name": "ingrations_search_tools"' in src
    assert '"name": "ingrations_execute"' in src
    assert 'elif fn_name == "ingrations_search_tools":' in src
    assert 'elif fn_name == "ingrations_execute":' in src


def test_ingrations_catalog_providers_in_status():
    status = IntegrationRegistry.get_status()
    provider_ids = {p["id"] for p in status}
    
    # Assert individual Ingrations providers are present
    expected_providers = [
        "jira", "gitlab", "notion", "discord", "google_workspace",
        "aws", "supabase", "cloudflare", "datadog", "stripe",
        "salesforce", "hubspot"
    ]
    for p_id in expected_providers:
        assert p_id in provider_ids, f"Provider {p_id} should be in status"

    jira_entry = next(p for p in status if p["id"] == "jira")
    assert jira_entry["name"] == "Jira Software"
    assert "jira.create_issue" in jira_entry["skills"]
    assert jira_entry["icon"] == "jira"


def test_ingrations_skills_catalog():
    skills = IntegrationRegistry.get_skills_catalog()
    skill_ids = {s["id"] for s in skills}

    expected_skills = [
        "jira", "gitlab", "notion", "discord", "google_workspace",
        "aws", "supabase", "cloudflare", "datadog", "stripe",
        "salesforce", "hubspot"
    ]
    for s_id in expected_skills:
        assert s_id in skill_ids, f"Skill {s_id} should be in catalog"

    jira_skill = next(s for s in skills if s["id"] == "jira")
    assert jira_skill["name"] == "Jira Software Automation & Actions"
    assert jira_skill["path"] == "ingrations://jira"
    assert "jira.get_issue" in jira_skill["tools"]
    assert jira_skill["category"] == "Project Management"


@pytest.mark.asyncio
async def test_ingrations_credential_update_and_skill_activation():
    # Pre-condition: not configured
    integration_manager.set_custom_credential("stripe", "token", "")
    default_auth_manager.remove_credential("stripe")
    
    val = await integration_manager.validate_credentials("stripe", {"token": "sk_test_12345"})
    assert val["valid"] is True

    res = await integration_manager.update_credentials("stripe", {"token": "sk_test_12345"})
    assert res["status"] == "configured"
    assert integration_manager.is_configured("stripe") is True

    # Check status and skills catalog reflection
    status = IntegrationRegistry.get_status()
    stripe_status = next(s for s in status if s["id"] == "stripe")
    assert stripe_status["configured"] is True

    skills = IntegrationRegistry.get_skills_catalog()
    stripe_skill = next(s for s in skills if s["id"] == "stripe")
    assert stripe_skill["status"] == "ACTIVE"
    assert "stripe" in IntegrationRegistry.get_active_skills()


@pytest.mark.asyncio
async def test_jira_configuration_and_domain_resolution(tmp_path):
    from ingrations.executor import ActionExecutor
    # 1. Validation checks
    val_missing_dom = await integration_manager.validate_credentials("jira", {"token": "user@acme.com:token123"})
    assert val_missing_dom["valid"] is False
    assert "Domain" in val_missing_dom["message"]

    val_missing_tok = await integration_manager.validate_credentials("jira", {"domain": "acme.atlassian.net"})
    assert val_missing_tok["valid"] is False
    assert "token" in val_missing_tok["message"]

    val_ok = await integration_manager.validate_credentials("jira", {
        "token": "agent@acme.com:test_api_secret_key",
        "domain": "acme.atlassian.net"
    })
    assert val_ok["valid"] is True

    # 2. Update credentials and verify persistence & sync
    res = await integration_manager.update_credentials("jira", {
        "token": "agent@acme.com:test_api_secret_key",
        "domain": "acme.atlassian.net"
    })
    assert res["status"] == "configured"
    assert integration_manager.is_configured("jira") is True

    # 3. WorkspaceTools.ingrations_execute dry-run should dynamically resolve the configured domain and encode basic auth
    action_res = await WorkspaceTools.ingrations_execute(
        action_id="jira.get_issue",
        params={"issue_id_or_key": "PROJ-101"},
        dry_run=True
    )
    assert action_res["success"] is True
    assert "https://acme.atlassian.net/rest/api/3/issue/PROJ-101" in action_res["data"]["url"]
    assert action_res["data"]["headers"]["Authorization"] == "[REDACTED]"


