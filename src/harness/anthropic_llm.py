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

    def set_tool_schemas(self, schemas: list[dict[str, Any]]) -> None:
        """Update tool schemas after initialization."""
        self.tool_schemas = schemas

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
    ) -> List[Dict[str, Any]]:
        # Build the first user message with goal + context + summary
        first_msg = f"Goal: {working_memory.get('goal', '')}"
        ctx = working_memory.get("context")
        if ctx:
            first_msg += (
                f"\n\nContext: {json.dumps(ctx, ensure_ascii=False)}"
            )
        summary = working_memory.get("summary_memory")
        if summary:
            first_msg += f"\n\nPrevious summary: {summary}"

        messages: List[Dict[str, Any]] = [
            {"role": "user", "content": first_msg},
        ]

        history = working_memory.get("history", [])
        if not history:
            return messages

        for turn in history:
            action = turn.get("action", {})
            action_type = action.get("action_type", "")
            observation = turn.get("observation", "")
            turn_num = turn.get("turn", 0)

            if action_type == "tool_call":
                tool_use_id = f"toolu_history_{turn_num}"
                # Assistant message with tool_use block
                messages.append({
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": tool_use_id,
                        "name": action.get("tool_name", "unknown"),
                        "input": action.get("arguments", {}),
                    }],
                })
                # User message with tool_result block
                messages.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": str(observation),
                    }],
                })
            elif action_type == "final_response":
                content = action.get("content", "")
                if content:
                    messages.append({
                        "role": "assistant",
                        "content": str(content),
                    })
            # schema_error turns are skipped

        # Build the continuation prompt
        continuation = "Continue working on the goal. What's your next step?"
        schema_feedback = working_memory.get("schema_feedback")
        if schema_feedback:
            continuation += f"\n\nNote: {schema_feedback}"

        # Ensure we end with a user message
        if messages and messages[-1]["role"] == "assistant":
            messages.append({"role": "user", "content": continuation})
        elif messages and messages[-1]["role"] == "user":
            # Last message is already user (tool_result); append continuation
            # as a separate text block or merge
            last = messages[-1]["content"]
            if isinstance(last, list):
                # Merge continuation into the tool_result message
                last.append({"type": "text", "text": continuation})
            else:
                messages.append({"role": "user", "content": continuation})

        return messages

    @staticmethod
    def _parse_response(response: Any) -> Dict[str, Any]:
        result: Dict[str, Any] = {}
        text_content: str | None = None
        for block in response.content:
            if block.type == "tool_use":
                result = {
                    "type": "tool_call",
                    "tool_name": block.name,
                    "arguments": block.input,
                }
                break  # tool_use takes priority
            if block.type == "text":
                text_content = block.text

        if not result and text_content is not None:
            result = {"type": "final_response", "content": text_content}
        elif not result:
            raise ValueError(
                "Anthropic response contained no usable content blocks."
            )

        # Extract usage information
        if hasattr(response, "usage") and response.usage:
            result["_usage"] = {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
                "total_tokens": (
                    response.usage.input_tokens
                    + response.usage.output_tokens
                ),
            }
        return result

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
