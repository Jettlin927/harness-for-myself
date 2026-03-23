from __future__ import annotations

import json
from typing import Any, Dict

from .types import LLMAction


class SchemaError(ValueError):
    """Raised when LLM output fails strict schema validation."""


def _ensure_dict(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            decoded = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SchemaError(f"LLM output is not valid JSON: {exc}") from exc
        if not isinstance(decoded, dict):
            raise SchemaError("Decoded JSON must be an object.")
        return decoded
    raise SchemaError(f"LLM output must be dict or JSON string, got: {type(raw).__name__}")


def parse_llm_action(raw: Any) -> LLMAction:
    payload = _ensure_dict(raw)
    action_type = payload.get("type")
    if action_type not in {"tool_call", "final_response"}:
        raise SchemaError("Field 'type' must be 'tool_call' or 'final_response'.")

    if action_type == "final_response":
        content = payload.get("content")
        if not isinstance(content, str) or not content.strip():
            raise SchemaError("final_response requires non-empty string 'content'.")
        return LLMAction(action_type="final_response", raw_output=raw, content=content)

    tool_name = payload.get("tool_name")
    arguments = payload.get("arguments")
    if not isinstance(tool_name, str) or not tool_name:
        raise SchemaError("tool_call requires non-empty string 'tool_name'.")
    if not isinstance(arguments, dict):
        raise SchemaError("tool_call requires object 'arguments'.")

    return LLMAction(
        action_type="tool_call",
        raw_output=raw,
        tool_name=tool_name,
        arguments=arguments,
    )
