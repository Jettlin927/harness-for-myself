from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List

from .llm import BaseLLM, build_system_prompt

try:
    import anthropic
except ImportError:
    anthropic = None  # type: ignore[assignment]


class AnthropicLLM(BaseLLM):
    """LLM backend that delegates to the Anthropic Messages API."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str = "claude-sonnet-4-20250514",
        tool_schemas: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__()
        if anthropic is None:
            raise ImportError(
                "The 'anthropic' package is required. Install it with: pip install anthropic"
            )
        self.model = model
        self.tool_schemas = tool_schemas or []
        self.api_key = self._resolve_api_key(api_key)
        self._client = anthropic.Anthropic(api_key=self.api_key)

    def generate(self, working_memory: Dict[str, Any]) -> Dict[str, Any]:
        tool_names = [s["name"] for s in self.tool_schemas]
        system_prompt = build_system_prompt(tool_names)
        messages = self._build_messages(working_memory)

        kwargs: dict[str, Any] = {
            "model": self.model,
            "system": system_prompt,
            "messages": messages,
            "max_tokens": 4096,
        }
        if self.tool_schemas:
            kwargs["tools"] = self.tool_schemas

        if self.on_token:
            return self._generate_streaming(kwargs)

        response = self._client.messages.create(**kwargs)
        return self._parse_response(response)

    def _generate_streaming(
        self,
        kwargs: dict[str, Any],
    ) -> Dict[str, Any]:
        """Stream tokens via on_token callback, return parsed final response."""
        with self._client.messages.stream(**kwargs) as stream:
            for event in stream:
                if event.type == "content_block_delta":
                    delta = event.delta
                    if hasattr(delta, "text") and self.on_token:
                        self.on_token(delta.text)

            final_message = stream.get_final_message()
        return self._parse_response(final_message)

    @staticmethod
    def _build_messages(
        working_memory: Dict[str, Any],
    ) -> List[Dict[str, str]]:
        user_prompt = json.dumps(
            working_memory,
            ensure_ascii=False,
            indent=2,
        )
        return [{"role": "user", "content": user_prompt}]

    @staticmethod
    def _parse_response(response: Any) -> Dict[str, Any]:
        text_content: str | None = None
        for block in response.content:
            if block.type == "tool_use":
                return {
                    "type": "tool_call",
                    "tool_name": block.name,
                    "arguments": block.input,
                }
            if block.type == "text":
                text_content = block.text

        if text_content is not None:
            return {"type": "final_response", "content": text_content}

        raise ValueError("Anthropic response contained no usable content blocks.")

    @staticmethod
    def _resolve_api_key(explicit_key: str | None) -> str:
        key = explicit_key or os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if key:
            return key

        env_path = Path(__file__).resolve().parents[2] / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                name, value = stripped.split("=", 1)
                if name.strip() == "ANTHROPIC_API_KEY":
                    return value.strip().strip('"').strip("'")

        raise ValueError(
            "Anthropic API key not found. Set ANTHROPIC_API_KEY "
            "environment variable or pass api_key explicitly."
        )
