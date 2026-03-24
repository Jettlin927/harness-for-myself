from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List

from .llm import BaseLLM, build_system_prompt

try:
    import anthropic
except ImportError:
    anthropic = None  # type: ignore[assignment]


def _is_retryable(exc: Exception) -> bool:
    """Return True if the exception is a transient error worth retrying."""
    cls_name = type(exc).__name__
    # Network / timeout errors are always retryable
    if cls_name in ("APIConnectionError", "APITimeoutError"):
        return True
    # Rate limit (429) is retryable
    if cls_name == "RateLimitError":
        return True
    # Server errors (5xx) are retryable; client errors (4xx except 429) are not
    if cls_name == "APIStatusError" and hasattr(exc, "status_code"):
        return exc.status_code >= 500  # type: ignore[union-attr]
    return False


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
        system_prompt = build_system_prompt(tool_names, native_tool_use=True)
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
            return self._call_with_retry(self._generate_streaming, kwargs)

        response = self._call_with_retry(self._client.messages.create, **kwargs)
        return self._parse_response(response)

    @staticmethod
    def _call_with_retry(fn: Any, *args: Any, **kwargs: Any) -> Any:
        """Call *fn* with retry on transient errors (max 2 retries, exponential backoff)."""
        max_retries = 2
        for attempt in range(max_retries + 1):
            try:
                return fn(*args, **kwargs)
            except Exception as exc:
                if _is_retryable(exc) and attempt < max_retries:
                    time.sleep(2**attempt)  # 1s, 2s
                    continue
                raise RuntimeError(f"LLM API call failed: {exc}") from exc

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
        history: List[Dict[str, Any]] = working_memory.get("history", [])
        schema_feedback = working_memory.get("schema_feedback")

        # Build the initial user message with goal + context + summary
        first_parts = []
        if working_memory.get("goal"):
            first_parts.append(f"Goal: {working_memory['goal']}")
        if working_memory.get("context"):
            first_parts.append(
                f"Context: {json.dumps(working_memory['context'], ensure_ascii=False)}"
            )
        if working_memory.get("summary_memory"):
            first_parts.append(f"Summary: {working_memory['summary_memory']}")

        # Bug B fix: merge schema_feedback into initial message when history is empty
        if not history and schema_feedback:
            first_parts.append(
                f"Schema feedback: {json.dumps(schema_feedback, ensure_ascii=False)}"
            )

        first_msg = "\n".join(first_parts) if first_parts else json.dumps(
            working_memory, ensure_ascii=False, indent=2
        )

        messages: List[Dict[str, Any]] = [{"role": "user", "content": first_msg}]

        for turn in history:
            action = turn.get("action", {})
            action_type = action.get("action_type")
            turn_num = turn.get("turn", 0)

            if action_type == "tool_call":
                tool_use_id = f"toolu_history_{turn_num}"
                # Native Anthropic tool_use block in assistant message
                assistant_content: Any = [
                    {
                        "type": "text",
                        "text": f"[Step {turn_num}]",
                    },
                    {
                        "type": "tool_use",
                        "id": tool_use_id,
                        "name": action.get("tool_name", "unknown"),
                        "input": action.get("arguments", {}),
                    },
                ]
                messages.append({"role": "assistant", "content": assistant_content})

                # Native tool_result block in user message
                # Bug C fix: use structured JSON for tool result content
                tool_result_data = turn.get("tool_result")
                if tool_result_data and isinstance(tool_result_data, dict):
                    result_content = json.dumps(
                        tool_result_data, ensure_ascii=False, default=str
                    )
                else:
                    result_content = str(turn.get("observation", ""))

                messages.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": result_content,
                    }],
                })

            elif action_type == "final_response":
                # Bug A fix: insert bridging user message if last message is also assistant
                if messages and messages[-1]["role"] == "assistant":
                    messages.append({"role": "user", "content": "Acknowledged. Continue."})
                messages.append({
                    "role": "assistant",
                    "content": f"[Step {turn_num}] " + (action.get("content") or ""),
                })

        # If history was non-empty and last message is assistant, add continuation prompt
        if history and messages[-1]["role"] == "assistant":
            continuation = "Continue with the next step."
            if schema_feedback:
                continuation = (
                    f"Schema feedback: "
                    f"{json.dumps(schema_feedback, ensure_ascii=False)}\n"
                    f"Please try again."
                )
            # If last user message is a tool_result list, append text block to it
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
