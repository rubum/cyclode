import os
import json
import pytest
import tempfile
from pathlib import Path
import argparse
from unittest.mock import patch, MagicMock

from cyclode.config import (
    get_cyclode_home,
    ensure_cyclode_home,
    load_user_config,
    save_user_config,
    resolve_database_url,
    resolve_workspace_root,
    sync_builtin_skills,
)
from cyclode.cli import cmd_status, cmd_config, main


def test_ensure_cyclode_home_creates_directories():
    with tempfile.TemporaryDirectory() as tmpdir:
        with patch.dict(os.environ, {"CYCLODE_HOME": tmpdir}):
            dirs = ensure_cyclode_home()
            assert dirs["home"].exists()
            assert dirs["data"].exists()
            assert dirs["workspaces"].exists()
            assert dirs["skills"].exists()
            assert dirs["config"].exists()

            # Verify default config written
            cfg = load_user_config()
            assert cfg["version"] == "1.0.0"
            assert cfg["model"] == "gemini-3.7-flash"
            assert cfg["port"] == 8080


def test_save_and_load_user_config():
    with tempfile.TemporaryDirectory() as tmpdir:
        with patch.dict(os.environ, {"CYCLODE_HOME": tmpdir}):
            ensure_cyclode_home()
            save_user_config({"model": "gemini-3.7-flash", "gemini_api_key": "AIzaSyTest123"})
            cfg = load_user_config()
            assert cfg["model"] == "gemini-3.7-flash"
            assert cfg["gemini_api_key"] == "AIzaSyTest123"


def test_resolve_database_and_workspace():
    with tempfile.TemporaryDirectory() as tmpdir:
        env_overrides = {"CYCLODE_HOME": tmpdir}
        with patch.dict(os.environ, env_overrides):
            os.environ.pop("DATABASE_URL", None)
            os.environ.pop("WORKSPACE_ROOT", None)

            # Test custom override
            custom_ws = os.path.join(tmpdir, "custom_ws")
            ws = resolve_workspace_root(custom_ws)
            assert ws == str(Path(custom_ws).resolve())
            assert Path(custom_ws).exists()

            # Test database URL resolution
            db_url = resolve_database_url()
            assert f"{tmpdir}/data/cyclode.db" in db_url


def test_sync_builtin_skills():
    with tempfile.TemporaryDirectory() as tmpdir:
        with patch.dict(os.environ, {"CYCLODE_HOME": tmpdir}):
            dirs = ensure_cyclode_home()
            copied = sync_builtin_skills()
            assert copied >= 0
            # Ensure skills directory exists
            assert dirs["skills"].exists()


def test_cli_config_commands(capsys):
    with tempfile.TemporaryDirectory() as tmpdir:
        with patch.dict(os.environ, {"CYCLODE_HOME": tmpdir}):
            ensure_cyclode_home()

            # 1. Set config
            args_set = argparse.Namespace(action="set", key="test_key", value="hello_world")
            cmd_config(args_set)
            captured = capsys.readouterr()
            assert "Updated test_key = hello_world" in captured.out

            # 2. Get config
            args_get = argparse.Namespace(action="get", key="test_key", value=None)
            cmd_config(args_get)
            captured = capsys.readouterr()
            assert "hello_world" in captured.out

            # 3. List config
            args_list = argparse.Namespace(action="list", key=None, value=None)
            cmd_config(args_list)
            captured = capsys.readouterr()
            assert "hello_world" in captured.out


def test_cli_status(capsys):
    with tempfile.TemporaryDirectory() as tmpdir:
        with patch.dict(os.environ, {"CYCLODE_HOME": tmpdir}):
            args = argparse.Namespace()
            cmd_status(args)
            captured = capsys.readouterr()
            assert "Cyclode Environment & Status" in captured.out
            assert "Version" in captured.out
