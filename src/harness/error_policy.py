from __future__ import annotations

from .types import ToolExecutionResult


class ErrorPolicy:
    def __init__(self, tool_retry_limit: int = 0) -> None:
        self.tool_retry_limit = max(0, tool_retry_limit)

    def should_retry_tool(self, result: ToolExecutionResult, attempt: int) -> bool:
        return (not result.ok) and result.retryable and attempt <= self.tool_retry_limit
