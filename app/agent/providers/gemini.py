import json
import logging
import asyncio
from typing import Dict, Any, List, Optional
import httpx

from app.config import settings
from app.agent.providers.base import BaseLLMProvider, ProviderResponse, ToolCallRequest

logger = logging.getLogger("cyclode.providers.gemini")


class GeminiProvider(BaseLLMProvider):
    provider_id: str = "gemini"

    def __init__(self, api_key: Optional[str] = None):
        self._api_key = api_key

    def get_api_key(self) -> Optional[str]:
        return self._api_key or settings.get_api_key()

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
        api_key = self.get_api_key()
        if not api_key:
            return ProviderResponse(
                status_code=401,
                error_code=401,
                error_message="Gemini API Key is missing or unconfigured."
            )

        clean_model = model_name.replace("google:", "").replace("gemini:", "").strip() if model_name else "gemini-3.7-flash"
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{clean_model}:generateContent?key={api_key}"
        
        # Tools structure for Gemini
        active_tools = None
        if tools:
            # If already wrapped in function_declarations format or list of functions
            if isinstance(tools, list) and len(tools) > 0 and "function_declarations" in tools[0]:
                active_tools = tools
            else:
                active_tools = [{"function_declarations": tools}]

        payload: Dict[str, Any] = {
            "contents": messages,
            "system_instruction": {"parts": [{"text": system_instruction}]},
            "generationConfig": {
                "temperature": temperature
            }
        }
        if active_tools:
            payload["tools"] = active_tools

        should_close = False
        if client is None:
            client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0, read=120.0))
            should_close = True

        try:
            resp = await client.post(api_url, json=payload)
            if resp.status_code != 200:
                err_msg = f"HTTP {resp.status_code}"
                try:
                    err_json = resp.json()
                    err_msg = err_json.get("error", {}).get("message", getattr(resp, "text", "")[:150])
                except Exception:
                    if getattr(resp, "text", None):
                        err_msg = resp.text[:150]
                
                raw_resp = None
                try:
                    resp_headers = getattr(resp, "headers", {})
                    if hasattr(resp_headers, "get") and resp_headers.get("content-type", "").startswith("application/json"):
                        raw_resp = resp.json()
                    elif not hasattr(resp, "headers"):
                        raw_resp = resp.json()
                except Exception:
                    pass

                return ProviderResponse(
                    status_code=resp.status_code,
                    error_code=resp.status_code,
                    error_message=err_msg,
                    raw_response=raw_resp
                )

            data = resp.json()
            candidates = data.get("candidates", [])
            if not candidates:
                return ProviderResponse(
                    content="",
                    status_code=200,
                    raw_response=data
                )

            cand = candidates[0]
            parts = cand.get("content", {}).get("parts", [])
            finish_reason = cand.get("finishReason")
            
            thoughts = []
            contents = []
            tool_calls = []

            for part in parts:
                if "thought" in part and part["thought"]:
                    thoughts.append(part["thought"])
                if "text" in part and part["text"]:
                    text_val = part["text"]
                    if "<thought>" in text_val and "</thought>" in text_val:
                        th_match = text_val.split("<thought>")[1].split("</thought>")[0]
                        thoughts.append(th_match.strip())
                        text_val = text_val.replace(f"<thought>{th_match}</thought>", "").strip()
                    if text_val:
                        contents.append(text_val)
                if "functionCall" in part:
                    fc = part["functionCall"]
                    fn_name = fc.get("name", "")
                    fn_args = fc.get("args", {})
                    call_id = f"call_{len(tool_calls)+1}_{fn_name}"
                    tool_calls.append(ToolCallRequest(
                        call_id=call_id,
                        tool_name=fn_name,
                        tool_args=fn_args
                    ))

            usage = data.get("usageMetadata", {})
            input_tokens = usage.get("promptTokenCount", 0)
            output_tokens = usage.get("candidatesTokenCount", 0)

            return ProviderResponse(
                content="\n".join(contents),
                thought="\n".join(thoughts),
                tool_calls=tool_calls,
                finish_reason=finish_reason,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                raw_response=data,
                status_code=200
            )
        except Exception as e:
            return ProviderResponse(
                status_code=500,
                error_code=500,
                error_message=f"Gemini connection error: {str(e)}"
            )
        finally:
            if should_close:
                await client.aclose()

    async def generate_structured_plan(
        self,
        prompt: str,
        system_instruction: str,
        model_name: str,
        client: Optional[httpx.AsyncClient] = None
    ) -> Dict[str, Any]:
        api_key = self.get_api_key()
        if not api_key:
            return {
                "error": "Gemini API Key is missing or unconfigured.",
                "status_code": 401
            }

        clean_initial = model_name.replace("google:", "").replace("gemini:", "").strip() if model_name else "gemini-3.7-flash"
        initial_candidates = [clean_initial, "gemini-3.7-flash", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.0-flash"]
        candidate_models = list(dict.fromkeys([m for m in initial_candidates if m and m != "gemini-1.5-pro"]))
        if not candidate_models:
            candidate_models = ["gemini-3.7-flash", "gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.0-flash"]
        should_close = False
        if client is None:
            client = httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0, read=15.0))
            should_close = True

        last_error = "Model response unavailable"
        try:
            for active_model in candidate_models:
                if not active_model:
                    continue
                dynamic_url = f"https://generativelanguage.googleapis.com/v1beta/models/{active_model}:generateContent?key={api_key}"
                payload = {
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "response_mime_type": "application/json",
                        "temperature": 0.2
                    }
                }
                if system_instruction:
                    payload["system_instruction"] = {"parts": [{"text": system_instruction}]}

                try:
                    resp = await asyncio.wait_for(client.post(dynamic_url, json=payload), timeout=6.0)
                    if resp.status_code == 200:
                        data = resp.json()
                        candidates = data.get("candidates", [])
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            raw_text = "".join(p.get("text", "") for p in parts if "text" in p).strip()
                            if raw_text:
                                parsed = json.loads(raw_text)
                                return {"result": parsed, "model": active_model}
                    else:
                        err_msg = f"HTTP {resp.status_code}"
                        try:
                            err_json = resp.json()
                            err_msg = err_json.get("error", {}).get("message", resp.text[:120])
                        except Exception:
                            if resp.text:
                                err_msg = resp.text[:120]
                        last_error = f"Model {active_model} returned HTTP {resp.status_code}: {err_msg}"
                except Exception as e:
                    last_error = f"Model {active_model} error: {str(e)[:100]}"
            
            return {"error": last_error, "status_code": 500}
        finally:
            if should_close:
                await client.aclose()
