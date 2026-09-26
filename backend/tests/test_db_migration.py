import sqlite3
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.db.session import _migrate_db
from app.db.models import Base, TaskPRModel, TaskModel


def test_sqlite_legacy_task_prs_is_draft_migration(tmp_path):
    """
    Verifies that when an existing SQLite database lacks newer columns like `is_draft` on `task_prs`,
    calling `_migrate_db` adds the column via ALTER TABLE so that SQLAlchemy queries succeed.
    """
    db_file = tmp_path / "legacy_test.db"
    
    # 1. Create a raw legacy SQLite database with only the original task_prs columns
    conn = sqlite3.connect(str(db_file))
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE tasks (
            id VARCHAR(36) PRIMARY KEY,
            title VARCHAR(300) NOT NULL,
            description TEXT,
            status VARCHAR(30) DEFAULT 'QUEUED',
            persona VARCHAR(50) DEFAULT 'PairProgrammer',
            created_at TIMESTAMP,
            updated_at TIMESTAMP
        );
    """)
    cursor.execute("""
        CREATE TABLE task_prs (
            id VARCHAR(36) PRIMARY KEY,
            task_id VARCHAR(36) NOT NULL,
            pr_number INTEGER NOT NULL,
            title VARCHAR(300) NOT NULL,
            author VARCHAR(100) DEFAULT '',
            head_branch VARCHAR(200) DEFAULT '',
            base_branch VARCHAR(200) DEFAULT 'main',
            html_url VARCHAR(500) DEFAULT '',
            status VARCHAR(50) DEFAULT 'OPEN',
            worktree_path VARCHAR(300) DEFAULT '',
            diff_stats JSON,
            review_summary TEXT,
            test_output TEXT,
            created_at TIMESTAMP,
            updated_at TIMESTAMP,
            FOREIGN KEY (task_id) REFERENCES tasks (id)
        );
    """)
    cursor.execute("INSERT INTO tasks (id, title) VALUES ('task-1', 'Test Task');")
    cursor.execute("""
        INSERT INTO task_prs (id, task_id, pr_number, title)
        VALUES ('pr-1', 'task-1', 42, 'Fix Memory Leak');
    """)
    conn.commit()
    conn.close()

    # 2. Connect via SQLAlchemy sync engine and run _migrate_db
    sync_engine = create_engine(f"sqlite:///{db_file}")
    with sync_engine.begin() as connection:
        _migrate_db(connection)

    # 3. Query via SQLAlchemy ORM model expecting `is_draft` and other modern columns
    with Session(sync_engine) as session:
        pr = session.execute(select(TaskPRModel).where(TaskPRModel.id == "pr-1")).scalar_one()
        assert pr.pr_number == 42
        assert pr.is_draft is False
        assert pr.is_session_scoped is True
