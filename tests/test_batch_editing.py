import pytest
import tempfile
import os
from pathlib import Path
from app.agent.tools import WorkspaceTools


@pytest.fixture
def temp_workspace():
    with tempfile.TemporaryDirectory() as tmpdir:
        w_path = Path(tmpdir)

        # File 1: server.py
        (w_path / "server.py").write_text("""
from fastapi import FastAPI

app = FastAPI()

def compute_total(items: list) -> float:
    total = 0.0
    for item in items:
        total += item.price
    return total

def format_currency(val: float) -> str:
    return f"${val:.2f}"
""", encoding="utf-8")

        # File 2: config.py
        (w_path / "config.py").write_text("""
class Settings:
    DEBUG: bool = True
    PORT: int = 8000
    DATABASE_URL: str = "sqlite:///./test.db"
""", encoding="utf-8")

        # File 3: utils.py
        (w_path / "utils.py").write_text("""
def sanitize_name(name: str) -> str:
    return name.strip().lower()

def calculate_discount(price: float, rate: float) -> float:
    return price * (1.0 - rate)
""", encoding="utf-8")

        # File 4: models.py
        (w_path / "models.py").write_text("""
class Item:
    def __init__(self, name: str, price: float):
        self.name = name
        self.price = price
""", encoding="utf-8")

        # File 5: main.py
        (w_path / "main.py").write_text("""
import uvicorn
from server import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
""", encoding="utf-8")

        yield w_path


def test_batch_replace_content_multi_file_success(temp_workspace):
    """Test atomic batch replace across multiple files in a single pass."""
    edits = [
        {
            "file_path": "server.py",
            "target_content": "def compute_total(items: list) -> float:\n    total = 0.0\n    for item in items:\n        total += item.price\n    return total",
            "replacement_content": "def compute_total(items: list, tax_rate: float = 0.0) -> float:\n    subtotal = sum(item.price for item in items)\n    return subtotal * (1.0 + tax_rate)"
        },
        {
            "file_path": "config.py",
            "target_content": '    DATABASE_URL: str = "sqlite:///./test.db"',
            "replacement_content": '    DATABASE_URL: str = "postgresql://user:pass@localhost:5432/prod"\n    REDIS_URL: str = "redis://localhost:6379/0"'
        },
        {
            "file_path": "utils.py",
            "target_content": "def sanitize_name(name: str) -> str:\n    return name.strip().lower()",
            "replacement_content": "def sanitize_name(name: str) -> str:\n    import re\n    return re.sub(r'[^a-zA-Z0-9_]', '', name.strip().lower())"
        },
        {
            "file_path": "models.py",
            "target_content": "class Item:\n    def __init__(self, name: str, price: float):\n        self.name = name\n        self.price = price",
            "replacement_content": "class Item:\n    def __init__(self, name: str, price: float, sku: str = ''):\n        self.name = name\n        self.price = price\n        self.sku = sku"
        },
        {
            "file_path": "main.py",
            "target_content": 'uvicorn.run(app, host="0.0.0.0", port=8000)',
            "replacement_content": 'uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)'
        }
    ]

    res = WorkspaceTools.batch_replace_content(temp_workspace, edits=edits)

    assert res["status"] == "success"
    assert res["modified_files_count"] == 5
    assert res["total_replacements"] == 5
    assert len(res["files_modified"]) == 5

    # Verify disk content for all modified files
    server_code = (temp_workspace / "server.py").read_text(encoding="utf-8")
    assert "tax_rate: float = 0.0" in server_code
    assert "sum(item.price for item in items)" in server_code

    config_code = (temp_workspace / "config.py").read_text(encoding="utf-8")
    assert "postgresql://user:pass@localhost:5432/prod" in config_code
    assert "REDIS_URL" in config_code

    utils_code = (temp_workspace / "utils.py").read_text(encoding="utf-8")
    assert "re.sub(r'[^a-zA-Z0-9_]'" in utils_code

    models_code = (temp_workspace / "models.py").read_text(encoding="utf-8")
    assert "self.sku = sku" in models_code

    main_code = (temp_workspace / "main.py").read_text(encoding="utf-8")
    assert 'reload=True' in main_code


def test_batch_replace_content_atomicity_and_rollback(temp_workspace):
    """Test that if ANY edit fails validation or match, ZERO files are written to disk."""
    initial_server = (temp_workspace / "server.py").read_text(encoding="utf-8")
    initial_config = (temp_workspace / "config.py").read_text(encoding="utf-8")

    edits = [
        {
            "file_path": "server.py",
            "target_content": "def compute_total(items: list) -> float:\n    total = 0.0\n    for item in items:\n        total += item.price\n    return total",
            "replacement_content": "def compute_total(items: list) -> float:\n    return sum(i.price for i in items)"
        },
        {
            "file_path": "config.py",
            "target_content": "NON_EXISTENT_STRING_TRIGGERING_FAILURE_THAT_CANNOT_MATCH",
            "replacement_content": "REPLACEMENT_THAT_SHOULD_NEVER_BE_WRITTEN"
        }
    ]

    res = WorkspaceTools.batch_replace_content(temp_workspace, edits=edits)

    assert "error" in res
    assert "Target content not found" in res["error"] or "config.py" in res["error"]

    # Assert server.py was NOT modified because the batch operation failed atomically
    assert (temp_workspace / "server.py").read_text(encoding="utf-8") == initial_server
    assert (temp_workspace / "config.py").read_text(encoding="utf-8") == initial_config


def test_batch_replace_content_missing_file_rollback(temp_workspace):
    """Test that a non-existent target file causes an immediate failure without touching other files."""
    initial_server = (temp_workspace / "server.py").read_text(encoding="utf-8")

    edits = [
        {
            "file_path": "server.py",
            "target_content": "def compute_total",
            "replacement_content": "def compute_total_v2"
        },
        {
            "file_path": "does_not_exist.py",
            "target_content": "foo",
            "replacement_content": "bar"
        }
    ]

    res = WorkspaceTools.batch_replace_content(temp_workspace, edits=edits)

    assert "error" in res
    assert "not found" in res["error"]
    assert (temp_workspace / "server.py").read_text(encoding="utf-8") == initial_server


def test_batch_replace_path_traversal_prevention(temp_workspace):
    """Test that relative path traversal escaping workspace root is rejected."""
    edits = [
        {
            "file_path": "../../outside.py",
            "target_content": "foo",
            "replacement_content": "bar"
        }
    ]

    res = WorkspaceTools.batch_replace_content(temp_workspace, edits=edits)
    assert "error" in res
    assert "outside workspace" in res["error"]


def test_fuzzy_search_and_replace_indentation_resilience(temp_workspace):
    """Test Tier 3 indentation normalization when target has different indentation level."""
    # server.py has 4-space indentation for format_currency
    res = WorkspaceTools.replace_file_content(
        workspace_path=temp_workspace,
        file_path="server.py",
        target_content="def format_currency(val: float) -> str:\n    return f\"${val:.2f}\"",
        replacement_content="def format_currency(val: float) -> str:\n    return f\"${val:,.2f} USD\""
    )

    assert res["status"] == "replaced"
    content = (temp_workspace / "server.py").read_text(encoding="utf-8")
    assert "USD" in content


def test_fuzzy_search_and_replace_crlf_trailing_whitespace(temp_workspace):
    """Test Tier 2 CRLF and trailing whitespace resilience."""
    # Write a file with CRLF and trailing spaces
    win_file = temp_workspace / "windows.txt"
    win_file.write_bytes(b"hello world   \r\nthis is a test   \r\nfinal line\r\n")

    res = WorkspaceTools.replace_file_content(
        workspace_path=temp_workspace,
        file_path="windows.txt",
        target_content="hello world\nthis is a test\nfinal line",
        replacement_content="hello world!\nthis is an updated test\nfinal line!"
    )

    assert res["status"] == "replaced"
    new_content = win_file.read_text(encoding="utf-8")
    assert "updated test" in new_content


def test_fuzzy_search_and_replace_anchor_fallback(temp_workspace):
    """Test Tier 4 3-line anchor fallback when intermediate lines have minor variations."""
    code_file = temp_workspace / "handler.py"
    code_file.write_text("""
def handle_request(req):
    context = req.get_context()
    user = context.get_user()
    if not user:
        raise PermissionError("Unauthenticated")
    return {"status": 200, "user": user.name}
""", encoding="utf-8")

    # LLM targets the function but has slight whitespace or comment differences in line 3-4
    target = """def handle_request(req):
    context = req.get_context()
    # some LLM thought comments
    user = context.get_user()
    return {"status": 200, "user": user.name}"""

    replacement = """def handle_request(req):
    context = req.get_context()
    user = context.get_user()
    if not user.is_active:
        raise PermissionError("User is disabled")
    return {"status": 200, "user": user.name, "active": True}"""

    res = WorkspaceTools.replace_file_content(
        workspace_path=temp_workspace,
        file_path="handler.py",
        target_content=target,
        replacement_content=replacement
    )

    assert res["status"] == "replaced"
    content = code_file.read_text(encoding="utf-8")
    assert "User is disabled" in content
    assert '"active": True' in content


def test_batch_replace_cow_hardlink_safety(temp_workspace):
    """Test that editing a hardlinked file (st_nlink > 1) unlinks to avoid mutating parent/shared templates."""
    orig_file = temp_workspace / "template.txt"
    orig_file.write_text("BASE TEMPLATE CONTENT", encoding="utf-8")

    hardlink_file = temp_workspace / "linked_copy.txt"
    os.link(orig_file, hardlink_file)

    # Ensure st_nlink > 1
    assert hardlink_file.stat().st_nlink == 2
    assert orig_file.stat().st_ino == hardlink_file.stat().st_ino

    # Run batch replace on hardlink_file
    WorkspaceTools.batch_replace_content(
        temp_workspace,
        edits=[
            {
                "file_path": "linked_copy.txt",
                "target_content": "BASE TEMPLATE CONTENT",
                "replacement_content": "MODIFIED INSTANCE CONTENT"
            }
        ]
    )

    # Assert linked_copy has new content
    assert hardlink_file.read_text(encoding="utf-8") == "MODIFIED INSTANCE CONTENT"
    # Assert orig_file remains untouched because linked_copy was unlinked before write
    assert orig_file.read_text(encoding="utf-8") == "BASE TEMPLATE CONTENT"
    assert orig_file.stat().st_ino != hardlink_file.stat().st_ino


def test_apply_unified_patch(temp_workspace):
    """Test applying a standard unified diff patch."""
    patch_str = """--- server.py
+++ server.py
@@ -1,7 +1,7 @@
 from fastapi import FastAPI

-app = FastAPI()
+app = FastAPI(title="Patched Server API")

 def compute_total(items: list) -> float:
"""
    res = WorkspaceTools.apply_unified_patch(temp_workspace, patch=patch_str)
    assert res["status"] == "success"
    assert len(res["files_modified"]) >= 1

    content = (temp_workspace / "server.py").read_text(encoding="utf-8")
    assert 'title="Patched Server API"' in content
