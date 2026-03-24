from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import Any, Callable, Dict, List

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
    """Configuration for a single agent run.

    Attributes:
        max_steps: Hard upper limit on the number of turns before the run is
            terminated with ``stop_reason="max_steps_reached"``.
        log_dir: Directory where JSONL trajectory logs are written.
        max_history_turns: Number of most-recent turns to include verbatim in
            the working memory sent to the LLM.
        schema_retry_limit: How many times to retry the LLM in the same turn
            when its output fails schema validation. ``1`` means one retry
            attempt (two LLM calls total) before the turn is marked as a
            schema error.
        max_budget: Optional abstract budget counter. Each LLM call and each
            tool attempt increments the counter by 1. The run stops with
            ``stop_reason="max_budget_reached"`` when the counter exceeds
            this value.
        max_failures: Stop the run with ``stop_reason="max_failures_reached"``
            after this many cumulative failures (schema errors + tool errors).
            ``None`` disables the check.
        tool_retry_limit: Maximum number of automatic retries for tool calls
            that raise :class:`~harness.tools.RetryableToolError`. ``0``
            means no retries.
        snapshot_dir: Directory for per-turn snapshot JSON files. Falls back
            to ``log_dir`` when ``None``.
        dangerous_tools: Tool names whose identical calls are blocked after the
            first execution to prevent unintended side-effect repetition.
        goal_reached_token: When set, a final response that contains this
            token (substring match) changes the stop reason to
            ``"goal_reached"``.
        allowed_write_roots: Absolute path prefixes that ``write_text_file``
            is permitted to write into. An empty tuple disables the tool.
    """

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
    project_root: str = ""
    allow_bash: bool = True
    max_tokens_budget: int | None = None
    trust_level: str = "ask"


class HarnessAgent:
    """Single-agent execution harness.

    Orchestrates the ``memory → llm → tool/final → observe → next turn`` loop
    with strict schema validation, reliability guardrails, and trajectory
    logging.

    Args:
        llm: Any :class:`~harness.llm.BaseLLM` implementation that produces
            structured action dicts.
        config: Runtime configuration. Defaults to :class:`RunConfig` with
            all default values when ``None``.
    """

    def __init__(self, llm: BaseLLM, config: RunConfig | None = None) -> None:
        self.llm = llm
        self.config = config or RunConfig()
        self.tools = ToolDispatcher(allowed_write_roots=list(self.config.allowed_write_roots))
        if self.config.project_root:
            from .tools import register_coding_tools

            register_coding_tools(self.tools, allow_bash=self.config.allow_bash)
        if hasattr(self.llm, "set_tool_schemas"):
            self.llm.set_tool_schemas(self.tools.get_tool_schemas())
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
        on_turn: Callable[["TurnRecord"], None] | None = None,
        on_approve: Callable[[str, str, Dict[str, Any]], bool] | None = None,
        on_token: Callable[[str], None] | None = None,
    ) -> RunResult:
        """Run the agent loop until a stop condition is met.

        Args:
            goal: Natural-language task description passed to the LLM each turn.
            context: Optional key/value pairs injected into working memory.
            resume_from: Path to a snapshot JSON file. When provided, the run
                continues from the saved state rather than starting fresh.
            on_turn: Optional callback invoked after each turn is recorded.
                Receives the completed :class:`~harness.types.TurnRecord`.
                Useful for streaming live output to a UI.
            on_token: Optional callback for streaming token output. Each
                token string is passed as it arrives from the LLM.

        Returns:
            A :class:`~harness.types.RunResult` with the final response, full
            turn history, stop reason, log path, and latest snapshot path.
        """
        self.llm.on_token = on_token
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

        total_tokens = 0

        for _ in range(self.config.max_steps):
            stop_reason = self.stop_controller.check_before_turn(runtime_state) or stop_reason
            if stop_reason == "max_budget_reached":
                break

            turn_idx = len(turns) + 1
            working_memory = self.memory.build_working_memory(
                goal=goal, context=context, turns=turns
            )
            action_result = self._generate_action_with_schema_retry(working_memory)

            # Track token usage from LLM responses
            raw = action_result.get("llm_raw_output")
            if isinstance(raw, dict) and "_usage" in raw:
                total_tokens += raw["_usage"].get("total_tokens", 0)
            if self.config.max_tokens_budget and total_tokens > self.config.max_tokens_budget:
                stop_reason = "token_budget_exceeded"
                break
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
                if on_turn:
                    on_turn(record)
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
                if on_turn:
                    on_turn(record)
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
                on_approve=on_approve,
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
            if on_turn:
                on_turn(record)
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
        """Continue a previous run from a saved snapshot.

        Args:
            snapshot_path: Path to the snapshot JSON file produced by a prior run.

        Returns:
            A :class:`~harness.types.RunResult` continuing from the saved state.
        """
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

    _APPROVAL_REQUIRED_TOOLS = frozenset(
        {
            "bash",
            "edit_file",
            "write_text_file",
            "write_file",
        }
    )

    def _needs_approval(self, tool_name: str) -> bool:
        """Determine if a tool call needs user approval based on trust level."""
        trust = self.config.trust_level
        if trust == "yolo":
            return False
        if trust == "auto-edit":
            return tool_name == "bash"
        # trust == "ask": all sensitive tools need approval
        return tool_name in self._APPROVAL_REQUIRED_TOOLS

    def _execute_tool_call(
        self,
        *,
        tool_name: str,
        arguments: Dict[str, Any],
        dangerous_tool_signatures: List[str],
        on_approve: Callable[[str, str, Dict[str, Any]], bool] | None = None,
    ) -> ToolExecutionResult:
        if self._needs_approval(tool_name):
            if on_approve is None:
                return ToolExecutionResult(
                    ok=False,
                    output=None,
                    error=(
                        f"Tool '{tool_name}' requires approval but no approval "
                        "callback provided. Use --trust yolo or run in "
                        "interactive mode."
                    ),
                )
            desc = self._describe_tool_call(tool_name, arguments)
            if not on_approve(tool_name, desc, arguments):
                return ToolExecutionResult(
                    ok=False,
                    output=None,
                    error="User denied tool execution",
                )

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

    @staticmethod
    def _describe_tool_call(tool_name: str, arguments: Dict[str, Any]) -> str:
        if tool_name == "bash":
            return str(arguments.get("command", ""))
        if tool_name == "edit_file":
            path = arguments.get("path", "")
            old = str(arguments.get("old_text", ""))[:50]
            return f"{path}: {old!r}"
        if tool_name == "write_text_file":
            return str(arguments.get("path", ""))
        if tool_name == "write_file":
            return str(arguments.get("path", ""))
        if tool_name == "glob_files":
            return str(arguments.get("pattern", ""))
        if tool_name == "grep_search":
            return str(arguments.get("pattern", ""))
        if tool_name == "list_directory":
            return str(arguments.get("path", ""))
        return str(arguments)
