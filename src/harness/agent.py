from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, List

from .llm import BaseLLM
from .logger import TrajectoryLogger
from .memory import MemoryManager
from .schema import SchemaError, parse_llm_action
from .tools import ToolDispatcher
from .types import RunResult, TurnRecord


@dataclass
class RunConfig:
    max_steps: int = 8
    log_dir: str = "logs"
    max_history_turns: int = 8
    schema_retry_limit: int = 1


class HarnessAgent:
    def __init__(self, llm: BaseLLM, config: RunConfig | None = None) -> None:
        self.llm = llm
        self.config = config or RunConfig()
        self.tools = ToolDispatcher()
        self.memory = MemoryManager(max_history_turns=self.config.max_history_turns)

    def run(self, goal: str, context: Dict[str, Any] | None = None) -> RunResult:
        context = context or {}
        turns: List[TurnRecord] = []
        logger = TrajectoryLogger(self.config.log_dir)
        stop_reason = "max_steps_reached"

        for turn_idx in range(1, self.config.max_steps + 1):
            working_memory = self.memory.build_working_memory(goal=goal, context=context, turns=turns)
            action_result = self._generate_action_with_schema_retry(working_memory)
            if not action_result["ok"]:
                stop_reason = "schema_error"
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
                break
            action = action_result["action"]
            llm_raw_output = action_result["llm_raw_output"]
            schema_retry_count = len(action_result["schema_errors"])

            if action.action_type == "final_response":
                stop_reason = "final_response"
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
                return RunResult(
                    final_response=action.content or "",
                    turns=turns,
                    stop_reason=stop_reason,
                    log_path=str(logger.path),
                )

            tool_result = self.tools.execute(action.tool_name or "", action.arguments)
            observation = f"tool={action.tool_name}; ok={tool_result.ok}; output={tool_result.output}; error={tool_result.error}"
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

        final_response = f"Stopped without final response. reason={stop_reason}"
        return RunResult(
            final_response=final_response,
            turns=turns,
            stop_reason=stop_reason,
            log_path=str(logger.path),
        )

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
