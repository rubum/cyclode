import os
import json
import shutil
from pathlib import Path
from typing import Optional, Dict, Any

DEFAULT_SKILLS = ["app-builder", "ui-ux-design", "web-research"]


def get_cyclode_home() -> Path:
    """Returns the root Cyclode configuration and data directory."""
    env_home = os.environ.get("CYCLODE_HOME")
    if env_home:
        return Path(env_home).resolve()
    return (Path.home() / ".cyclode").resolve()


def ensure_cyclode_home() -> Dict[str, Path]:
    """Ensures that the ~/.cyclode structure exists and returns critical directory paths."""
    home = get_cyclode_home()
    data_dir = home / "data"
    workspaces_dir = home / "workspaces"
    skills_dir = home / "skills"
    config_file = home / "config.json"

    for d in [home, data_dir, workspaces_dir, skills_dir]:
        d.mkdir(parents=True, exist_ok=True)

    if not config_file.exists():
        default_cfg = {
            "version": "1.0.0",
            "model": "gemini-3.7-flash",
            "host": "127.0.0.1",
            "port": 8080,
            "auto_browser": True,
        }
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(default_cfg, f, indent=2)

    return {
        "home": home,
        "data": data_dir,
        "workspaces": workspaces_dir,
        "skills": skills_dir,
        "config": config_file,
    }


def load_user_config() -> Dict[str, Any]:
    """Loads configuration from ~/.cyclode/config.json if present."""
    config_file = get_cyclode_home() / "config.json"
    if config_file.exists():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_user_config(updates: Dict[str, Any]) -> Dict[str, Any]:
    """Updates ~/.cyclode/config.json with provided key-values."""
    ensure_cyclode_home()
    config_file = get_cyclode_home() / "config.json"
    current = load_user_config()
    current.update(updates)
    with open(config_file, "w", encoding="utf-8") as f:
        json.dump(current, f, indent=2)
    return current


def sync_builtin_skills() -> int:
    """Copies built-in skills to ~/.cyclode/skills if not already present."""
    dirs = ensure_cyclode_home()
    target_skills = dirs["skills"]

    # Locate source skills: check packaged skills first, then local repo skills
    candidates = [
        Path(__file__).parent / "skills",
        Path(__file__).parent.parent.parent / ".agents" / "skills",
    ]

    source_dir = None
    for c in candidates:
        if c.exists() and c.is_dir():
            source_dir = c
            break

    if not source_dir:
        return 0

    copied = 0
    for item in source_dir.iterdir():
        if item.is_dir():
            dest = target_skills / item.name
            if not dest.exists():
                shutil.copytree(item, dest)
                copied += 1
    return copied


def resolve_database_url() -> str:
    """Resolves the SQLAlchemy database connection URL."""
    env_db = os.environ.get("DATABASE_URL")
    if env_db:
        return env_db
    env_home = os.environ.get("CYCLODE_HOME")
    if env_home:
        dirs = ensure_cyclode_home()
        db_file = dirs["data"] / "cyclode.db"
        return f"sqlite+aiosqlite:///{db_file}"
    if Path("/data").exists() and Path("/data").is_dir():
        return "sqlite+aiosqlite:////data/cyclode.db"
    dirs = ensure_cyclode_home()
    db_file = dirs["data"] / "cyclode.db"
    return f"sqlite+aiosqlite:///{db_file}"


def resolve_workspace_root(override_path: Optional[str] = None) -> str:
    """Resolves active workspace root directory."""
    if override_path:
        p = Path(override_path).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return str(p)
    env_ws = os.environ.get("WORKSPACE_ROOT")
    if env_ws:
        return env_ws
    env_home = os.environ.get("CYCLODE_HOME")
    if env_home:
        dirs = ensure_cyclode_home()
        return str(dirs["workspaces"])
    if Path("/workspaces").exists() and Path("/workspaces").is_dir():
        return "/workspaces"
    dirs = ensure_cyclode_home()
    return str(dirs["workspaces"])
