from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional
import httpx


@dataclass
class ToolCallRequest:
    call_id: str
    tool_name: str
    tool_args: Dict[str, Any]


@dataclass
class ProviderResponse:
    content: str = ""
    thought: str = ""
    tool_calls: List[ToolCallRequest] = field(default_factory=list)
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

    def estimate_tokens(self, text: str) -> int:
        if not text:
            return 0
        words = len(text.split())
        chars = len(text)
        return max(1, int(max(words * 1.3, chars / 4)))
