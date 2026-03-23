from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict

from .types import ToolExecutionResult


class RetryableToolError(RuntimeError):
    """Raised when a tool failure can be retried safely."""


class ToolDispatcher:
    def __init__(self, allowed_write_roots: list[str | Path] | None = None) -> None:
        self.allowed_write_roots = [
            Path(root).expanduser().resolve()
            for root in (allowed_write_roots or [])
        ]
        self._tools: Dict[str, Callable[[dict[str, Any]], Any]] = {}
        self.register_tool("echo", self._echo)
        self.register_tool("add", self._add)
        self.register_tool("utc_now", self._utc_now)
        self.register_tool("write_text_file", self._write_text_file)

    def register_tool(self, name: str, tool: Callable[[dict[str, Any]], Any]) -> None:
        self._tools[name] = tool

    def execute(self, tool_name: str, arguments: dict[str, Any]) -> ToolExecutionResult:
        tool = self._tools.get(tool_name)
        if tool is None:
            return ToolExecutionResult(ok=False, output=None, error=f"Unknown tool: {tool_name}")

        try:
            output = tool(arguments)
            return ToolExecutionResult(ok=True, output=output)
        except RetryableToolError as exc:
            return ToolExecutionResult(ok=False, output=None, error=str(exc), retryable=True)
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

    def _write_text_file(self, arguments: dict[str, Any]) -> Any:
        raw_path = arguments.get("path")
        content = arguments.get("content")
        if not isinstance(raw_path, str) or not raw_path.strip():
            raise ValueError("write_text_file requires non-empty string 'path'.")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("write_text_file requires non-empty string 'content'.")
        if not self.allowed_write_roots:
            raise ValueError("write_text_file is disabled because no write roots are configured.")

        target_path = Path(raw_path).expanduser()
        if not target_path.is_absolute():
            raise ValueError("write_text_file requires an absolute 'path'.")
        resolved_target = target_path.resolve()
        if not self._is_within_allowed_roots(resolved_target):
            raise ValueError("write_text_file target is outside allowed write roots.")

        resolved_target.parent.mkdir(parents=True, exist_ok=True)
        resolved_target.write_text(content, encoding="utf-8")
        return {
            "path": str(resolved_target),
            "bytes_written": len(content.encode("utf-8")),
        }

    def _is_within_allowed_roots(self, target_path: Path) -> bool:
        for root in self.allowed_write_roots:
            if target_path == root or root in target_path.parents:
                return True
        return False
