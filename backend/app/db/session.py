import os
from pathlib import Path
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.config import settings
from app.db.models import Base

# Ensure parent directory of sqlite db exists
if settings.DATABASE_URL.startswith("sqlite+aiosqlite:////"):
    db_path = settings.DATABASE_URL.replace("sqlite+aiosqlite:////", "/")
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
elif settings.DATABASE_URL.startswith("sqlite+aiosqlite:///"):
    db_path = settings.DATABASE_URL.replace("sqlite+aiosqlite:///", "")
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)

connect_args = {}
if "sqlite" in settings.DATABASE_URL:
    connect_args = {"timeout": 60, "check_same_thread": False}

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    connect_args=connect_args,
    future=True
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def _migrate_db(connection):
    # Enable WAL mode and busy timeout on SQLite to prevent locking
    try:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL;")
        connection.exec_driver_sql("PRAGMA busy_timeout=60000;")
    except Exception:
        pass

    Base.metadata.create_all(connection)
    
    # Check tasks table columns
    tasks_cols = [row[1] for row in connection.exec_driver_sql("PRAGMA table_info(tasks)").fetchall()]
    new_task_columns = [
        ("session_key", "VARCHAR(255)"),
        ("repo_name", "VARCHAR(255)"),
        ("repo_url", "VARCHAR(512)"),
        ("target_branch", "VARCHAR(128)"),
        ("commit_sha", "VARCHAR(64)"),
        ("sandbox_status", "VARCHAR(32) DEFAULT 'NONE'"),
        ("custom_title", "BOOLEAN DEFAULT 0"),
    ]
    for col_name, col_type in new_task_columns:
        if col_name not in tasks_cols:
            connection.exec_driver_sql(f"ALTER TABLE tasks ADD COLUMN {col_name} {col_type}")

    # Check task_messages table columns
    msg_cols = [row[1] for row in connection.exec_driver_sql("PRAGMA table_info(task_messages)").fetchall()]
    if "tokens" not in msg_cols:
        connection.exec_driver_sql("ALTER TABLE task_messages ADD COLUMN tokens INTEGER DEFAULT 0")


async def ensure_default_repositories():
    """
    Backfills discovered repositories from historical tasks and environment settings
    into RepositoryConfigModel so they are immediately available in the Vault across sessions.
    """
    async with async_session_factory() as session:
        try:
            from sqlalchemy import select
            from app.db.models import TaskModel, RepositoryConfigModel, get_utc_now
            from app.core.security import encrypt_secret
            
            res = await session.execute(select(RepositoryConfigModel))
            existing_repos = {r.full_name: r for r in res.scalars().all()}

            task_res = await session.execute(select(TaskModel))
            tasks = task_res.scalars().all()

            token = settings.GITHUB_TOKEN
            enc_token = encrypt_secret(token) if token else None

            for t in tasks:
                raw_url = t.repo_url or ""
                raw_name = t.repo_name or ""
                
                full_name = None
                if raw_url and "github.com/" in raw_url:
                    full_name = raw_url.split("github.com/")[-1].replace(".git", "").strip("/")
                elif raw_name and "/" in raw_name and not raw_name.startswith("http"):
                    full_name = raw_name.strip()
                elif raw_name and raw_name != "None" and raw_name != "null":
                    full_name = raw_name.strip()
                
                if full_name and full_name not in existing_repos:
                    name = full_name.split("/")[-1]
                    clone_url = f"https://github.com/{full_name}"
                    new_repo = RepositoryConfigModel(
                        name=name,
                        full_name=full_name,
                        clone_url=clone_url,
                        default_branch=t.target_branch or "main",
                        encrypted_token=enc_token,
                        auth_provider="github",
                        test_command="",
                        tech_stack=[],
                        status="CONNECTED",
                        created_at=get_utc_now(),
                        updated_at=get_utc_now(),
                    )
                    session.add(new_repo)
                    existing_repos[full_name] = new_repo

            # Clean up any legacy default fake values on existing repos
            for full_name, repo in existing_repos.items():
                if repo.test_command == "pytest" and repo.tech_stack and "Python" in repo.tech_stack and not repo.manifest_cache:
                    repo.tech_stack = []
                    repo.test_command = ""

            await session.commit()
        except Exception as e:
            import logging
            logging.getLogger("adappty.db").warning(f"Error auto-backfilling repositories: {e}")
            await session.rollback()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(_migrate_db)
    await ensure_default_repositories()

