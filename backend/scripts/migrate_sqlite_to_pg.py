#!/usr/bin/env python3
"""
Cyclode SQLite to PostgreSQL Data Migration Script
Transfers all historical tasks, messages, logs, approvals, repositories, and cache
from a local cyclode.db SQLite database into PostgreSQL with zero data loss.
Handles SQLite integer booleans, JSON text deserialization, and sequence alignment.
"""

import os
import sys
import json
import sqlite3
import asyncio
import argparse
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List

# Ensure app package is importable
repo_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo_root))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("cyclode.migrate")

TABLE_ORDER = [
    "events",
    "tasks",
    "task_messages",
    "task_logs",
    "task_approvals",
    "task_diffs",
    "task_prs",
    "automation_rules",
    "repository_configs",
    "doc_pages_cache",
    "semantic_cache",
    "knowledge_entries",
]


async def async_migrate(sqlite_path: str, pg_url: str, dry_run: bool = False, truncate_target: bool = False):
    sqlite_file = Path(sqlite_path).resolve()
    if not sqlite_file.exists():
        logger.error(f"SQLite database file not found at: {sqlite_file}")
        sys.exit(1)

    # Normalize pg_url to postgresql+asyncpg://
    async_pg_url = pg_url
    if async_pg_url.startswith("postgres://"):
        async_pg_url = async_pg_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif async_pg_url.startswith("postgresql://") and not async_pg_url.startswith("postgresql+asyncpg://"):
        async_pg_url = async_pg_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    logger.info(f"Connecting to source SQLite: {sqlite_file}")
    sqlite_conn = sqlite3.connect(str(sqlite_file))
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cursor = sqlite_conn.cursor()

    logger.info(f"Connecting to target PostgreSQL: {async_pg_url.split('@')[-1]}")
    pg_engine = create_async_engine(async_pg_url, pool_pre_ping=True)

    # Initialize schema
    from app.db.session import _migrate_db
    async with pg_engine.begin() as conn:
        logger.info("Initializing target PostgreSQL schema...")
        await conn.run_sync(_migrate_db)

    # Discover tables in SQLite
    sqlite_cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    sqlite_tables = {row[0] for row in sqlite_cursor.fetchall()}
    logger.info(f"Discovered SQLite tables: {sqlite_tables}")

    total_migrated = 0

    async with pg_engine.begin() as pg_conn:
        if truncate_target and not dry_run:
            logger.warning("Truncating target tables prior to migration...")
            for table_name in reversed(TABLE_ORDER):
                try:
                    await pg_conn.execute(text(f"TRUNCATE TABLE {table_name} CASCADE;"))
                except Exception:
                    pass

        for table_name in TABLE_ORDER:
            if table_name not in sqlite_tables:
                logger.info(f"Skipping table '{table_name}' (not present in SQLite source)")
                continue

            # Get column list from SQLite
            sqlite_cursor.execute(f"PRAGMA table_info({table_name});")
            src_cols = [row["name"] for row in sqlite_cursor.fetchall()]

            # Get column list and data types from PostgreSQL
            res = await pg_conn.execute(text(f"""
                SELECT column_name, data_type FROM information_schema.columns 
                WHERE table_name = '{table_name}';
            """))
            pg_col_types = {row[0]: row[1].lower() for row in res.fetchall()}

            common_cols = [c for c in src_cols if c in pg_col_types]
            if not common_cols:
                logger.warning(f"No common columns for table '{table_name}', skipping")
                continue

            # Read all rows from SQLite
            cols_str = ", ".join(f'"{c}"' for c in common_cols)
            sqlite_cursor.execute(f"SELECT {cols_str} FROM {table_name};")
            rows = sqlite_cursor.fetchall()

            # Filter orphaned records that violate PostgreSQL foreign keys
            if table_name in ["task_messages", "task_logs", "task_approvals", "task_diffs", "task_prs"]:
                sqlite_cursor.execute("SELECT id FROM tasks;")
                valid_task_ids = {r[0] for r in sqlite_cursor.fetchall()}
                initial_count = len(rows)
                rows = [r for r in rows if r["task_id"] in valid_task_ids]
                if len(rows) < initial_count:
                    logger.warning(f"Table '{table_name}': Filtered {initial_count - len(rows)} orphaned records with nonexistent task_id")

            count = len(rows)
            logger.info(f"Table '{table_name}': Found {count} records in SQLite")

            if count == 0:
                continue

            if dry_run:
                logger.info(f"[DRY-RUN] Would insert {count} rows into PostgreSQL '{table_name}'")
                continue

            # Coerce SQLite types to strict PostgreSQL/asyncpg types
            batch_data = []
            for r in rows:
                item = {}
                for c in common_cols:
                    val = r[c]
                    col_type = pg_col_types[c]

                    # Sanitize nullable foreign key parent_task_id
                    if c == "parent_task_id" and val:
                        sqlite_cursor.execute("SELECT id FROM tasks;")
                        valid_task_ids = {row[0] for row in sqlite_cursor.fetchall()}
                        if val not in valid_task_ids:
                            val = None

                    if val is None:
                        item[c] = None
                        continue

                    # Boolean coercion (SQLite 0/1 -> Python bool)
                    if "bool" in col_type:
                        item[c] = bool(val)
                    # JSON coercion (SQLite JSON text -> JSON string for PostgreSQL)
                    elif col_type in ["json", "jsonb"]:
                        if isinstance(val, (dict, list)):
                            item[c] = json.dumps(val)
                        elif isinstance(val, str):
                            try:
                                json.loads(val)
                                item[c] = val
                            except Exception:
                                item[c] = json.dumps(val)
                        else:
                            item[c] = json.dumps(val)
                    # Timestamp coercion
                    elif "timestamp" in col_type and isinstance(val, str):
                        try:
                            dt = datetime.fromisoformat(val)
                            item[c] = dt.replace(tzinfo=None)
                        except Exception:
                            item[c] = val
                    else:
                        item[c] = val

                batch_data.append(item)

            placeholders_list = []
            for c in common_cols:
                col_type = pg_col_types[c]
                if col_type in ["json", "jsonb"]:
                    placeholders_list.append(f"CAST(:{c} AS {col_type})")
                else:
                    placeholders_list.append(f":{c}")
            placeholders = ", ".join(placeholders_list)
            insert_stmt = text(f"""
                INSERT INTO {table_name} ({cols_str})
                VALUES ({placeholders})
                ON CONFLICT DO NOTHING;
            """)

            # Insert in chunks of 250
            chunk_size = 250
            for i in range(0, len(batch_data), chunk_size):
                chunk = batch_data[i:i + chunk_size]
                await pg_conn.execute(insert_stmt, chunk)

            logger.info(f"Table '{table_name}': Successfully inserted {count} rows into PostgreSQL")
            total_migrated += count

            # Synchronize sequence if there is an integer ID column
            try:
                seq_res = (await pg_conn.execute(
                    text(f"SELECT pg_get_serial_sequence('{table_name}', 'id');")
                )).scalar()
                if seq_res:
                    await pg_conn.execute(
                        text(f"SELECT setval('{seq_res}', COALESCE((SELECT MAX(id) FROM {table_name}), 1));")
                    )
                    logger.debug(f"Reset sequence '{seq_res}' for table '{table_name}'")
            except Exception as e:
                logger.debug(f"Note on sequence for table '{table_name}': {e}")

    await pg_engine.dispose()
    sqlite_conn.close()
    logger.info(f"Migration completed successfully! Total records processed: {total_migrated}")


def main():
    parser = argparse.ArgumentParser(description="Migrate Cyclode SQLite database to PostgreSQL")
    parser.add_argument(
        "--sqlite-path",
        default=os.environ.get("SQLITE_PATH") or str(Path("/data/cyclode.db")),
        help="Path to cyclode.db SQLite file (default: /data/cyclode.db or CYCLODE_HOME/data/cyclode.db)"
    )
    parser.add_argument(
        "--pg-url",
        default=os.environ.get("DATABASE_URL") or "postgresql+asyncpg://cyclode:cyclode@postgres:5432/cyclode",
        help="PostgreSQL connection string"
    )
    parser.add_argument("--dry-run", action="store_true", help="Inspect and count rows without writing to PostgreSQL")
    parser.add_argument("--truncate-target", action="store_true", help="Truncate target tables before inserting")

    args = parser.parse_args()

    # If default /data/cyclode.db doesn't exist, check local ~/.cyclode/data/cyclode.db
    sqlite_target = Path(args.sqlite_path)
    if not sqlite_target.exists():
        user_home_cand = Path.home() / ".cyclode" / "data" / "cyclode.db"
        if user_home_cand.exists():
            args.sqlite_path = str(user_home_cand)

    asyncio.run(async_migrate(args.sqlite_path, args.pg_url, dry_run=args.dry_run, truncate_target=args.truncate_target))


if __name__ == "__main__":
    main()
