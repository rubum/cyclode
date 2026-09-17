from typing import Dict, Any, List, Optional
from app.config import settings
from app.agent.providers.base import BaseLLMProvider
from app.agent.providers.gemini import GeminiProvider
from app.agent.providers.claude import ClaudeProvider
from app.agent.providers.openai import OpenAIProvider


def get_provider_for_model(model_name: Optional[str] = None) -> BaseLLMProvider:
    """
    Factory function returning the specialized BaseLLMProvider instance
    matching the requested model name.
    """
    target = (model_name or settings.ANTIGRAVITY_MODEL or "").lower().strip()
    
    if target.startswith("claude"):
        return ClaudeProvider()
    elif target.startswith(("gpt-", "o1", "o3", "codex", "openai")):
        return OpenAIProvider()
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
                {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "badge": "Fast / Default", "recommended": True},
                {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash", "badge": "Production Flash", "recommended": False},
                {"id": "gemini-2.0-pro", "name": "Gemini 2.0 Pro", "badge": "Deep Reasoning", "recommended": False},
                {"id": "gemini-1.5-flash", "name": "Gemini 1.5 Flash", "badge": "Fast Legacy", "recommended": False}
            ]
        },
        {
            "provider": "anthropic",
            "provider_name": "Anthropic Claude",
            "configured": has_claude,
            "models": [
                {"id": "claude-3-7-sonnet", "name": "Claude 3.7 Sonnet", "badge": "Hybrid Thinking", "recommended": True},
                {"id": "claude-3-5-sonnet", "name": "Claude 3.5 Sonnet", "badge": "Coding Benchmark", "recommended": False},
                {"id": "claude-3-5-haiku", "name": "Claude 3.5 Haiku", "badge": "Lightweight", "recommended": False}
            ]
        },
        {
            "provider": "openai",
            "provider_name": "OpenAI / Codex",
            "configured": has_openai,
            "models": [
                {"id": "gpt-4o", "name": "GPT-4o", "badge": "Omni Multimodal", "recommended": True},
                {"id": "gpt-4o-mini", "name": "GPT-4o Mini", "badge": "Cost Efficient", "recommended": False},
                {"id": "o3-mini", "name": "o3-mini", "badge": "STEM Reasoning", "recommended": False},
                {"id": "codex", "name": "Codex / GPT-4o", "badge": "Code Specialized", "recommended": False}
            ]
        }
    ]
