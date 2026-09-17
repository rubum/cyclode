import pytest
from app.agent.personas import get_persona, PERSONAS
from app.agent.title_generator import generate_heuristic_title


def test_app_builder_persona_registered():
    assert "AppBuilder" in PERSONAS
    persona = get_persona("AppBuilder")
    assert persona["name"] == "AppBuilder"
    assert "Fullstack" in persona["description"] or "App Builder" in persona["description"]
    assert "5-STAGE" in persona["system_instructions"] or "5-Stage" in persona["system_instructions"]
    assert "index.html" in persona["system_instructions"]
    assert "FastAPI" in persona["system_instructions"]
    assert "Communication & Synthesis Standards" in persona["system_instructions"]


def test_app_builder_title_heuristics():
    title1 = generate_heuristic_title("Build an ecommerce app with both storefront and admin portal")
    assert "Build" in title1 or "Ecommerce" in title1

    title2 = generate_heuristic_title("Please create a real-time cryptocurrency analytics dashboard")
    assert "Cryptocurrency" in title2 or "Dashboard" in title2 or "Create" in title2
