import os
import uuid
from pathlib import Path
import pytest
import pytest_asyncio

# Force isolated test SQLite database BEFORE loading any app modules
TEST_DB_FILE = Path(f"/tmp/cyclode_test_{uuid.uuid4().hex[:8]}.db")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DB_FILE}"
os.environ["DEBUG"] = "false"

from app.db.session import init_db, engine


@pytest.fixture(autouse=True, scope="session")
def anyio_backend():
    return "asyncio"


@pytest_asyncio.fixture(autouse=True, scope="session")
async def initialize_test_database():
    await init_db()
    yield
    try:
        await engine.dispose()
    except Exception:
        pass
    for suffix in ("", "-wal", "-shm"):
        p = Path(f"{TEST_DB_FILE}{suffix}")
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass

