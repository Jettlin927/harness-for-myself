from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal

ActionType = Literal["tool_call", "final_response"]


@dataclass
class LLMAction:
    action_type: ActionType
    raw_output: Any
    tool_name: str | None = None
    arguments: Dict[str, Any] = field(default_factory=dict)
    content: str | None = None


@dataclass
class ToolExecutionResult:
    ok: bool
    output: Any
    error: str | None = None
    retryable: bool = False
    blocked: bool = False
    attempts: int = 1


@dataclass
class TurnRecord:
    turn: int
    goal: str
    working_memory: Dict[str, Any]
    llm_raw_output: Any
    llm_action: Dict[str, Any]
    tool_result: Dict[str, Any] | None
    observation: str


@dataclass
class RunResult:
    final_response: str
    turns: List[TurnRecord]
    stop_reason: str
    log_path: str
    snapshot_path: str | None = None
