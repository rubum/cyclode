import pytest
import pytest_asyncio
from app.db.session import init_db


@pytest.fixture(autouse=True, scope="session")
def anyio_backend():
    return "asyncio"


@pytest_asyncio.fixture(autouse=True)
async def initialize_test_database():
    await init_db()
