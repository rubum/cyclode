from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
import httpx


@dataclass
class ToolCallRequest:
    call_id: str
    tool_name: str
    tool_args: Dict[str, Any]
    raw_part: Optional[Dict[str, Any]] = None


@dataclass
class ProviderResponse:
    content: str = ""
    thought: str = ""
    tool_calls: List[ToolCallRequest] = field(default_factory=list)
    raw_parts: Optional[List[Dict[str, Any]]] = None
    finish_reason: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    raw_response: Optional[Dict[str, Any]] = None
    status_code: int = 200
    error_code: Optional[int] = None
    error_message: Optional[str] = None

    @property
    def is_success(self) -> bool:
        return self.status_code == 200 and not self.error_message


class BaseLLMProvider(ABC):
    """
    Abstract base provider contract for multi-turn model communication,
    tool calling protocol translation, and structured planning.
    """

    provider_id: str = "base"

    def get_api_key(self) -> Optional[str]:
        """
        Retrieves the configured API key for this provider.
        """
        if getattr(self, "_api_key", None):
            return self._api_key
        try:
            from app.integrations.manager import integration_manager
            custom = integration_manager.get_custom_credential(self.provider_id, "api_key")
            if custom:
                return custom
        except Exception:
            pass
        return None

    @abstractmethod
    async def generate_response(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]],
        system_instruction: str,
        model_name: str,
        temperature: float = 0.2,
        thinking_budget: Optional[int] = None,
        client: Optional[httpx.AsyncClient] = None
    ) -> ProviderResponse:
        """
        Executes a single model turn against the provider API.
        """
        pass

    @abstractmethod
    async def generate_structured_plan(
        self,
        prompt: str,
        system_instruction: str,
        model_name: str,
        client: Optional[httpx.AsyncClient] = None
    ) -> Dict[str, Any]:
        """
        Generates structured JSON plan output from candidate models.
        """
        pass

    async def generate_structured_json(
        self,
        prompt: str,
        system_instruction: str,
        model_name: str,
        client: Optional[httpx.AsyncClient] = None
    ) -> Dict[str, Any]:
        """
        Generates structured JSON object output from candidate models.
        """
        return await self.generate_structured_plan(
            prompt=prompt,
            system_instruction=system_instruction,
            model_name=model_name,
            client=client
        )

    def estimate_tokens(self, text: str) -> int:
        if not text:
            return 0
        words = len(text.split())
        chars = len(text)
        return max(1, int(max(words * 1.3, chars / 4)))


def normalize_json_schema(schema: Any) -> Any:
    """
    Recursively converts Gemini-style uppercase types (STRING, OBJECT, ARRAY, INTEGER, BOOLEAN, NUMBER)
    into standard RFC JSON Schema types (string, object, array, integer, boolean, number).
    """
    TYPE_MAP = {
        "STRING": "string",
        "OBJECT": "object",
        "ARRAY": "array",
        "INTEGER": "integer",
        "BOOLEAN": "boolean",
        "NUMBER": "number",
    }
    if isinstance(schema, dict):
        normalized = {}
        for k, v in schema.items():
            if k == "type" and isinstance(v, str):
                normalized[k] = TYPE_MAP.get(v.upper(), v.lower())
            elif k == "properties" and isinstance(v, dict):
                normalized[k] = {pk: normalize_json_schema(pv) for pk, pv in v.items()}
            elif k == "items":
                normalized[k] = normalize_json_schema(v)
            elif isinstance(v, (dict, list)):
                normalized[k] = normalize_json_schema(v)
            else:
                normalized[k] = v
        # Standardize object properties
        if normalized.get("type") == "object" and "properties" not in normalized:
            normalized["properties"] = {}
        return normalized
    elif isinstance(schema, list):
        return [normalize_json_schema(item) for item in schema]
    return schema
