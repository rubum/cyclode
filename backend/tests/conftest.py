import os
import uuid
from pathlib import Path
import pytest
import pytest_asyncio

# Force isolated test SQLite database BEFORE loading any app modules
TEST_DB_FILE = Path(f"/tmp/cyclode_test_{uuid.uuid4().hex[:8]}.db")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DB_FILE}"
os.environ["DEBUG"] = "false"
os.environ["GIT_TERMINAL_PROMPT"] = "0"
os.environ["GIT_CONFIG_GLOBAL"] = "/dev/null"
os.environ.setdefault("GEMINI_API_KEY", "test-mock-gemini-key")

from app.db.session import init_db, engine
from app.config import settings
settings.GEMINI_API_KEY = settings.GEMINI_API_KEY or "test-mock-gemini-key"


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

