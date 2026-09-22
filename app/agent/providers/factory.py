from typing import Dict, Any, List, Optional
from app.config import settings
from app.agent.providers.base import BaseLLMProvider
from app.agent.providers.gemini import GeminiProvider
from app.agent.providers.claude import ClaudeProvider
from app.agent.providers.openai import OpenAIProvider


def get_provider_for_model(model_name: Optional[str] = None) -> BaseLLMProvider:
    """
    Factory function returning the specialized BaseLLMProvider instance
    matching the requested model name, supporting explicit provider prefixes,
    frontier models, and custom OpenAI-compatible base URLs.
    """
    target = (model_name or settings.ANTIGRAVITY_MODEL or "").lower().strip()
    
    # Provider prefixes or model family matching
    if target.startswith("anthropic:") or target.startswith("claude") or target.startswith("fable"):
        return ClaudeProvider()
    elif target.startswith(("openai:", "custom:")) or target.startswith(("gpt-", "o1", "o3", "codex", "openai")):
        return OpenAIProvider()
    elif target.startswith(("google:", "gemini:")) or target.startswith("gemini"):
        return GeminiProvider()
    
    # Smart fallback for custom/novel model strings
    if settings.get_openai_api_key() or settings.OPENAI_BASE_URL:
        return OpenAIProvider()
    elif settings.get_anthropic_api_key():
        return ClaudeProvider()
    else:
        return GeminiProvider()


def get_model_catalog() -> List[Dict[str, Any]]:
    """
    Returns the catalog of all supported models grouped by provider with configuration status.
    """
    has_gemini = bool(settings.get_api_key())
    has_claude = bool(settings.get_anthropic_api_key())
    has_openai = bool(settings.get_openai_api_key())

    return [
        {
            "provider": "google",
            "provider_name": "Google Gemini",
            "configured": has_gemini,
            "models": [
                {"id": "gemini-3.7-flash", "name": "Gemini 3.7 Flash", "badge": "Agentic Workhorse", "recommended": True},
                {"id": "gemini-3.8-flash", "name": "Gemini 3.8 Flash", "badge": "Sub-second Agentic", "recommended": False}
            ]
        },
        {
            "provider": "anthropic",
            "provider_name": "Anthropic Claude",
            "configured": has_claude,
            "models": [
                {"id": "claude-fable-5-1", "name": "Claude Fable 5.1", "badge": "Mythos Long-Horizon", "recommended": True},
                {"id": "claude-3-7-sonnet", "name": "Claude 3.7 Sonnet", "badge": "Hybrid Thinking", "recommended": False},
                {"id": "claude-3-5-sonnet", "name": "Claude 3.5 Sonnet", "badge": "Coding Benchmark", "recommended": False},
                {"id": "claude-3-5-haiku", "name": "Claude 3.5 Haiku", "badge": "Fast & Lightweight", "recommended": False}
            ]
        },
        {
            "provider": "openai",
            "provider_name": "OpenAI / Codex",
            "configured": has_openai,
            "models": [
                {"id": "gpt-6-astra", "name": "GPT-6 Astra", "badge": "Frontier Autonomous", "recommended": True},
                {"id": "gpt-4o", "name": "GPT-4o", "badge": "Omni Multimodal", "recommended": False},
                {"id": "o3-mini", "name": "o3-mini", "badge": "STEM Reasoning", "recommended": False},
                {"id": "gpt-4o-mini", "name": "GPT-4o Mini", "badge": "Cost Efficient", "recommended": False},
                {"id": "codex", "name": "Codex / GPT-4o", "badge": "Code Specialized", "recommended": False}
            ]
        }
    ]
