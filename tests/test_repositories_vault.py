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
            "name": "crud-payment-service",
            "full_name": "octocat/crud-payment-service",
            "clone_url": "https://github.com/octocat/crud-payment-service",
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
        assert repo["full_name"] == "octocat/crud-payment-service"
        assert repo["has_token"] is True
        assert repo["masked_token"].startswith("ghp_")
        assert "secureSecretToken12345" not in repo["masked_token"]
        repo_id = repo["id"]

        # 2. List repos
        list_res = await client.get("/api/repositories")
        assert list_res.status_code == 200
        repos = list_res.json()
        assert any(r["full_name"] == "octocat/crud-payment-service" for r in repos)

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
        recovered_token = await integration_manager.get_github_token_for_repo("octocat/crud-payment-service")
        assert recovered_token == "ghp_secureSecretToken12345"

        recovered_short = await integration_manager.get_github_token_for_repo("crud-payment-service")
        assert recovered_short == "ghp_secureSecretToken12345"

        # 5. Auto-resolution in task spawn
        task_id = await agent_pool.spawn_task(
            title="Investigate issue on crud-payment-service repo",
            description="Please check app/auth_service.py on crud-payment-service"
        )
        task_details_res = await client.get(f"/api/tasks/{task_id}")
        assert task_details_res.status_code == 200
        t_data = task_details_res.json()
        assert t_data.get("repo_name") == "octocat/crud-payment-service"
        assert t_data.get("repo_url") == "https://github.com/octocat/crud-payment-service"
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


@pytest.mark.asyncio
async def test_clear_all_repositories():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Create two test repos
        await client.post("/api/repositories", json={
            "full_name": "test-org/repo-alpha",
            "default_branch": "main"
        })
        await client.post("/api/repositories", json={
            "full_name": "test-org/repo-beta",
            "default_branch": "main"
        })

        # 2. Verify repos exist
        list_res = await client.get("/api/repositories")
        assert list_res.status_code == 200
        assert len(list_res.json()) >= 2

        # 3. Call bulk clear all
        clear_res = await client.delete("/api/repositories")
        assert clear_res.status_code == 200
        clear_data = clear_res.json()
        assert clear_data["ok"] is True
        assert clear_data["count"] >= 2
        assert "Remote repositories were not modified" in clear_data["message"]

        # 4. Verify list is now empty
        empty_res = await client.get("/api/repositories")
        assert empty_res.status_code == 200
        assert len(empty_res.json()) == 0

        # 5. Discover default templates again
        disc_res = await client.post("/api/repositories/discover")
        assert disc_res.status_code == 200
        assert disc_res.json()["count"] >= 1


@pytest.mark.asyncio
async def test_generic_stopword_prompts_do_not_trigger_repo_resolution():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Seed a repo named 'repo' or 'app' to test stopword collision protection
        await client.post("/api/repositories", json={
            "name": "repo",
            "full_name": "demo-org/repo",
            "clone_url": "https://github.com/demo-org/repo",
            "default_branch": "main"
        })

        # 1. "Can you init a git repo" must NOT bind to demo-org/repo
        task_id = await agent_pool.spawn_task(
            title="Can you init a git repo",
            description="Can you init a git repo"
        )
        task_res = await client.get(f"/api/tasks/{task_id}")
        assert task_res.status_code == 200
        t_data = task_res.json()
        assert t_data.get("repo_url") is None
        assert t_data.get("repo_name") is None

        # 2. "What is a monorepo vs polyrepo" must NOT bind to demo-org/repo
        task_id_qa = await agent_pool.spawn_task(
            title="What is a monorepo",
            description="Explain difference between monorepo and polyrepo architecture"
        )
        task_res_qa = await client.get(f"/api/tasks/{task_id_qa}")
        assert task_res_qa.status_code == 200
        t_qa = task_res_qa.json()
        assert t_qa.get("repo_url") is None
        assert t_qa.get("repo_name") is None

        # 3. Explicit handle "@demo-org/repo" DOES bind
        task_id_explicit = await agent_pool.spawn_task(
            title="Inspect @demo-org/repo",
            description="Run review on @demo-org/repo"
        )
        task_res_exp = await client.get(f"/api/tasks/{task_id_explicit}")
        assert task_res_exp.status_code == 200
        t_exp = task_res_exp.json()
        assert t_exp.get("repo_url") == "https://github.com/demo-org/repo"
        assert t_exp.get("repo_name") == "demo-org/repo"

