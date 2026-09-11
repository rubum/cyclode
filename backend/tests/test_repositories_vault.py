import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.security import encrypt_secret, decrypt_secret
from app.db.session import async_session_factory
from app.db.models import RepositoryConfigModel
from app.integrations.manager import integration_manager
from app.agent.pool import agent_pool


def test_token_encryption_decryption():
    raw_token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    encrypted = encrypt_secret(raw_token)
    assert encrypted != raw_token
    assert len(encrypted) > len(raw_token)
    decrypted = decrypt_secret(encrypted)
    assert decrypted == raw_token


@pytest.mark.asyncio
async def test_repository_vault_crud():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create repo config with token
        create_payload = {
            "name": "waylo",
            "full_name": "gowaylo/waylo",
            "clone_url": "https://github.com/gowaylo/waylo",
            "default_branch": "main",
            "token": "ghp_secureSecretToken12345",
            "test_command": "pytest -v",
            "tech_stack": ["Python", "FastAPI"]
        }
        res = await client.post("/api/repositories", json=create_payload)
        assert res.status_code == 200
        data = res.json()
        assert data.get("ok") is True
        repo = data.get("repository")
        assert repo["full_name"] == "gowaylo/waylo"
        assert repo["has_token"] is True
        assert repo["masked_token"].startswith("ghp_")
        assert "secureSecretToken12345" not in repo["masked_token"]
        repo_id = repo["id"]

        # 2. List repos
        list_res = await client.get("/api/repositories")
        assert list_res.status_code == 200
        repos = list_res.json()
        assert any(r["full_name"] == "gowaylo/waylo" for r in repos)

        # 3. Update repo
        update_payload = {
            "test_command": "pytest -m unit",
            "default_branch": "develop"
        }
        put_res = await client.put(f"/api/repositories/{repo_id}", json=update_payload)
        assert put_res.status_code == 200
        updated = put_res.json().get("repository")
        assert updated["test_command"] == "pytest -m unit"
        assert updated["default_branch"] == "develop"

        # 4. Vault token resolution
        recovered_token = await integration_manager.get_github_token_for_repo("gowaylo/waylo")
        assert recovered_token == "ghp_secureSecretToken12345"

        recovered_short = await integration_manager.get_github_token_for_repo("waylo")
        assert recovered_short == "ghp_secureSecretToken12345"

        # 5. Auto-resolution in task spawn
        task_id = await agent_pool.spawn_task(
            title="Investigate issue on waylo repo",
            description="Please check app/auth_service.py on waylo"
        )
        task_details_res = await client.get(f"/api/tasks/{task_id}")
        assert task_details_res.status_code == 200
        t_data = task_details_res.json()
        assert t_data.get("repo_name") == "gowaylo/waylo"
        assert t_data.get("repo_url") == "https://github.com/gowaylo/waylo"
        assert t_data.get("target_branch") == "develop"

        # 6. Delete repo
        del_res = await client.delete(f"/api/repositories/{repo_id}")
        assert del_res.status_code == 200


@pytest.mark.asyncio
async def test_repository_architecture_persistence_and_retrieval():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Save repo config via manager (as done during repository analysis)
        save_res = await integration_manager.save_repo_config(
            repo_url="https://github.com/acme-org/payment-elixir",
            token="ghp_elixirSecretToken123",
            branches=["main", "staging"],
            tech_stack=["Elixir", "Phoenix", "Oban", "Fly.io"],
            test_command="mix test",
            manifest_cache={"manifests": ["mix.exs", "fly.toml"], "subprojects": []},
            default_branch="main"
        )
        assert save_res.get("ok") is True

        # 2. Retrieve via API
        list_res = await client.get("/api/repositories")
        assert list_res.status_code == 200
        repos = list_res.json()
        target = next((r for r in repos if r["full_name"] == "acme-org/payment-elixir"), None)
        assert target is not None
        assert target["test_command"] == "mix test"
        assert "Elixir" in target["tech_stack"]
        assert "Phoenix" in target["tech_stack"]
        assert target["has_token"] is True
        repo_id = target["id"]

        # 3. Update test command explicitly
        put_res = await client.put(f"/api/repositories/{repo_id}", json={"test_command": "mix test --trace"})
        assert put_res.status_code == 200
        assert put_res.json()["repository"]["test_command"] == "mix test --trace"

        # 4. Clean up
        del_res = await client.delete(f"/api/repositories/{repo_id}")
        assert del_res.status_code == 200

