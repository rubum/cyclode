import json
import logging
import asyncio
from typing import Dict, Any, List, Optional
import httpx

from app.config import settings
from app.agent.providers.base import BaseLLMProvider, ProviderResponse, ToolCallRequest, normalize_json_schema

logger = logging.getLogger("cyclode.providers.deepseek")


class DeepSeekProvider(BaseLLMProvider):
    provider_id: str = "deepseek"

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self._api_key = api_key
        self._base_url = base_url

    def get_api_key(self) -> Optional[str]:
        return self._api_key or settings.get_deepseek_api_key()

    def get_base_url(self) -> str:
        return (self._base_url or settings.DEEPSEEK_BASE_URL or "https://api.deepseek.com").rstrip("/")

    def _convert_tool_declarations(self, tools: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        """
        Translates standard function declarations into OpenAI/DeepSeek format:
        { "type": "function", "function": { "name": ..., "description": ..., "parameters": { ... } } }
        """
        if not tools:
            return []

        converted = []
        raw_list = []
        for t in tools:
            if "function_declarations" in t:
                raw_list.extend(t["function_declarations"])
            elif "function" in t:
                raw_list.append(t["function"])
            else:
                raw_list.append(t)

        for fn in raw_list:
            raw_params = fn.get("parameters") or fn.get("input_schema") or {"type": "object", "properties": {}}
            converted.append({
                "type": "function",
                "function": {
                    "name": fn.get("name", ""),
                    "description": fn.get("description", ""),
                    "parameters": normalize_json_schema(raw_params)
                }
            })
        return converted

    def _convert_messages(self, messages: List[Dict[str, Any]], system_instruction: str) -> List[Dict[str, Any]]:
        """
        Translates Cyclode/Gemini formatted parts into DeepSeek chat completions messages.
        Ensures strict compliance with OpenAI/DeepSeek tool calling protocol:
        Assistant turn with tool_calls is immediately followed by role: 'tool' messages with matching tool_call_id.
        """
        converted_msgs = []
        if system_instruction:
            converted_msgs.append({"role": "system", "content": system_instruction})

        for m in messages:
            role = m.get("role", "user")
            parts = m.get("parts", [])
            if parts:
                text_parts = []
                tool_calls = []
                tool_responses = []
                for p in parts:
                    if not isinstance(p, dict):
                        continue
                    if "text" in p and p["text"]:
                        text_parts.append(p["text"])
                    elif "functionCall" in p:
                        fc = p["functionCall"]
                        fn_name = fc.get("name", "")
                        fn_args = fc.get("args", {})
                        call_id = fc.get("id") or f"call_{fn_name}"
                        tool_calls.append({
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": fn_name,
                                "arguments": json.dumps(fn_args) if isinstance(fn_args, dict) else str(fn_args)
                            }
                        })
                    elif "tool_calls" in p and isinstance(p["tool_calls"], list):
                        for tc in p["tool_calls"]:
                            tool_calls.append(tc)
                    elif p.get("type") == "tool_use":
                        tool_calls.append({
                            "id": p.get("id", f"call_{p.get('name', 'tool')}"),
                            "type": "function",
                            "function": {
                                "name": p.get("name", ""),
                                "arguments": json.dumps(p.get("input", {})) if isinstance(p.get("input"), dict) else str(p.get("input", "{}"))
                            }
                        })
                    elif "functionResponse" in p:
                        fr = p["functionResponse"]
                        fn_name = fr.get("name", "")
                        call_id = fr.get("id") or f"call_{fn_name}"
                        resp_data = fr.get("response", {})
                        out_str = resp_data.get("output") or resp_data.get("stdout") or json.dumps(resp_data)
                        tool_responses.append({
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": str(out_str)
                        })
                    elif p.get("role") == "tool" or p.get("type") == "tool_result":
                        call_id = p.get("tool_call_id") or p.get("tool_use_id", "")
                        content_val = p.get("content", "")
                        tool_responses.append({
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": str(content_val)
                        })
                    elif "thought" in p and p["thought"]:
                        # Chain-of-thought in assistant turns
                        pass

                if role in ["model", "assistant"]:
                    msg_obj: Dict[str, Any] = {"role": "assistant"}
                    if text_parts:
                        msg_obj["content"] = "\n".join(text_parts)
                    elif tool_calls:
                        msg_obj["content"] = None
                    if tool_calls:
                        msg_obj["tool_calls"] = tool_calls
                    if msg_obj.get("content") is not None or "tool_calls" in msg_obj:
                        converted_msgs.append(msg_obj)
                elif role == "user":
                    if tool_responses:
                        converted_msgs.extend(tool_responses)
                    if text_parts:
                        converted_msgs.append({"role": "user", "content": "\n".join(text_parts)})
            else:
                agent_role = "assistant" if role in ["model", "assistant", "agent"] else "user"
                content_str = m.get("content", "")
                thought_str = m.get("thought", "")
                full_text = ""
                if thought_str:
                    full_text += f"<thought>{thought_str}</thought>\n"
                full_text += content_str
                if full_text.strip():
                    converted_msgs.append({"role": agent_role, "content": full_text.strip()})

        return converted_msgs

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
                error_message="DeepSeek API Key is missing or unconfigured."
            )

        base_url = self.get_base_url()
        ds_tools = self._convert_tool_declarations(tools)
        ds_messages = self._convert_messages(messages, system_instruction)

        # Normalize model identifier
        clean_model = model_name.replace("deepseek:", "").strip() if model_name else "deepseek-flash"
        if not clean_model:
            clean_model = "deepseek-flash"

        payload: Dict[str, Any] = {
            "model": clean_model,
            "messages": ds_messages,
        }
        if ds_tools:
            payload["tools"] = ds_tools
            payload["tool_choice"] = "auto"

        # Reasoning models (e.g. DeepSeek-R1 / deepseek-reasoner) do not use custom temperature
        is_reasoning_model = "reasoner" in clean_model.lower() or "r1" in clean_model.lower()
        if not is_reasoning_model:
            payload["temperature"] = temperature

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        should_close = False
        if client is None:
            client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0, read=120.0))
            should_close = True

        api_url = f"{base_url}/chat/completions"
        try:
            resp = await client.post(api_url, json=payload, headers=headers)
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
                    error_message=f"DeepSeek API Error: {err_msg}",
                    raw_response=raw_resp
                )

            data = resp.json()
            choices = data.get("choices", [])
            if not choices:
                return ProviderResponse(
                    content="",
                    status_code=200,
                    raw_response=data
                )

            choice = choices[0]
            msg = choice.get("message", {})
            finish_reason = choice.get("finish_reason")

            thoughts = []
            if "reasoning_content" in msg and msg["reasoning_content"]:
                thoughts.append(msg["reasoning_content"])

            content_text = msg.get("content") or ""
            if "<thought>" in content_text and "</thought>" in content_text:
                th_match = content_text.split("<thought>")[1].split("</thought>")[0]
                thoughts.append(th_match.strip())
                content_text = content_text.replace(f"<thought>{th_match}</thought>", "").strip()

            if "<think>" in content_text and "</think>" in content_text:
                th_match = content_text.split("<think>")[1].split("</think>")[0]
                thoughts.append(th_match.strip())
                content_text = content_text.replace(f"<think>{th_match}</think>", "").strip()

            tool_calls = []
            for tc in msg.get("tool_calls", []):
                call_id = tc.get("id", f"call_{len(tool_calls)+1}")
                fn = tc.get("function", {})
                fn_name = fn.get("name", "")
                raw_args = fn.get("arguments", "{}")
                try:
                    parsed_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except Exception:
                    parsed_args = {}
                tool_calls.append(ToolCallRequest(
                    call_id=call_id,
                    tool_name=fn_name,
                    tool_args=parsed_args,
                    raw_part=tc
                ))

            usage = data.get("usage", {})
            input_tokens = usage.get("prompt_tokens", 0)
            output_tokens = usage.get("completion_tokens", 0)

            return ProviderResponse(
                content=content_text,
                thought="\n".join(thoughts),
                tool_calls=tool_calls,
                raw_parts=[msg] if msg else None,
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
                error_message=f"DeepSeek connection error: {str(e)}"
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
                "error": "DeepSeek API Key is missing or unconfigured.",
                "status_code": 401
            }

        candidate_models = list(dict.fromkeys([
            model_name,
            "deepseek-flash",
            "deepseek-chat"
        ]))

        base_url = self.get_base_url()
        should_close = False
        if client is None:
            client = httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0, read=15.0))
            should_close = True

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        last_error = "Model response unavailable"
        try:
            for active_model in candidate_models:
                clean_model = active_model.replace("deepseek:", "").strip() if active_model else "deepseek-flash"

                payload = {
                    "model": clean_model,
                    "messages": [
                        {"role": "system", "content": (system_instruction or "") + "\nRespond ONLY with a valid JSON object."},
                        {"role": "user", "content": prompt}
                    ],
                    "response_format": {"type": "json_object"}
                }
                if not ("reasoner" in clean_model.lower() or "r1" in clean_model.lower()):
                    payload["temperature"] = 0.2

                try:
                    resp = await asyncio.wait_for(
                        client.post(f"{base_url}/chat/completions", json=payload, headers=headers),
                        timeout=8.0
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        choices = data.get("choices", [])
                        if choices:
                            raw_text = choices[0].get("message", {}).get("content", "").strip()
                            if raw_text:
                                parsed = json.loads(raw_text)
                                return {"result": parsed, "model": clean_model}
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
