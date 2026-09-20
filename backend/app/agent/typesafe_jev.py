import time
import logging
from typing import Dict, Any, List, Optional, Union
from pydantic import BaseModel, Field
import httpx
from app.config import settings

logger = logging.getLogger("cyclode.typesafe_jev")


def choice(instructions: str, criteria: Union[Dict[str, str], List[str]]) -> Dict[str, Any]:
    if isinstance(criteria, list):
        crit_dict = {opt: opt for opt in criteria}
    else:
        crit_dict = criteria
    return {
        "type": "choice",
        "instructions": instructions,
        "criteria": crit_dict
    }


def score(instructions: str, criteria: List[str]) -> Dict[str, Any]:
    return {
        "type": "score",
        "instructions": instructions,
        "criteria": criteria
    }


def noul(instructions: str) -> Dict[str, Any]:
    return {
        "type": "noul",
        "instructions": instructions
    }


class SystemOneResult(BaseModel):
    state: str
    answers: Dict[str, Any]
    latency_ms: float
    model: str = "jev-latest"
    usage: Dict[str, int] = Field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0})
    cost_usd: float = 0.0


class TypeSafeJevClient:
    """
    Direct client for TypeSafe AI's Jev System One model.
    Sends parallel question batches to the live TypeSafe API endpoint.
    """

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.api_key = api_key or settings.get_typesafe_api_key()
        self.base_url = (base_url or settings.TYPESAFE_BASE_URL).rstrip("/")

    def is_configured(self) -> bool:
        key = self.api_key or settings.get_typesafe_api_key()
        return bool(key and len(key.strip()) > 5)

    async def system_one(
        self,
        state: str,
        questions: Dict[str, Any],
        model: str = "jev-latest",
        timeout: float = 8.0
    ) -> SystemOneResult:
        """
        Executes a System One decision batch across multiple typed questions in parallel
        against the live TypeSafe AI API endpoint.
        """
        active_key = self.api_key or settings.get_typesafe_api_key()
        if not active_key:
            raise ValueError("TypeSafe API Key is not configured. Please set TYPESAFE_API_KEY in Integrations.")

        start_time = time.perf_counter()
        token_count = max(1, len(state.split()) + 15)

        payload = {
            "model": model,
            "state": state,
            "questions": questions
        }
        headers = {
            "Authorization": f"Bearer {active_key}",
            "Content-Type": "application/json",
            "User-Agent": "Cyclode-Harness/1.0 (@typesafe-ai/sdk)"
        }

        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{self.base_url}/systemone", json=payload, headers=headers)
            elapsed_ms = (time.perf_counter() - start_time) * 1000.0

            if resp.status_code == 200:
                data = resp.json()
                usage_info = data.get("usage", {"input_tokens": token_count, "output_tokens": 0})
                actual_input = usage_info.get("input_tokens", token_count)
                actual_cost = (actual_input / 1_000_000) * 0.042

                return SystemOneResult(
                    state=state,
                    answers=data.get("answers", {}),
                    latency_ms=round(elapsed_ms, 2),
                    model=data.get("model", model),
                    usage=usage_info,
                    cost_usd=round(actual_cost, 7)
                )
            else:
                error_detail = resp.text
                logger.error(f"TypeSafe API Error (HTTP {resp.status_code}): {error_detail}")
                raise RuntimeError(f"TypeSafe API returned HTTP {resp.status_code}: {error_detail}")


typesafe_client = TypeSafeJevClient()
