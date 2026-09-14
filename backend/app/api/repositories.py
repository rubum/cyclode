import logging
import re
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db, async_session_factory
from app.db.models import RepositoryConfigModel, get_utc_now
from app.core.security import encrypt_secret, decrypt_secret
from app.integrations.manager import integration_manager

logger = logging.getLogger("cyclode.repositories")
router = APIRouter(prefix="/api/repositories", tags=["Repositories"])


class RepositoryCreateRequest(BaseModel):
    name: Optional[str] = None
    full_name: str
    clone_url: Optional[str] = None
    default_branch: str = "main"
    token: Optional[str] = None
    auth_provider: str = "github"
    test_command: Optional[str] = None
    tech_stack: List[str] = []


class RepositoryUpdateRequest(BaseModel):
    name: Optional[str] = None
    default_branch: Optional[str] = None
    token: Optional[str] = None
    test_command: Optional[str] = None
    tech_stack: Optional[List[str]] = None


def mask_token_preview(token: Optional[str]) -> str:
    if not token:
        return ""
    if len(token) <= 8:
        return "••••••••"
    return f"{token[:4]}••••••••{token[-3:]}"


def serialize_repo(repo: RepositoryConfigModel) -> Dict[str, Any]:
    raw_token = decrypt_secret(repo.encrypted_token) if repo.encrypted_token else None
    return {
        "id": repo.id,
        "name": repo.name,
        "full_name": repo.full_name,
        "clone_url": repo.clone_url,
        "default_branch": repo.default_branch,
        "auth_provider": repo.auth_provider,
        "has_token": bool(raw_token),
        "masked_token": mask_token_preview(raw_token),
        "tech_stack": repo.tech_stack or [],
        "test_command": repo.test_command if repo.test_command and repo.test_command.strip() else None,
        "manifest_cache": repo.manifest_cache or {},
        "status": repo.status,
        "last_synced_at": repo.last_synced_at.isoformat() if repo.last_synced_at else None,
        "created_at": repo.created_at.isoformat() if repo.created_at else None,
        "updated_at": repo.updated_at.isoformat() if repo.updated_at else None,
    }


@router.get("")
async def list_repositories(db: AsyncSession = Depends(get_db)):
    stmt = select(RepositoryConfigModel).order_by(RepositoryConfigModel.name)
    res = await db.execute(stmt)
    repos = res.scalars().all()
    return [serialize_repo(r) for r in repos]


@router.post("")
async def create_or_update_repository(req: RepositoryCreateRequest, db: AsyncSession = Depends(get_db)):
    full_name = req.full_name.strip().strip("/")
    if full_name.startswith("http"):
        full_name = full_name.split("github.com/")[-1].replace(".git", "").strip("/")

    name = req.name or (full_name.split("/")[-1] if "/" in full_name else full_name)
    clone_url = req.clone_url or f"https://github.com/{full_name}"

    # Encrypt token if provided
    enc_token = encrypt_secret(req.token) if req.token else None

    # Test connectivity if token or public
    test_res = await integration_manager.test_remote_repo(clone_url, req.token)
    status = "CONNECTED" if test_res.get("accessible") else "AUTH_REQUIRED"
    branches = test_res.get("branches", [])
    default_branch = req.default_branch or test_res.get("default_branch", "main")

    stmt = select(RepositoryConfigModel).where(RepositoryConfigModel.full_name == full_name)
    res = await db.execute(stmt)
    existing = res.scalars().first()

    if existing:
        existing.name = name
        existing.clone_url = clone_url
        existing.default_branch = default_branch
        if enc_token:
            existing.encrypted_token = enc_token
        existing.status = status
        existing.auth_provider = req.auth_provider
        if req.test_command is not None:
            existing.test_command = req.test_command.strip() if req.test_command.strip() else None
        if req.tech_stack:
            existing.tech_stack = req.tech_stack
        existing.last_synced_at = get_utc_now()
        await db.commit()
        await db.refresh(existing)
        return {"ok": True, "repository": serialize_repo(existing), "validation": test_res}
    else:
        new_repo = RepositoryConfigModel(
            name=name,
            full_name=full_name,
            clone_url=clone_url,
            default_branch=default_branch,
            encrypted_token=enc_token,
            auth_provider=req.auth_provider,
            test_command=req.test_command.strip() if req.test_command and req.test_command.strip() else None,
            tech_stack=req.tech_stack,
            status=status,
            manifest_cache={"branches": branches[:10]} if branches else {}
        )
        db.add(new_repo)
        await db.commit()
        await db.refresh(new_repo)
        return {"ok": True, "repository": serialize_repo(new_repo), "validation": test_res}


@router.get("/{repo_id}")
async def get_repository(repo_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(RepositoryConfigModel).where(RepositoryConfigModel.id == repo_id)
    res = await db.execute(stmt)
    repo = res.scalars().first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")
    return serialize_repo(repo)


@router.put("/{repo_id}")
async def update_repository(repo_id: str, req: RepositoryUpdateRequest, db: AsyncSession = Depends(get_db)):
    stmt = select(RepositoryConfigModel).where(RepositoryConfigModel.id == repo_id)
    res = await db.execute(stmt)
    repo = res.scalars().first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    if req.name:
        repo.name = req.name
    if req.default_branch:
        repo.default_branch = req.default_branch
    if req.test_command is not None:
        repo.test_command = req.test_command.strip() if req.test_command.strip() else None
    if req.tech_stack is not None:
        repo.tech_stack = req.tech_stack
    if req.token:
        repo.encrypted_token = encrypt_secret(req.token)

    # Re-test connection
    raw_token = decrypt_secret(repo.encrypted_token) if repo.encrypted_token else None
    test_res = await integration_manager.test_remote_repo(repo.clone_url, raw_token)
    repo.status = "CONNECTED" if test_res.get("accessible") else "AUTH_REQUIRED"
    repo.last_synced_at = get_utc_now()

    await db.commit()
    await db.refresh(repo)
    return {"ok": True, "repository": serialize_repo(repo), "validation": test_res}


@router.delete("")
async def clear_all_repositories(db: AsyncSession = Depends(get_db)):
    """
    Clears all repository configurations and credentials strictly from Cyclode's local vault database.
    Does NOT modify, alter, or touch any remote repositories, GitHub branches, or code.
    """
    stmt = select(RepositoryConfigModel)
    res = await db.execute(stmt)
    repos = res.scalars().all()
    count = len(repos)

    del_stmt = delete(RepositoryConfigModel)
    await db.execute(del_stmt)
    await db.commit()

    logger.info(f"Cleared {count} repository configurations from local Cyclode Vault.")
    return {
        "ok": True,
        "count": count,
        "message": f"Successfully cleared {count} repository configuration(s) from local Cyclode Vault. Remote repositories were not modified."
    }


@router.delete("/{repo_id}")
async def delete_repository(repo_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(RepositoryConfigModel).where(RepositoryConfigModel.id == repo_id)
    res = await db.execute(stmt)
    repo = res.scalars().first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    await db.delete(repo)
    await db.commit()
    return {"ok": True, "id": repo_id}


@router.post("/{repo_id}/test-connection")
async def test_repository_connection(repo_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(RepositoryConfigModel).where(RepositoryConfigModel.id == repo_id)
    res = await db.execute(stmt)
    repo = res.scalars().first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    raw_token = decrypt_secret(repo.encrypted_token) if repo.encrypted_token else None
    test_res = await integration_manager.test_remote_repo(repo.clone_url, raw_token)

    repo.status = "CONNECTED" if test_res.get("accessible") else "AUTH_REQUIRED"
    if test_res.get("branches"):
        repo.manifest_cache = {**(repo.manifest_cache or {}), "branches": test_res["branches"][:10]}
    repo.last_synced_at = get_utc_now()
    await db.commit()

    return {"ok": True, "status": repo.status, "validation": test_res}


@router.post("/discover")
async def discover_repositories(db: AsyncSession = Depends(get_db)):
    """
    Scans historical tasks and settings to auto-discover and register repositories in the Vault.
    """
    from app.db.session import ensure_default_repositories
    await ensure_default_repositories()
    
    stmt = select(RepositoryConfigModel).order_by(RepositoryConfigModel.name)
    res = await db.execute(stmt)
    repos = res.scalars().all()
    return {"ok": True, "count": len(repos), "repositories": [serialize_repo(r) for r in repos]}


class InstallWebhookRequest(BaseModel):
    webhook_url: Optional[str] = None
    secret: Optional[str] = None
    events: Optional[List[str]] = None


@router.post("/{repo_id}/install-webhook")
async def install_repository_webhook(
    repo_id: str,
    req: Optional[InstallWebhookRequest] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Installs an automatic GitHub webhook listener on the target repository using the stored PAT.
    """
    stmt = select(RepositoryConfigModel).where(RepositoryConfigModel.id == repo_id)
    res = await db.execute(stmt)
    repo = res.scalars().first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    raw_token = decrypt_secret(repo.encrypted_token) if repo.encrypted_token else None
    if not raw_token:
        raise HTTPException(
            status_code=400,
            detail=f"Repository '{repo.full_name}' does not have a saved GitHub Personal Access Token in the Vault. Please add a token with 'repo' scope first."
        )

    webhook_url = (req.webhook_url if req and req.webhook_url else None) or "http://localhost:8000/api/webhooks/github"
    secret = req.secret if req and req.secret else None
    events = req.events if req and req.events else ["pull_request", "issues", "issue_comment", "push"]

    result = await integration_manager.install_repo_webhook(
        full_name=repo.full_name,
        webhook_url=webhook_url,
        secret=secret,
        custom_token=raw_token
    )

    # Update manifest cache to reflect webhook listener registration
    if result.get("success"):
        m_cache = dict(repo.manifest_cache or {})
        m_cache["webhook_listener"] = {
            "installed": True,
            "hook_id": result.get("hook_id"),
            "webhook_url": webhook_url,
            "events": events,
            "updated_at": get_utc_now().isoformat()
        }
        repo.manifest_cache = m_cache
        await db.commit()

    return result


@router.get("/{repo_id}/webhook-status")
async def get_repository_webhook_status(
    repo_id: str,
    webhook_url: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves the current webhook registration status on GitHub for this repository.
    """
    stmt = select(RepositoryConfigModel).where(RepositoryConfigModel.id == repo_id)
    res = await db.execute(stmt)
    repo = res.scalars().first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    raw_token = decrypt_secret(repo.encrypted_token) if repo.encrypted_token else None
    target_url = webhook_url or "http://localhost:8000/api/webhooks/github"

    result = await integration_manager.get_repo_webhook_status(
        full_name=repo.full_name,
        webhook_url=target_url,
        custom_token=raw_token
    )
    result["repo_full_name"] = repo.full_name
    result["has_token"] = bool(raw_token)
    result["saved_listener_info"] = (repo.manifest_cache or {}).get("webhook_listener")
    return result


@router.post("/{repo_id}/simulate-event")
async def simulate_repository_event(
    repo_id: str,
    event_type: str = "pull_request.opened",
    db: AsyncSession = Depends(get_db)
):
    """
    Simulates a repository event (e.g. pull_request.opened, push) for testing the live agent pipeline.
    """
    stmt = select(RepositoryConfigModel).where(RepositoryConfigModel.id == repo_id)
    res = await db.execute(stmt)
    repo = res.scalars().first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    from app.core.router import event_router

    simulated_payload = {
        "action": "opened" if "opened" in event_type else "synchronize",
        "repository": {
            "name": repo.name,
            "full_name": repo.full_name,
            "clone_url": repo.clone_url,
            "default_branch": repo.default_branch
        },
        "pull_request": {
            "number": 99,
            "title": f"Automated test & audit on {repo.name}",
            "body": f"Simulated repository webhook event on `{repo.full_name}`.",
            "head": {"ref": repo.default_branch, "sha": "e9b28a1"},
            "base": {"ref": repo.default_branch}
        },
        "sender": {"login": "cyclode-bot"}
    }

    result = await event_router.route_and_dispatch(
        source="github",
        event_type=event_type,
        payload=simulated_payload,
        signature_valid=True
    )
    return {"ok": True, "result": result}


