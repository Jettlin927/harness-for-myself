from __future__ import annotations

import json
import os
from getpass import getpass
from pathlib import Path
from typing import Any, Callable, Dict, List
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def build_system_prompt(tool_names: list[str]) -> str:
    """Build the system prompt shared by all LLM backends."""
    tools_desc = ", ".join(tool_names) if tool_names else "(none)"
    return (
        "You are a coding agent. Your goal is to autonomously complete programming tasks "
        "given by the user. You operate inside a tool-using harness that validates your "
        "output, executes tools, and feeds results back to you.\n\n"
        #
        # --- Output format ---
        #
        "## Output Format\n"
        "Return exactly one JSON object per turn. Use one of these two shapes:\n"
        '- Tool call: {"type":"tool_call","tool_name":"<tool>","arguments":{...}}\n'
        '- Final answer: {"type":"final_response","content":"<answer>"}\n'
        "Do not wrap JSON in markdown fences or add any text outside the JSON object.\n\n"
        #
        # --- Available tools ---
        #
        f"## Available Tools\n{tools_desc}\n\n"
        #
        # --- Workflow strategy ---
        #
        "## Workflow Strategy\n"
        "Follow this order when working on code:\n"
        "1. **Discover** — Use grep_search or glob_files to locate relevant files and "
        "symbols. Use list_directory to understand project layout.\n"
        "2. **Understand** — Use read_file to examine the code you found. Read enough "
        "context to be confident about the change.\n"
        "3. **Modify** — Use edit_file for surgical changes to existing files. Use "
        "write_file only to create new files. Prefer small, focused edits.\n"
        "4. **Verify** — Use bash to run tests, linters, or type checkers to confirm "
        "your change works. Always verify before declaring success.\n\n"
        #
        # --- Minimal change principle ---
        #
        "## Minimal Change Principle\n"
        "Only modify what is necessary to complete the task. Do not refactor unrelated "
        "code, rename variables for style, or reorganize imports unless the task "
        "explicitly requires it.\n\n"
        #
        # --- Error recovery ---
        #
        "## Error Recovery\n"
        "When a tool call fails:\n"
        "- Read the error message carefully and diagnose the root cause.\n"
        "- Do NOT retry the exact same call. Change your approach: try a different "
        "search pattern, fix the path, adjust the arguments, or gather more context "
        "first.\n"
        "- If you are stuck after 2-3 attempts, explain what you tried and why it "
        "failed in a final_response.\n\n"
        #
        # --- Context markers ---
        #
        "## Context Markers\n"
        "When you discover important information, prefix it with a marker so it "
        "survives memory compression:\n"
        "- `constraint:` for constraints or invariants you must respect.\n"
        "- `todo:` for pending work items.\n"
        "- `evidence:` for key findings (e.g., root cause of a bug).\n\n"
        #
        # --- Safety ---
        #
        "## Safety Boundaries\n"
        "Never execute destructive shell commands such as `rm -rf /`, "
        "`git push --force`, `git reset --hard`, or anything that deletes data "
        "or force-pushes to a remote. If the task seems to require a dangerous "
        "operation, ask the user for confirmation in a final_response instead."
    )


class BaseLLM:
    """Abstract base class for LLM backends.

    Subclass this and implement :meth:`generate` to plug in any language model.
    """

    def __init__(self) -> None:
        self.on_token: Callable[[str], None] | None = None

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
        super().__init__()
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
        super().__init__()
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.env_path = Path(env_path) if env_path is not None else self._default_env_path()
        self.transport = transport or self._default_transport
        self._tool_names: list[str] = []

    def set_tool_schemas(self, schemas: list[dict[str, Any]]) -> None:
        """Update available tool names from schemas."""
        self._tool_names = [s["name"] for s in schemas]

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
        if self._tool_names:
            tool_names = self._tool_names
        else:
            tool_names = ["echo", "add", "utc_now", "write_text_file"]
        system_prompt = build_system_prompt(tool_names)
        user_prompt = json.dumps(
            working_memory,
            ensure_ascii=False,
            indent=2,
        )
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
