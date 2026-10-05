import pytest
from app.agent.personas import PERSONAS, PERSONA_ALIASES, get_persona
from app.agent.harness import antigravity_harness, Harness


def test_persona_general_is_default():
    # Unknown persona defaults to General
    unknown = get_persona("non_existent_persona")
    assert unknown["name"] == "General"

    # Default persona from empty string
    empty = get_persona("")
    assert empty["name"] == "General"

    # Direct retrieval
    general = get_persona("General")
    assert general["name"] == "General"
    assert "DYNAMIC INTENT-ALIGNED EXECUTION" in general["system_instructions"]
    assert "Zero-Ghost-File & Pure Research Invariant" in general["system_instructions"]


def test_persona_general_aliases():
    for alias in ["general", "assistant", "default", "universal"]:
        p = get_persona(alias)
        assert p["name"] == "General"


def test_persona_zero_ghost_file_invariant_in_all_personas():
    for name, persona in PERSONAS.items():
        instructions = persona["system_instructions"]
        assert "Zero-Ghost-File & Pure Research Invariant" in instructions
        assert "NEVER manufacture unnecessary workspace files" in instructions


def test_persona_zero_internal_leakage_invariant_in_all_personas():
    for name, persona in PERSONAS.items():
        instructions = persona["system_instructions"]
        assert "Zero-Internal-Leakage & Professional Peer Invariant" in instructions
        assert "Strictly External Peer Perspective" in instructions
        assert "Zero Environment Excuses" in instructions
        assert "Zero Action Diary / Shell Narration" in instructions
        assert "Zero Chain-of-Thought Residue" in instructions


def test_persona_dynamic_visualization_standards_in_all_personas():
    for name, persona in PERSONAS.items():
        instructions = persona["system_instructions"]
        assert "Dynamic In-Chat Visualization & Diagramming Standards" in instructions
        assert "```chart" in instructions
        assert "```mermaid" in instructions


def test_infer_task_intent_general_persona():
    # Q&A / URL queries with General persona
    assert Harness.infer_task_intent("Summarize URL", "Summarize this https://gemini.google.com/updates", "General") == "qa_research"
    assert Harness.infer_task_intent("Explain Concept", "Explain how vector search works in sqlite-vec", "General") == "qa_research"
    assert Harness.infer_task_intent("Compare Frameworks", "Compare FastAPI and Axum performance", "General") == "qa_research"

    # Code tasks with General persona
    assert Harness.infer_task_intent("Build Landing Page", "Build an interactive landing page in index.html", "General") == "app_building"
    assert Harness.infer_task_intent("Refactor Auth", "Refactor the auth middleware in backend/app/auth.py", "General") == "code_modification"


def test_dynamic_plan_qa_research_sanitization():
    # Verify that plan phases for qa_research strip any hallucinated file touchpoints
    raw_phases = [
        {
            "phase": "Phase 1: Fetch and Analyze Documentation",
            "objective": "Retrieve the latest release documentation from external endpoint",
            "file_touchpoints": ["source.md", "summary.md"],
            "verification_criteria": "Run pytest on summary.md"
        }
    ]

    sanitized = Harness.sanitize_plan_phases(raw_phases, intent_category="qa_research")
    assert len(sanitized) == 1
    assert sanitized[0]["file_touchpoints"] == []
    assert sanitized[0]["verification_criteria"] == "Factual verification in direct chat response."
