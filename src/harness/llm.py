from __future__ import annotations

from typing import Any, Dict, List


class BaseLLM:
    def generate(self, working_memory: Dict[str, Any]) -> Dict[str, Any]:
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
