import pytest
from pathlib import Path
from app.agent.skills_discovery import (
    discover_available_skills,
    format_skills_system_prompt,
)


def test_discover_available_skills_finds_repo_skills():
    skills = discover_available_skills()
    assert len(skills) >= 1
    names = [s["name"] for s in skills]
    assert "app-builder" in names or "ui-ux-design" in names or "linear" in names
    for s in skills:
        assert s["name"]
        assert s["description"]
        assert Path(s["path"]).exists()


def test_format_skills_system_prompt():
    mock_skills = [
        {
            "name": "cad-builder",
            "description": "Parametric 3D CAD modeling blueprint and standards.",
            "path": "/path/to/cad-builder/SKILL.md"
        },
        {
            "name": "audio-synth",
            "description": "Web Audio API modular synthesizer blueprints.",
            "path": "/path/to/audio-synth/SKILL.md"
        }
    ]
    prompt = format_skills_system_prompt(mock_skills)
    assert "DYNAMIC SKILL CATALOG" in prompt
    assert "**cad-builder**" in prompt
    assert "Parametric 3D CAD" in prompt
    assert "**audio-synth**" in prompt
    assert "read_file" in prompt


def test_format_skills_system_prompt_empty():
    assert format_skills_system_prompt([]) == ""


def test_custom_workspace_skills_parsed(tmp_path):
    custom_skill_dir = tmp_path / ".agents" / "skills" / "robotics-sim"
    custom_skill_dir.mkdir(parents=True)
    skill_file = custom_skill_dir / "SKILL.md"
    skill_file.write_text(
        "---\n"
        "name: robotics-sim\n"
        "description: Kinematics and URDF robotic simulation blueprint.\n"
        "---\n"
        "# Robotics Sim Guidelines\n",
        encoding="utf-8"
    )

    skills = discover_available_skills(tmp_path)
    names = [s["name"] for s in skills]
    assert "robotics-sim" in names
    rob_skill = next(s for s in skills if s["name"] == "robotics-sim")
    assert "Kinematics" in rob_skill["description"]
