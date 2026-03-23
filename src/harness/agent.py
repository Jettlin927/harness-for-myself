from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any, Dict, List

from .error_policy import ErrorPolicy
from .llm import BaseLLM
from .logger import TrajectoryLogger
from .memory import MemoryManager
from .schema import SchemaError, parse_llm_action
from .snapshot import SnapshotStore
from .stop_controller import StopController, StopState
from .tools import ToolDispatcher
from .types import RunResult, ToolExecutionResult, TurnRecord


@dataclass
class RunConfig:
    max_steps: int = 8
    log_dir: str = "logs"
    max_history_turns: int = 8
    schema_retry_limit: int = 1
    max_budget: int | None = None
    max_failures: int | None = 3
    tool_retry_limit: int = 0
    snapshot_dir: str | None = None
    dangerous_tools: tuple[str, ...] = ()
    goal_reached_token: str | None = None
    allowed_write_roots: tuple[str, ...] = ()


class HarnessAgent:
    def __init__(self, llm: BaseLLM, config: RunConfig | None = None) -> None:
        self.llm = llm
        self.config = config or RunConfig()
        self.tools = ToolDispatcher(allowed_write_roots=list(self.config.allowed_write_roots))
        self.memory = MemoryManager(max_history_turns=self.config.max_history_turns)
        self.error_policy = ErrorPolicy(tool_retry_limit=self.config.tool_retry_limit)
        self.snapshot_store = SnapshotStore(self.config.snapshot_dir or self.config.log_dir)
        self.stop_controller = StopController(
            max_budget=self.config.max_budget,
            max_failures=self.config.max_failures,
            goal_reached_token=self.config.goal_reached_token,
        )

    def run(
        self,
        goal: str,
        context: Dict[str, Any] | None = None,
        *,
        resume_from: str | None = None,
    ) -> RunResult:
        state = self._load_state(goal=goal, context=context or {}, resume_from=resume_from)
        goal = state["goal"]
        context = state["context"]
        turns = state["turns"]
        self.memory.summary = state["summary"]
        logger = TrajectoryLogger(self.config.log_dir)
        stop_reason = "max_steps_reached"
        snapshot_path = state.get("snapshot_path")
        dangerous_sigs: List[str] = state["dangerous_tool_signatures"]
        runtime_state = StopState(
            budget_used=state["budget_used"],
            failure_count=state["failure_count"],
        )

        for _ in range(self.config.max_steps):
            stop_reason = self.stop_controller.check_before_turn(runtime_state) or stop_reason
            if stop_reason == "max_budget_reached":
                break

            turn_idx = len(turns) + 1
            working_memory = self.memory.build_working_memory(
                goal=goal, context=context, turns=turns
            )
            action_result = self._generate_action_with_schema_retry(working_memory)
            runtime_state.budget_used += len(action_result["schema_errors"]) + 1
            if not action_result["ok"]:
                runtime_state.failure_count += 1
                stop_reason = (
                    self.stop_controller.check_after_failure(runtime_state) or "schema_error"
                )
                record = TurnRecord(
                    turn=turn_idx,
                    goal=goal,
                    working_memory=working_memory,
                    llm_raw_output=action_result["llm_raw_output"],
                    llm_action={
                        "type": "schema_error",
                        "error": action_result["error"],
                        "schema_errors": action_result["schema_errors"],
                        "attempts": len(action_result["schema_errors"]),
                    },
                    tool_result=None,
                    observation=action_result["error"],
                )
                turns.append(record)
                logger.append(record)
                snapshot_path = self._save_snapshot(
                    goal=goal,
                    context=context,
                    turns=turns,
                    runtime_state=runtime_state,
                    dangerous_tool_signatures=dangerous_sigs,
                )
                break
            action = action_result["action"]
            llm_raw_output = action_result["llm_raw_output"]
            schema_retry_count = len(action_result["schema_errors"])

            if action.action_type == "final_response":
                stop_reason = (
                    "goal_reached"
                    if self.stop_controller.check_goal_reached(action.content or "")
                    else "final_response"
                )
                record = TurnRecord(
                    turn=turn_idx,
                    goal=goal,
                    working_memory=working_memory,
                    llm_raw_output=llm_raw_output,
                    llm_action={**asdict(action), "schema_retry_count": schema_retry_count},
                    tool_result=None,
                    observation=action.content or "",
                )
                turns.append(record)
                logger.append(record)
                snapshot_path = self._save_snapshot(
                    goal=goal,
                    context=context,
                    turns=turns,
                    runtime_state=runtime_state,
                    dangerous_tool_signatures=dangerous_sigs,
                )
                return RunResult(
                    final_response=action.content or "",
                    turns=turns,
                    stop_reason=stop_reason,
                    log_path=str(logger.path),
                    snapshot_path=snapshot_path,
                )

            tool_result = self._execute_tool_call(
                tool_name=action.tool_name or "",
                arguments=action.arguments,
                dangerous_tool_signatures=dangerous_sigs,
            )
            runtime_state.budget_used += tool_result.attempts
            if not tool_result.ok:
                runtime_state.failure_count += 1

            observation = (
                f"tool={action.tool_name}; ok={tool_result.ok}; "
                f"output={tool_result.output}; error={tool_result.error}"
            )
            record = TurnRecord(
                turn=turn_idx,
                goal=goal,
                working_memory=working_memory,
                llm_raw_output=llm_raw_output,
                llm_action={**asdict(action), "schema_retry_count": schema_retry_count},
                tool_result=asdict(tool_result),
                observation=observation,
            )
            turns.append(record)
            logger.append(record)
            self.memory.maybe_compress(turns)
            snapshot_path = self._save_snapshot(
                goal=goal,
                context=context,
                turns=turns,
                runtime_state=runtime_state,
                dangerous_tool_signatures=dangerous_sigs,
            )
            stop_reason = self.stop_controller.check_after_failure(runtime_state) or stop_reason
            if stop_reason == "max_failures_reached":
                break

        final_response = f"Stopped without final response. reason={stop_reason}"
        return RunResult(
            final_response=final_response,
            turns=turns,
            stop_reason=stop_reason,
            log_path=str(logger.path),
            snapshot_path=snapshot_path,
        )

    def resume(self, snapshot_path: str) -> RunResult:
        return self.run(goal="", context=None, resume_from=snapshot_path)

    def _generate_action_with_schema_retry(self, working_memory: Dict[str, Any]) -> Dict[str, Any]:
        schema_errors: List[str] = []
        llm_outputs: List[Any] = []
        llm_input = dict(working_memory)

        for attempt in range(self.config.schema_retry_limit + 1):
            llm_raw_output = self.llm.generate(llm_input)
            llm_outputs.append(llm_raw_output)
            try:
                action = parse_llm_action(llm_raw_output)
                output_for_log: Any = llm_outputs[0] if len(llm_outputs) == 1 else llm_outputs
                return {
                    "ok": True,
                    "action": action,
                    "llm_raw_output": output_for_log,
                    "schema_errors": schema_errors,
                    "error": None,
                }
            except SchemaError as exc:
                schema_errors.append(str(exc))
                if attempt >= self.config.schema_retry_limit:
                    output_for_log = llm_outputs[0] if len(llm_outputs) == 1 else llm_outputs
                    return {
                        "ok": False,
                        "action": None,
                        "llm_raw_output": output_for_log,
                        "schema_errors": schema_errors,
                        "error": str(exc),
                    }
                llm_input = {
                    **working_memory,
                    "schema_feedback": {
                        "last_error": str(exc),
                        "required_types": ["tool_call", "final_response"],
                    },
                }

        return {
            "ok": False,
            "action": None,
            "llm_raw_output": llm_outputs,
            "schema_errors": schema_errors,
            "error": "Unexpected schema retry state.",
        }

    def _load_state(
        self,
        *,
        goal: str,
        context: Dict[str, Any],
        resume_from: str | None,
    ) -> Dict[str, Any]:
        if not resume_from:
            return {
                "goal": goal,
                "context": context,
                "turns": [],
                "summary": "",
                "failure_count": 0,
                "budget_used": 0,
                "dangerous_tool_signatures": [],
                "snapshot_path": None,
            }

        state = self.snapshot_store.load(resume_from)
        return {
            "goal": state["goal"],
            "context": state["context"],
            "turns": state["turns"],
            "summary": state.get("summary", ""),
            "failure_count": int(state.get("failure_count", 0)),
            "budget_used": int(state.get("budget_used", 0)),
            "dangerous_tool_signatures": list(state.get("dangerous_tool_signatures", [])),
            "snapshot_path": str(resume_from),
        }

    def _save_snapshot(
        self,
        *,
        goal: str,
        context: Dict[str, Any],
        turns: List[TurnRecord],
        runtime_state: StopState,
        dangerous_tool_signatures: List[str],
    ) -> str:
        return self.snapshot_store.save(
            {
                "goal": goal,
                "context": context,
                "turns": turns,
                "summary": self.memory.summary,
                "failure_count": runtime_state.failure_count,
                "budget_used": runtime_state.budget_used,
                "dangerous_tool_signatures": dangerous_tool_signatures,
            }
        )

    def _execute_tool_call(
        self,
        *,
        tool_name: str,
        arguments: Dict[str, Any],
        dangerous_tool_signatures: List[str],
    ) -> ToolExecutionResult:
        fingerprint = json.dumps(
            {"tool_name": tool_name, "arguments": arguments}, sort_keys=True, ensure_ascii=False
        )
        if tool_name in self.config.dangerous_tools and fingerprint in dangerous_tool_signatures:
            return ToolExecutionResult(
                ok=False,
                output=None,
                error=f"Repeated dangerous tool call blocked: {tool_name}",
                blocked=True,
            )

        attempt = 0
        while True:
            attempt += 1
            result = self.tools.execute(tool_name, arguments)
            result.attempts = attempt
            if not self.error_policy.should_retry_tool(result, attempt):
                break

        if (
            tool_name in self.config.dangerous_tools
            and fingerprint not in dangerous_tool_signatures
        ):
            dangerous_tool_signatures.append(fingerprint)
        return result
