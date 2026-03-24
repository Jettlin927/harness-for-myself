from __future__ import annotations

import json
import os
from getpass import getpass
from pathlib import Path
from typing import Any, Dict, List
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class BaseLLM:
    """Abstract base class for LLM backends.

    Subclass this and implement :meth:`generate` to plug in any language model.
    """

    def generate(self, working_memory: Dict[str, Any]) -> Dict[str, Any]:
        """Generate the next agent action.

        Args:
            working_memory: Dict produced by :class:`~harness.memory.MemoryManager`
                containing ``goal``, ``context``, ``summary_memory``, ``history``,
                and optionally ``schema_feedback``.

        Returns:
            A dict that conforms to one of the two action schemas::

                {"type": "tool_call", "tool_name": "...", "arguments": {...}}
                {"type": "final_response", "content": "..."}

        Raises:
            NotImplementedError: Must be overridden by subclasses.
        """
        raise NotImplementedError


class ScriptedLLM(BaseLLM):
    """Deterministic LLM stub for testing the harness loop."""

    def __init__(self, script: List[Dict[str, Any]]) -> None:
        self._script = script
        self._index = 0

    def generate(self, working_memory: Dict[str, Any]) -> Dict[str, Any]:
        _ = working_memory
        if self._index >= len(self._script):
            return {
                "type": "final_response",
                "content": "Script exhausted. Stopping safely.",
            }
        action = self._script[self._index]
        self._index += 1
        return action


class RuleBasedLLM(BaseLLM):
    """Very small heuristic model for demo runs without external APIs."""

    def generate(self, working_memory: Dict[str, Any]) -> Dict[str, Any]:
        goal = str(working_memory.get("goal", "")).lower()
        history = working_memory.get("history", [])

        if "add" in goal or "sum" in goal:
            if not history:
                return {
                    "type": "tool_call",
                    "tool_name": "add",
                    "arguments": {"a": 2, "b": 3},
                }
            last_obs = str(history[-1].get("observation", ""))
            return {
                "type": "final_response",
                "content": f"Done. Computation result: {last_obs}",
            }

        if "time" in goal:
            if not history:
                return {
                    "type": "tool_call",
                    "tool_name": "utc_now",
                    "arguments": {},
                }
            return {
                "type": "final_response",
                "content": f"Current UTC time observed: {history[-1].get('observation')}",
            }

        return {
            "type": "final_response",
            "content": "No tool needed. Here is the direct answer.",
        }


class DeepSeekLLM(BaseLLM):
    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str = "deepseek-chat",
        base_url: str = "https://api.deepseek.com",
        env_path: str | Path | None = None,
        transport: Any | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.env_path = Path(env_path) if env_path is not None else self._default_env_path()
        self.transport = transport or self._default_transport

    def generate(self, working_memory: Dict[str, Any]) -> Dict[str, Any]:
        api_key = self._resolve_api_key()
        payload = {
            "model": self.model,
            "messages": self._build_messages(working_memory),
            "temperature": 0.1,
        }
        response = self.transport(payload, api_key, self.base_url)
        return self._parse_response(response)

    def _resolve_api_key(self) -> str:
        api_key = self.api_key or os.environ.get("DEEPSEEK_API_KEY", "").strip()
        if not api_key:
            api_key = self._read_env_file_value("DEEPSEEK_API_KEY")
        if api_key:
            self.api_key = api_key
            return api_key

        prompted = getpass("DeepSeek API key not found. Enter DEEPSEEK_API_KEY: ").strip()
        if not prompted:
            raise ValueError("DeepSeek API key is required to run this entrypoint.")
        self._write_env_file_value("DEEPSEEK_API_KEY", prompted)
        os.environ["DEEPSEEK_API_KEY"] = prompted
        self.api_key = prompted
        return prompted

    @staticmethod
    def _default_env_path() -> Path:
        return Path(__file__).resolve().parents[2] / ".env"

    def _read_env_file_value(self, key: str) -> str:
        if not self.env_path.exists():
            return ""
        for line in self.env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            name, value = stripped.split("=", 1)
            if name.strip() == key:
                return value.strip().strip('"').strip("'")
        return ""

    def _write_env_file_value(self, key: str, value: str) -> None:
        lines: List[str] = []
        updated = False
        if self.env_path.exists():
            lines = self.env_path.read_text(encoding="utf-8").splitlines()

        next_lines: List[str] = []
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                name, _ = stripped.split("=", 1)
                if name.strip() == key:
                    next_lines.append(f"{key}={value}")
                    updated = True
                    continue
            next_lines.append(line)

        if not updated:
            next_lines.append(f"{key}={value}")

        self.env_path.parent.mkdir(parents=True, exist_ok=True)
        self.env_path.write_text("\n".join(next_lines).rstrip() + "\n", encoding="utf-8")

    def _build_messages(self, working_memory: Dict[str, Any]) -> List[Dict[str, str]]:
        system_prompt = (
            "You are the LLM engine inside a tool-using agent harness. "
            "Return JSON only. "
            "Use exactly one of these shapes: "
            '{"type":"tool_call","tool_name":"<tool>","arguments":{...}} '
            'or {"type":"final_response","content":"<answer>"}. '
            "Available tools: echo(text), add(a,b), utc_now(), "
            "write_text_file(path, content), "
            "read_file(path, offset?, limit?) for reading file contents, "
            "edit_file(path, old_text, new_text) for precise text replacement, "
            "bash(command, timeout?) for running shell commands."
        )
        user_prompt = json.dumps(working_memory, ensure_ascii=False, indent=2)
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

    @staticmethod
    def _parse_response(response: Dict[str, Any]) -> Dict[str, Any]:
        choices = response.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ValueError("DeepSeek response did not include any choices.")

        message = choices[0].get("message", {})
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("DeepSeek response content was empty.")

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            return {
                "type": "final_response",
                "content": content.strip(),
            }
        if not isinstance(parsed, dict):
            raise ValueError("DeepSeek response JSON must decode to an object.")
        return parsed

    @staticmethod
    def _default_transport(
        payload: Dict[str, Any],
        api_key: str,
        base_url: str,
    ) -> Dict[str, Any]:
        request = Request(
            url=f"{base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"DeepSeek API returned HTTP {exc.code}: {body}") from exc
        except URLError as exc:
            raise RuntimeError(f"DeepSeek API request failed: {exc.reason}") from exc
