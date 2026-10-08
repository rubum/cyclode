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

    async def analyze_visual(
        self,
        b64_data: str,
        mime_type: str,
        prompt: str,
        system_instruction: Optional[str] = None,
        client: Optional[httpx.AsyncClient] = None
    ) -> Optional[str]:
        """
        Analyzes an image and returns textual descriptions (OCR, UI components, layout).
        Returns None if the provider does not support direct visual inspection or fails.
        """
        return None

    def estimate_tokens(self, text: str) -> int:
        if not text:
            return 0
        words = len(text.split())
        chars = len(text)
        return max(1, int(max(words * 1.3, chars / 4)))

    def get_context_window(self, model_name: str) -> int:
        """
        Returns maximum input context window capacity (in tokens) for a given model.
        """
        clean = (model_name or "").lower()
        if "deepseek" in clean:
            return 1_048_576
        if "claude" in clean or "anthropic" in clean:
            return 200_000
        if "o1" in clean or "o3" in clean:
            return 200_000
        if "gpt-4o" in clean or "openai" in clean:
            return 128_000
        if "gemini" in clean:
            return 1_000_000
        return 128_000

    def supports_inline_vision(self, model_name: str) -> bool:
        """
        Returns whether the model natively supports base64 inline image URLs in chat messages.
        """
        clean = (model_name or "").lower()
        if "deepseek" in clean:
            return "flash" in clean or "vision" in clean
        if "claude" in clean or "anthropic" in clean:
            return True
        if "gemini" in clean:
            return True
        if "gpt-4o" in clean or "gpt-4-turbo" in clean or "gpt-4.5" in clean:
            return True
        return False


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


def _unescape_json_string(val: Any) -> Any:
    """
    Decodes escape sequences (\\n, \\", \\', \\t, \\r, \\\\, \\/, \\b, \\f, \\uXXXX)
    from JSON-extracted raw string literals while preserving existing raw characters.
    """
    import re

    if not isinstance(val, str) or "\\" not in val:
        return val

    def _replace_escape(match: re.Match) -> str:
        seq = match.group(0)
        if seq == r"\n":
            return "\n"
        elif seq == r'\"':
            return '"'
        elif seq == r"\'":
            return "'"
        elif seq == r"\t":
            return "\t"
        elif seq == r"\r":
            return "\r"
        elif seq == r"\\":
            return "\\"
        elif seq == r"\/":
            return "/"
        elif seq == r"\b":
            return "\b"
        elif seq == r"\f":
            return "\f"
        elif seq.startswith(r"\u") and len(seq) == 6:
            try:
                return chr(int(seq[2:], 16))
            except ValueError:
                return seq
        return seq

    pattern = re.compile(r'\\[nrt"\'\\/bf]|\\u[0-9a-fA-F]{4}')
    return pattern.sub(_replace_escape, val)


def parse_lenient_tool_arguments(raw_args: Any) -> Dict[str, Any]:
    """
    Robust multi-stage self-healing parser for LLM tool arguments.
    Recovers tool call payloads even when models output unescaped newlines,
    raw unescaped quotes, trailing commas, or control characters in large source files.
    """
    import json
    import re
    import logging

    prov_logger = logging.getLogger("cyclode.providers.base")

    if raw_args is None:
        return {}
    if isinstance(raw_args, dict):
        return raw_args
    if not isinstance(raw_args, str) or not raw_args.strip():
        return {}

    cleaned = raw_args.strip()

    if cleaned in ["{}", ""]:
        return {}

    # Stage 1: Standard JSON parsing
    try:
        res = json.loads(cleaned)
        if isinstance(res, dict):
            return res
    except Exception:
        pass

    # Stage 2: Lenient JSON parsing with strict=False (allows unescaped control chars, raw newlines)
    try:
        res = json.loads(cleaned, strict=False)
        if isinstance(res, dict):
            return res
    except Exception:
        pass

    # Stage 3: Clean trailing commas, markdown fences, and repair syntax defects
    try:
        sanitized = cleaned
        if sanitized.startswith("```"):
            sanitized = re.sub(r"^```(?:json)?\s*", "", sanitized)
            sanitized = re.sub(r"\s*```$", "", sanitized).strip()

        sanitized = re.sub(r",\s*([\]}])", r"\1", sanitized)

        res = json.loads(sanitized, strict=False)
        if isinstance(res, dict):
            return res
    except Exception:
        pass

    # Stage 4: Regex-based field extraction for key tools (edit_file, replace_file_content, run_command, etc.)
    recovered: Dict[str, Any] = {}

    path_match = re.search(r'["\'](?:file_path|filePath|target_file|path|filename|file)["\']\s*:\s*["\']([^"\']+)["\']', cleaned)
    if path_match:
        recovered["file_path"] = _unescape_json_string(path_match.group(1))

    content_match = re.search(
        r'["\'](?:content|code|text|body|source)["\']\s*:\s*(?:"""([\s\S]*?)"""|```([\s\S]*?)```|"([\s\S]*?)"(?:\s*,\s*["\']|\s*\})|\'([\s\S]*?)\'(?:\s*,\s*["\']|\s*\}))',
        cleaned
    )
    if content_match:
        content_val = content_match.group(1) or content_match.group(2) or content_match.group(3) or content_match.group(4) or ""
        recovered["content"] = _unescape_json_string(content_val)

    cmd_match = re.search(
        r'["\'](?:command|cmd)["\']\s*:\s*(?:"""([\s\S]*?)"""|"([\s\S]*?)"(?:\s*,\s*["\']|\s*\})|\'([\s\S]*?)\'(?:\s*,\s*["\']|\s*\}))',
        cleaned
    )
    if cmd_match:
        cmd_val = cmd_match.group(1) or cmd_match.group(2) or cmd_match.group(3) or ""
        recovered["command"] = _unescape_json_string(cmd_val)

    target_match = re.search(
        r'["\'](?:target_content|target|search|old_content)["\']\s*:\s*(?:"""([\s\S]*?)"""|"([\s\S]*?)"(?:\s*,\s*["\']|\s*\})|\'([\s\S]*?)\'(?:\s*,\s*["\']|\s*\}))',
        cleaned
    )
    if target_match:
        target_val = target_match.group(1) or target_match.group(2) or target_match.group(3) or ""
        recovered["target_content"] = _unescape_json_string(target_val)

    replacement_match = re.search(
        r'["\'](?:replacement_content|replacement|replace|new_content)["\']\s*:\s*(?:"""([\s\S]*?)"""|"([\s\S]*?)"(?:\s*,\s*["\']|\s*\})|\'([\s\S]*?)\'(?:\s*,\s*["\']|\s*\}))',
        cleaned
    )
    if replacement_match:
        repl_val = replacement_match.group(1) or replacement_match.group(2) or replacement_match.group(3) or ""
        recovered["replacement_content"] = _unescape_json_string(repl_val)

    patch_match = re.search(
        r'["\'](?:patch_content|patch)["\']\s*:\s*(?:"""([\s\S]*?)"""|"([\s\S]*?)"(?:\s*,\s*["\']|\s*\})|\'([\s\S]*?)\'(?:\s*,\s*["\']|\s*\}))',
        cleaned
    )
    if patch_match:
        patch_val = patch_match.group(1) or patch_match.group(2) or patch_match.group(3) or ""
        recovered["patch_content"] = _unescape_json_string(patch_val)

    # If file_path was found but content regex missed (e.g. unclosed string at EOF), capture trailing block
    if "file_path" in recovered and "content" not in recovered:
        unclosed_match = re.search(r'["\'](?:content|code|text|body|source)["\']\s*:\s*["\']([\s\S]+)$', cleaned)
        if unclosed_match:
            c_tail = unclosed_match.group(1).rstrip('"\n\r\t }')
            if c_tail.strip():
                recovered["content"] = _unescape_json_string(c_tail)

    # Batch edits extraction fallback
    if "edits" not in recovered:
        edits_match = re.search(r'["\']edits["\']\s*:\s*(\[[\s\S]*\])', cleaned)
        if edits_match:
            try:
                raw_e = edits_match.group(1)
                raw_e = re.sub(r",\s*([\]}])", r"\1", raw_e)
                parsed_e = json.loads(raw_e, strict=False)
                if isinstance(parsed_e, list):
                    recovered["edits"] = parsed_e
            except Exception:
                pass

    if recovered:
        prov_logger.info(f"Lenient JSON parser successfully recovered fields from malformed tool payload: {list(recovered.keys())}")
        return recovered

    prov_logger.warning(f"Could not parse tool arguments ({len(cleaned)} chars): {cleaned[:100]}...")
    return {}


def extract_markup_tool_calls(text: str) -> tuple[str, List[ToolCallRequest]]:
    """
    Extracts structured tool calls from raw model response text containing
    DSML (DeepSeek Markup Language), XML (<tool_call>, <invoke>, <function_call>),
    or special token markup (<｜tool_calls｜>).
    
    Returns (cleaned_text, list_of_ToolCallRequests).
    """
    import re
    import uuid
    import json
    import logging

    logger = logging.getLogger("cyclode.providers.markup_parser")
    if not text or not isinstance(text, str):
        return text, []

    if "<" not in text and "｜" not in text and "```tool_call" not in text and "＜" not in text:
        return text, []

    extracted: List[ToolCallRequest] = []
    cleaned_text = text

    def _normalize_markup(s: str) -> str:
        return s.replace("＜", "<").replace("＞", ">").replace("｜", "|")

    norm_text = _normalize_markup(text)

    # 1. Parse DSML syntax: < | DSML | | invoke name="..."> ... </ | DSML | | invoke>
    dsml_invoke_pattern = re.compile(
        r'<\s*(?:\|\s*)?DSML(?:\s*\|){2}\s*invoke\s+name=["\']?([^"\'\s>]+)["\']?[^>]*>([\s\S]*?)<\s*\/\s*(?:\|\s*)?DSML(?:\s*\|){2}\s*invoke\s*>',
        re.IGNORECASE
    )
    dsml_param_pattern = re.compile(
        r'<\s*(?:\|\s*)?DSML(?:\s*\|){2}\s*parameter\s+name=["\']?([^"\'\s>]+)["\']?[^>]*>([\s\S]*?)<\s*\/\s*(?:\|\s*)?DSML(?:\s*\|){2}\s*parameter\s*>',
        re.IGNORECASE
    )

    for m in dsml_invoke_pattern.finditer(norm_text):
        fn_name = m.group(1).strip()
        body = m.group(2).strip()
        args: Dict[str, Any] = {}

        param_matches = list(dsml_param_pattern.finditer(body))
        if param_matches:
            for pm in param_matches:
                p_name = pm.group(1).strip()
                p_val_raw = pm.group(2).strip()
                try:
                    p_val = json.loads(p_val_raw)
                except Exception:
                    p_val = _unescape_json_string(p_val_raw)
                args[p_name] = p_val
        else:
            parsed = parse_lenient_tool_arguments(body)
            if parsed:
                args = parsed

        if fn_name:
            call_id = f"call_{len(extracted)+1}_{fn_name}_{uuid.uuid4().hex[:6]}"
            extracted.append(ToolCallRequest(
                call_id=call_id,
                tool_name=fn_name,
                tool_args=args,
                raw_part={"name": fn_name, "args": args}
            ))

    # 2. Generic <invoke name="..."> ... </invoke> without DSML prefix
    if not extracted:
        generic_invoke_pattern = re.compile(
            r'<\s*invoke\s+name=["\']?([^"\'\s>]+)["\']?[^>]*>([\s\S]*?)<\s*\/\s*invoke\s*>',
            re.IGNORECASE
        )
        generic_param_pattern = re.compile(
            r'<\s*parameter\s+name=["\']?([^"\'\s>]+)["\']?[^>]*>([\s\S]*?)<\s*\/\s*parameter\s*>',
            re.IGNORECASE
        )
        for m in generic_invoke_pattern.finditer(norm_text):
            fn_name = m.group(1).strip()
            body = m.group(2).strip()
            args = {}
            param_matches = list(generic_param_pattern.finditer(body))
            if param_matches:
                for pm in param_matches:
                    p_name = pm.group(1).strip()
                    p_val_raw = pm.group(2).strip()
                    try:
                        p_val = json.loads(p_val_raw)
                    except Exception:
                        p_val = _unescape_json_string(p_val_raw)
                    args[p_name] = p_val
            else:
                parsed = parse_lenient_tool_arguments(body)
                if parsed:
                    args = parsed
            if fn_name:
                call_id = f"call_{len(extracted)+1}_{fn_name}_{uuid.uuid4().hex[:6]}"
                extracted.append(ToolCallRequest(
                    call_id=call_id,
                    tool_name=fn_name,
                    tool_args=args,
                    raw_part={"name": fn_name, "args": args}
                ))

    # 3. Parse <tool_call> or <function_call> JSON blocks
    if not extracted:
        tool_call_json_pattern = re.compile(
            r'<\s*(?:tool_call|function_call)(?:\s+name=["\']?([^"\'\s>]+)["\']?)?[^>]*>([\s\S]*?)<\s*\/\s*(?:tool_call|function_call)\s*>',
            re.IGNORECASE
        )
        for m in tool_call_json_pattern.finditer(norm_text):
            attr_name = m.group(1)
            body = m.group(2).strip()
            parsed = parse_lenient_tool_arguments(body)
            fn_name = attr_name or parsed.get("name") or parsed.get("function") or parsed.get("tool_name")
            args = parsed.get("arguments") or parsed.get("parameters") or parsed.get("args") or parsed
            if isinstance(args, str):
                args = parse_lenient_tool_arguments(args)
            if fn_name and isinstance(args, dict):
                call_id = f"call_{len(extracted)+1}_{fn_name}_{uuid.uuid4().hex[:6]}"
                extracted.append(ToolCallRequest(
                    call_id=call_id,
                    tool_name=str(fn_name),
                    tool_args=args,
                    raw_part={"name": fn_name, "args": args}
                ))

    # 4. Parse DeepSeek special token format: <|tool_call_begin|> ... <|tool_call_end|>
    if not extracted:
        special_token_pattern = re.compile(
            r'<\s*\|\s*tool_call_begin\s*\|\s*>([\s\S]*?)<\s*\|\s*tool_call_end\s*\|\s*>',
            re.IGNORECASE
        )
        for m in special_token_pattern.finditer(norm_text):
            body = m.group(1).strip()
            if "<|tool_sep|>" in body or "|tool_sep|" in body:
                parts = re.split(r'<\s*\|\s*tool_sep\s*\|\s*>', body)
                if len(parts) >= 2:
                    payload = parts[1].strip()
                    fn_name_match = re.search(r'([a-zA-Z0-9_\-]+)', payload.split('\n')[0])
                    fn_name = fn_name_match.group(1) if fn_name_match else "tool"
                    args = parse_lenient_tool_arguments(payload)
                    call_id = f"call_{len(extracted)+1}_{fn_name}_{uuid.uuid4().hex[:6]}"
                    extracted.append(ToolCallRequest(
                        call_id=call_id,
                        tool_name=fn_name,
                        tool_args=args,
                        raw_part={"name": fn_name, "args": args}
                    ))
            else:
                parsed = parse_lenient_tool_arguments(body)
                fn_name = parsed.get("name") or parsed.get("function") or "tool"
                args = parsed.get("arguments") or parsed.get("parameters") or parsed
                if isinstance(args, str):
                    args = parse_lenient_tool_arguments(args)
                if fn_name and isinstance(args, dict):
                    call_id = f"call_{len(extracted)+1}_{fn_name}_{uuid.uuid4().hex[:6]}"
                    extracted.append(ToolCallRequest(
                        call_id=call_id,
                        tool_name=str(fn_name),
                        tool_args=args,
                        raw_part={"name": fn_name, "args": args}
                    ))

    # 5. Strip tool call markup from cleaned_text
    if extracted:
        cleaned_text = norm_text
        cleaned_text = re.sub(
            r'<\s*(?:[|｜]\s*)?DSML(?:\s*[|｜]){2}\s*calls\s*>([\s\S]*?)<\s*\/\s*(?:[|｜]\s*)?DSML(?:\s*[|｜]){2}\s*calls\s*>',
            '',
            cleaned_text,
            flags=re.IGNORECASE
        )
        cleaned_text = re.sub(
            r'<\s*(?:[|｜]\s*)?DSML(?:\s*[|｜]){2}\s*invoke[^>]*>[\s\S]*?<\s*\/\s*(?:[|｜]\s*)?DSML(?:\s*[|｜]){2}\s*invoke\s*>',
            '',
            cleaned_text,
            flags=re.IGNORECASE
        )
        cleaned_text = re.sub(
            r'<\s*invoke[^>]*>[\s\S]*?<\s*\/\s*invoke\s*>',
            '',
            cleaned_text,
            flags=re.IGNORECASE
        )
        cleaned_text = re.sub(
            r'<\s*(?:tool_call|function_call)[^>]*>[\s\S]*?<\s*\/\s*(?:tool_call|function_call)\s*>',
            '',
            cleaned_text,
            flags=re.IGNORECASE
        )
        cleaned_text = re.sub(
            r'<\s*[|｜]\s*tool_call_begin\s*[|｜]\s*>[\s\S]*?<\s*[|｜]\s*tool_call_end\s*[|｜]\s*>',
            '',
            cleaned_text,
            flags=re.IGNORECASE
        )
        cleaned_text = re.sub(
            r'<\s*[|｜]\s*tool_calls\s*[|｜]\s*>|<\s*\/[|｜]\s*tool_calls\s*[|｜]\s*>',
            '',
            cleaned_text,
            flags=re.IGNORECASE
        )
        cleaned_text = re.sub(
            r'```tool_call[\s\S]*?```',
            '',
            cleaned_text,
            flags=re.IGNORECASE
        )
        cleaned_text = cleaned_text.strip()
        logger.info(f"Successfully extracted {len(extracted)} markup tool call(s) from response text ({[t.tool_name for t in extracted]}).")

    return cleaned_text, extracted


