import json
import logging
import asyncio
from typing import Dict, Any, List, Optional
import httpx

from app.config import settings
from app.agent.providers.base import BaseLLMProvider, ProviderResponse, ToolCallRequest, normalize_json_schema

logger = logging.getLogger("cyclode.providers.openai")


class OpenAIProvider(BaseLLMProvider):
    provider_id: str = "openai"

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self._api_key = api_key
        self._base_url = base_url

    def get_api_key(self) -> Optional[str]:
        return self._api_key or settings.get_openai_api_key()

    def get_base_url(self) -> str:
        return (self._base_url or settings.OPENAI_BASE_URL or "https://api.openai.com/v1").rstrip("/")

    def _convert_tool_declarations(self, tools: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        """
        Translates standard function declarations into OpenAI format:
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
        Translates Cyclode/Gemini formatted parts into OpenAI chat completions messages.
        Ensures strict compliance with OpenAI tool calling protocol:
        - Assistant turns with tool_calls must be immediately followed by role: 'tool' messages
          responding to each tool_call_id.
        - Orphaned tool_calls or mismatched tool responses are reconciled automatically.
        """
        raw_msgs = []
        if system_instruction:
            raw_msgs.append({"role": "system", "content": system_instruction})

        tool_id_counter = 0

        for m in messages:
            role = m.get("role", "user")
            parts = m.get("parts", [])
            if parts:
                text_parts = []
                tool_calls = []
                tool_responses = []
                for p in parts:
                    if isinstance(p, str):
                        if p.strip():
                            text_parts.append(p)
                        continue
                    if not isinstance(p, dict):
                        continue

                    if "text" in p and p["text"]:
                        text_parts.append(str(p["text"]))
                    elif "content" in p and p["content"] and isinstance(p["content"], str):
                        text_parts.append(str(p["content"]))
                    elif "functionCall" in p:
                        fc = p["functionCall"]
                        fn_name = fc.get("name", "")
                        fn_args = fc.get("args", {})
                        tool_id_counter += 1
                        call_id = fc.get("id") or f"call_{tool_id_counter}_{fn_name}"
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
                            if isinstance(tc, dict):
                                tc_id = tc.get("id")
                                if not tc_id:
                                    tool_id_counter += 1
                                    fn_name = tc.get("function", {}).get("name", "tool")
                                    tc["id"] = f"call_{tool_id_counter}_{fn_name}"
                                tool_calls.append(tc)
                    elif p.get("type") == "tool_use":
                        tool_id_counter += 1
                        tool_calls.append({
                            "id": p.get("id") or f"call_{tool_id_counter}_{p.get('name', 'tool')}",
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
                        out_str = resp_data.get("output") or resp_data.get("stdout") or (json.dumps(resp_data) if isinstance(resp_data, (dict, list)) else str(resp_data))
                        tool_responses.append({
                            "role": "tool",
                            "tool_call_id": call_id,
                            "name": fn_name,
                            "content": str(out_str)
                        })
                    elif p.get("role") == "tool" or p.get("type") == "tool_result":
                        call_id = p.get("tool_call_id") or p.get("tool_use_id") or ""
                        content_val = p.get("content", "")
                        tool_responses.append({
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": str(content_val)
                        })
                    elif "thought" in p and p["thought"]:
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
                        raw_msgs.append(msg_obj)
                elif role == "user":
                    if tool_responses:
                        raw_msgs.extend(tool_responses)
                    if text_parts:
                        raw_msgs.append({"role": "user", "content": "\n".join(text_parts)})
            else:
                openai_role = "assistant" if role in ["model", "assistant", "agent"] else "user"
                content_str = m.get("content", "")
                thought_str = m.get("thought", "")
                full_text = ""
                if thought_str:
                    full_text += f"<thought>{thought_str}</thought>\n"
                full_text += content_str
                if full_text.strip():
                    raw_msgs.append({"role": openai_role, "content": full_text.strip()})

        # Strict Protocol Reconciliation
        reconciled_msgs = []
        i = 0
        while i < len(raw_msgs):
            current = raw_msgs[i]

            if current.get("role") == "assistant" and current.get("tool_calls"):
                req_tool_calls = current["tool_calls"]
                expected_ids = [tc.get("id") for tc in req_tool_calls if tc.get("id")]

                tool_resp_msgs = []
                j = i + 1
                while j < len(raw_msgs) and raw_msgs[j].get("role") == "tool":
                    tool_resp_msgs.append(raw_msgs[j])
                    j += 1

                if not tool_resp_msgs:
                    if current.get("content"):
                        clean_assistant = dict(current)
                        clean_assistant.pop("tool_calls", None)
                        reconciled_msgs.append(clean_assistant)
                    else:
                        reconciled_msgs.append(current)
                        for tc in req_tool_calls:
                            tc_id = tc.get("id", "call_default")
                            reconciled_msgs.append({
                                "role": "tool",
                                "tool_call_id": tc_id,
                                "content": "Acknowledged."
                            })
                    i = j
                    continue
                else:
                    reconciled_msgs.append(current)
                    responded_ids = set()
                    for idx, tr in enumerate(tool_resp_msgs):
                        tr_id = tr.get("tool_call_id")
                        if (not tr_id or tr_id not in expected_ids) and idx < len(expected_ids):
                            tr_id = expected_ids[idx]
                        responded_ids.add(tr_id)
                        clean_tr = {
                            "role": "tool",
                            "tool_call_id": tr_id or (expected_ids[0] if expected_ids else "call_default"),
                            "content": tr.get("content", "")
                        }
                        reconciled_msgs.append(clean_tr)

                    for tc in req_tool_calls:
                        tc_id = tc.get("id")
                        if tc_id and tc_id not in responded_ids:
                            reconciled_msgs.append({
                                "role": "tool",
                                "tool_call_id": tc_id,
                                "content": "Tool execution completed."
                            })
                    i = j
                    continue

            elif current.get("role") == "tool":
                reconciled_msgs.append({
                    "role": "user",
                    "content": f"[Tool Output]: {current.get('content', '')}"
                })
                i += 1
            else:
                if current.get("role") == "assistant" and current.get("content") is None and not current.get("tool_calls"):
                    current = dict(current)
                    current["content"] = "Execution in progress."
                reconciled_msgs.append(current)
                i += 1

        return reconciled_msgs

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
                error_message="OpenAI API Key is missing or unconfigured."
            )

        base_url = self.get_base_url()
        openai_tools = self._convert_tool_declarations(tools)
        openai_messages = self._convert_messages(messages, system_instruction)

        # Normalize model
        clean_model = model_name.replace("openai:", "").replace("custom:", "").strip() if model_name else "gpt-6-astra"
        if clean_model in ["codex", "openai-codex"]:
            clean_model = "gpt-4o"

        is_reasoning_model = any(sub in clean_model.lower() for sub in ["o1", "o3", "reasoning"])
        payload: Dict[str, Any] = {
            "model": clean_model,
            "messages": openai_messages,
        }
        if is_reasoning_model:
            payload["max_completion_tokens"] = 8192
        else:
            payload["max_tokens"] = 8192
            payload["temperature"] = temperature

        if openai_tools:
            payload["tools"] = openai_tools
            payload["tool_choice"] = "auto"

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
                    error_message=f"OpenAI API Error: {err_msg}",
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
                error_message=f"OpenAI connection error: {str(e)}"
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
                "error": "OpenAI API Key is missing or unconfigured.",
                "status_code": 401
            }

        candidate_models = list(dict.fromkeys([
            model_name,
            "gpt-6-astra",
            "gpt-4o",
            "o3-mini",
            "gpt-4o-mini"
        ]))

        base_url = self.get_base_url()
        should_close = False
        if client is None:
            client = httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0, read=45.0))
            should_close = True

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        last_error = "Model response unavailable"
        try:
            for active_model in candidate_models:
                clean_model = active_model.replace("openai:", "").replace("custom:", "").strip() if active_model else "gpt-6-astra"
                if clean_model in ["codex", "openai-codex"]:
                    clean_model = "gpt-4o-mini"

                is_reasoning = any(sub in clean_model.lower() for sub in ["o1", "o3", "reasoning"])
                payload = {
                    "model": clean_model,
                    "messages": [
                        {"role": "system", "content": (system_instruction or "") + "\nRespond ONLY with a valid JSON object."},
                        {"role": "user", "content": prompt}
                    ],
                    "response_format": {"type": "json_object"}
                }
                if is_reasoning:
                    payload["max_completion_tokens"] = 8192
                else:
                    payload["max_tokens"] = 8192
                    payload["temperature"] = 0.2

                try:
                    resp = await asyncio.wait_for(
                        client.post(f"{base_url}/chat/completions", json=payload, headers=headers),
                        timeout=30.0
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
                    err_detail = str(e).strip() if str(e).strip() else (f"{type(e).__name__} (Timed out after 30s)" if isinstance(e, (asyncio.TimeoutError, TimeoutError)) else type(e).__name__)
                    last_error = f"Model {active_model} error: {err_detail[:120]}"

            return {"error": last_error, "status_code": 500}
        finally:
            if should_close:
                await client.aclose()
