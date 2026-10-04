from pathlib import Path
from typing import List, Dict, Any, Optional
import re
import yaml
import logging

logger = logging.getLogger(__name__)


def discover_available_skills(workspace_path: Optional[Path] = None) -> List[Dict[str, str]]:
    """
    Discovers available skills dynamically by scanning workspace and platform skill directories.
    Parses YAML frontmatter (name, description) from SKILL.md without any hardcoded skill names.
    """
    skills: List[Dict[str, str]] = []
    seen_names = set()

    search_dirs: List[Path] = []
    if workspace_path and isinstance(workspace_path, Path) and workspace_path.exists():
        search_dirs.append(workspace_path / ".agents" / "skills")
        search_dirs.append(workspace_path / ".skills")

    # Platform / repository level skill directory
    repo_root = Path(__file__).resolve().parents[3]
    search_dirs.append(repo_root / ".agents" / "skills")

    for s_dir in search_dirs:
        if not s_dir.exists() or not s_dir.is_dir():
            continue

        for skill_md in sorted(s_dir.glob("*/SKILL.md")):
            try:
                content = skill_md.read_text(encoding="utf-8", errors="ignore")
                match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
                if match:
                    meta = yaml.safe_load(match.group(1)) or {}
                    name = str(meta.get("name") or skill_md.parent.name).strip()
                    desc = str(meta.get("description") or "").strip().replace("\n", " ")
                    if name and name not in seen_names:
                        skills.append({
                            "name": name,
                            "description": desc,
                            "path": str(skill_md)
                        })
                        seen_names.add(name)
            except Exception as e:
                logger.debug(f"Failed to parse skill frontmatter from {skill_md}: {e}")
                continue

    return skills


def format_skills_system_prompt(skills: List[Dict[str, str]]) -> str:
    """
    Formats the discovered skills catalog into a dynamic Markdown instructions block
    for injection into agent system instructions.
    """
    if not skills:
        return ""

    lines = [
        "DYNAMIC SKILL CATALOG (Domain Blueprints & Procedures):",
        "The following specialized skills are available in the workspace. Each provides comprehensive blueprints, standards, and procedures:",
    ]
    for s in skills:
        lines.append(f"- **{s['name']}** (`{s['path']}`): {s['description']}")

    lines.append(
        "\nIf a task aligns with any of the skills above (e.g. building web apps, UI/UX design, issue resolution), "
        "autonomously inspect its `SKILL.md` using `read_file` to adopt its domain guidelines before proceeding."
    )
    return "\n" + "\n".join(lines) + "\n"
