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

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
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
    ]
    for col_name, col_type in new_task_columns:
        if col_name not in tasks_cols:
            connection.exec_driver_sql(f"ALTER TABLE tasks ADD COLUMN {col_name} {col_type}")

    # Check task_messages table columns
    msg_cols = [row[1] for row in connection.exec_driver_sql("PRAGMA table_info(task_messages)").fetchall()]
    if "tokens" not in msg_cols:
        connection.exec_driver_sql("ALTER TABLE task_messages ADD COLUMN tokens INTEGER DEFAULT 0")


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(_migrate_db)
