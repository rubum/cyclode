import json
import logging
import asyncio
from typing import Dict, Any, List, Optional
import httpx

from app.config import settings
from app.agent.providers.base import BaseLLMProvider, ProviderResponse, ToolCallRequest, normalize_json_schema

logger = logging.getLogger("cyclode.providers.claude")


class ClaudeProvider(BaseLLMProvider):
    provider_id: str = "anthropic"

    def __init__(self, api_key: Optional[str] = None):
        self._api_key = api_key

    def get_api_key(self) -> Optional[str]:
        return self._api_key or settings.get_anthropic_api_key()

    def _convert_tool_declarations(self, tools: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        """
        Translates standard JSON Schema function declarations into Anthropic tool format:
        { "name": ..., "description": ..., "input_schema": { ... } }
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
            name = fn.get("name", "")
            desc = fn.get("description", "")
            raw_schema = fn.get("parameters") or fn.get("input_schema") or {"type": "object", "properties": {}}
            converted.append({
                "name": name,
                "description": desc,
                "input_schema": normalize_json_schema(raw_schema)
            })
        return converted

    def _convert_messages(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Translates Cyclode/Gemini structured parts or history into Anthropic Messages format.
        Anthropic requires strictly alternating user/assistant turns and tool_use / tool_result blocks.
        """
        anthropic_msgs = []

        for m in messages:
            role = m.get("role", "user")
            if role == "system":
                continue

            parts = m.get("parts", [])
            if parts:
                content_blocks = []
                for p in parts:
                    if isinstance(p, str):
                        if p.strip():
                            content_blocks.append({"type": "text", "text": p})
                        continue
                    if not isinstance(p, dict):
                        continue

                    if "text" in p and p["text"]:
                        content_blocks.append({"type": "text", "text": str(p["text"])})
                    elif "content" in p and p["content"] and isinstance(p["content"], str):
                        content_blocks.append({"type": "text", "text": str(p["content"])})
                    elif "functionCall" in p:
                        fc = p["functionCall"]
                        call_id = fc.get("id") or f"call_{fc.get('name')}"
                        content_blocks.append({
                            "type": "tool_use",
                            "id": call_id,
                            "name": fc.get("name"),
                            "input": fc.get("args", {})
                        })
                    elif p.get("type") == "tool_use":
                        content_blocks.append({
                            "type": "tool_use",
                            "id": p.get("id") or f"call_{p.get('name', 'tool')}",
                            "name": p.get("name"),
                            "input": p.get("input", {})
                        })
                    elif "functionResponse" in p:
                        fr = p["functionResponse"]
                        call_id = fr.get("id") or f"call_{fr.get('name')}"
                        resp_obj = fr.get("response", {})
                        content_str = resp_obj.get("output") or resp_obj.get("stdout") or (json.dumps(resp_obj) if isinstance(resp_obj, (dict, list)) else str(resp_obj))
                        content_blocks.append({
                            "type": "tool_result",
                            "tool_use_id": call_id,
                            "content": str(content_str)
                        })
                    elif p.get("role") == "tool" or p.get("type") == "tool_result":
                        call_id = p.get("tool_call_id") or p.get("tool_use_id") or ""
                        content_blocks.append({
                            "type": "tool_result",
                            "tool_use_id": call_id,
                            "content": str(p.get("content", ""))
                        })

                if content_blocks:
                    anthropic_role = "assistant" if role in ["model", "assistant"] else "user"
                    anthropic_msgs.append({"role": anthropic_role, "content": content_blocks})
            else:
                text_content = m.get("content", "")
                thought_content = m.get("thought", "")
                blocks = []
                if thought_content:
                    blocks.append({"type": "text", "text": f"<thought>{thought_content}</thought>"})
                if text_content:
                    blocks.append({"type": "text", "text": text_content})

                if blocks:
                    anthropic_role = "assistant" if role in ["model", "assistant", "agent"] else "user"
                    anthropic_msgs.append({"role": anthropic_role, "content": blocks})

        # Ensure turns strictly alternate by merging adjacent same-role turns
        merged_msgs = []
        for msg in anthropic_msgs:
            if merged_msgs and merged_msgs[-1]["role"] == msg["role"]:
                prev_c = merged_msgs[-1]["content"]
                curr_c = msg["content"]
                if isinstance(prev_c, list) and isinstance(curr_c, list):
                    merged_msgs[-1]["content"] = prev_c + curr_c
                elif isinstance(prev_c, str) and isinstance(curr_c, str):
                    merged_msgs[-1]["content"] = prev_c + "\n" + curr_c
                else:
                    prev_list = prev_c if isinstance(prev_c, list) else [{"type": "text", "text": str(prev_c)}]
                    curr_list = curr_c if isinstance(curr_c, list) else [{"type": "text", "text": str(curr_c)}]
                    merged_msgs[-1]["content"] = prev_list + curr_list
            else:
                merged_msgs.append(msg)

        # Anthropic requires first message to be user
        if merged_msgs and merged_msgs[0]["role"] == "assistant":
            merged_msgs.insert(0, {"role": "user", "content": [{"type": "text", "text": "Begin task execution."}]})

        # Reconcile tool_use and tool_result blocks to guarantee strict 1-to-1 matching
        final_msgs = []
        for idx, msg in enumerate(merged_msgs):
            if msg["role"] == "assistant" and isinstance(msg["content"], list):
                tool_uses = [b for b in msg["content"] if isinstance(b, dict) and b.get("type") == "tool_use"]
                if tool_uses:
                    expected_ids = [tu.get("id") for tu in tool_uses if tu.get("id")]
                    # Check next message
                    next_msg = merged_msgs[idx + 1] if idx + 1 < len(merged_msgs) else None
                    if next_msg and next_msg["role"] == "user" and isinstance(next_msg["content"], list):
                        existing_results = {b.get("tool_use_id"): b for b in next_msg["content"] if isinstance(b, dict) and b.get("type") == "tool_result"}
                        for tu_id in expected_ids:
                            if tu_id not in existing_results:
                                next_msg["content"].append({
                                    "type": "tool_result",
                                    "tool_use_id": tu_id,
                                    "content": "Tool execution completed."
                                })
                    elif not next_msg or next_msg["role"] != "user":
                        # If assistant message has text blocks alongside tool_use, strip tool_use
                        text_blocks = [b for b in msg["content"] if isinstance(b, dict) and b.get("type") == "text"]
                        if text_blocks:
                            msg["content"] = text_blocks
            final_msgs.append(msg)

        return final_msgs

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
                error_message="Anthropic API Key is missing or unconfigured."
            )

        # Normalize model identifier
        clean_model = model_name.replace("anthropic:", "").strip() if model_name else "claude-fable-5-1"
        if clean_model in ["claude-fable-5-1", "claude-fable-5", "fable", "claude-fable"]:
            clean_model = "claude-fable-5-1"
        elif clean_model in ["claude-3-7-sonnet", "claude-3.7-sonnet"]:
            clean_model = "claude-3-7-sonnet-20250219"
        elif clean_model in ["claude-3-5-sonnet", "claude-3.5-sonnet"]:
            clean_model = "claude-3-5-sonnet-20241022"
        elif clean_model in ["claude-3-5-haiku", "claude-3.5-haiku"]:
            clean_model = "claude-3-5-haiku-20241022"

        claude_tools = self._convert_tool_declarations(tools)
        claude_messages = self._convert_messages(messages)

        payload: Dict[str, Any] = {
            "model": clean_model,
            "max_tokens": 8192,
            "system": system_instruction,
            "messages": claude_messages
        }
        if claude_tools:
            payload["tools"] = claude_tools

        # Support extended thinking for Claude Fable and Claude 3.7
        if ("claude-3-7" in clean_model or "fable" in clean_model) and (thinking_budget or settings.ANTIGRAVITY_ENABLE_THINKING):
            budget = thinking_budget or 2048
            payload["thinking"] = {"type": "enabled", "budget_tokens": budget}
            # Anthropic requires temperature=1.0 when thinking is enabled
            payload["temperature"] = 1.0
        else:
            payload["temperature"] = temperature

        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        }

        should_close = False
        if client is None:
            client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0, read=120.0))
            should_close = True

        try:
            resp = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
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
                    error_message=f"Anthropic API Error: {err_msg}",
                    raw_response=raw_resp
                )

            data = resp.json()
            content_blocks = data.get("content", [])
            finish_reason = data.get("stop_reason")

            thoughts = []
            contents = []
            tool_calls = []

            for block in content_blocks:
                b_type = block.get("type")
                if b_type == "thinking":
                    thoughts.append(block.get("thinking", ""))
                elif b_type == "text":
                    text_val = block.get("text", "")
                    if "<thought>" in text_val and "</thought>" in text_val:
                        th_match = text_val.split("<thought>")[1].split("</thought>")[0]
                        thoughts.append(th_match.strip())
                        text_val = text_val.replace(f"<thought>{th_match}</thought>", "").strip()
                    if text_val:
                        contents.append(text_val)
                elif b_type == "tool_use":
                    tool_calls.append(ToolCallRequest(
                        call_id=block.get("id", f"call_{len(tool_calls)+1}"),
                        tool_name=block.get("name", ""),
                        tool_args=block.get("input", {}),
                        raw_part=block
                    ))

            usage = data.get("usage", {})
            input_tokens = usage.get("input_tokens", 0)
            output_tokens = usage.get("output_tokens", 0)

            return ProviderResponse(
                content="\n".join(contents),
                thought="\n".join(thoughts),
                tool_calls=tool_calls,
                raw_parts=content_blocks,
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
                error_message=f"Anthropic connection error: {str(e)}"
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
                "error": "Anthropic API Key is missing or unconfigured.",
                "status_code": 401
            }

        candidate_models = list(dict.fromkeys([
            model_name,
            "claude-fable-5-1",
            "claude-3-7-sonnet-20250219",
            "claude-3-5-haiku-20241022",
            "claude-3-5-sonnet-20241022"
        ]))

        should_close = False
        if client is None:
            client = httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0, read=45.0))
            should_close = True

        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
        }

        last_error = "Model response unavailable"
        try:
            for active_model in candidate_models:
                clean_model = active_model.replace("anthropic:", "").strip() if active_model else "claude-fable-5-1"
                if clean_model in ["claude-fable-5-1", "claude-fable-5", "fable", "claude-fable"]:
                    clean_model = "claude-fable-5-1"
                elif clean_model in ["claude-3-7-sonnet", "claude-3.7-sonnet"]:
                    clean_model = "claude-3-7-sonnet-20250219"
                elif clean_model in ["claude-3-5-sonnet", "claude-3.5-sonnet"]:
                    clean_model = "claude-3-5-sonnet-20241022"
                elif clean_model in ["claude-3-5-haiku", "claude-3.5-haiku"]:
                    clean_model = "claude-3-5-haiku-20241022"

                payload = {
                    "model": clean_model,
                    "max_tokens": 2048,
                    "system": (system_instruction or "") + "\nRespond ONLY with a valid raw JSON object. Do not include markdown code block formatting or backticks.",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2
                }

                try:
                    resp = await asyncio.wait_for(
                        client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers),
                        timeout=30.0
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        blocks = data.get("content", [])
                        raw_text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
                        if raw_text:
                            # Clean markdown if enclosed in ```json
                            cleaned = raw_text
                            if "```" in cleaned:
                                cleaned = cleaned.split("```")[1]
                                if cleaned.startswith("json"):
                                    cleaned = cleaned[4:]
                            parsed = json.loads(cleaned.strip())
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
