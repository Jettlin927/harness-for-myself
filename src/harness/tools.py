from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Dict

from .types import ToolExecutionResult


class ToolDispatcher:
    def __init__(self) -> None:
        self._tools: Dict[str, Callable[[dict[str, Any]], Any]] = {
            "echo": self._echo,
            "add": self._add,
            "utc_now": self._utc_now,
        }

    def execute(self, tool_name: str, arguments: dict[str, Any]) -> ToolExecutionResult:
        tool = self._tools.get(tool_name)
        if tool is None:
            return ToolExecutionResult(ok=False, output=None, error=f"Unknown tool: {tool_name}")

        try:
            output = tool(arguments)
            return ToolExecutionResult(ok=True, output=output)
        except Exception as exc:  # pragma: no cover - defensive boundary
            return ToolExecutionResult(ok=False, output=None, error=str(exc))

    @staticmethod
    def _echo(arguments: dict[str, Any]) -> Any:
        return {"echo": arguments.get("text", "")}

    @staticmethod
    def _add(arguments: dict[str, Any]) -> Any:
        a = arguments.get("a")
        b = arguments.get("b")
        if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
            raise ValueError("Arguments 'a' and 'b' must be numbers.")
        return {"sum": a + b}

    @staticmethod
    def _utc_now(arguments: dict[str, Any]) -> Any:
        _ = arguments
        return {"utc": datetime.now(timezone.utc).isoformat()}
