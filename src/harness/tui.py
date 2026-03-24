"""Interactive terminal UI for the agent harness.

Provides a multi-turn chat experience similar to Claude Code:
- spinner while the agent is thinking / calling tools
- coloured panels for each turn (tool_call, final_response, errors)
- persistent session loop until the user exits
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict

from rich.console import Console
from rich.markup import escape
from rich.panel import Panel
from rich.prompt import Prompt
from rich.text import Text

from .session import SessionManager, SessionState

if TYPE_CHECKING:
    from .agent import HarnessAgent
    from .types import TurnRecord

# ── icons & palette ──────────────────────────────────────────────────────────
_ICON_TOOL = "⚙"
_ICON_OK = "✓"
_ICON_ERR = "✗"
_ICON_SCHEMA = "⚠"
_ICON_AGENT = "◆"
_ICON_USER = "▸"

_STYLE_TOOL = "bold blue"
_STYLE_OK = "green"
_STYLE_ERR = "red"
_STYLE_SCHEMA_ERR = "red"
_STYLE_FINAL = "bold green"
_STYLE_DIM = "dim"
_STYLE_HEADER = "bold cyan"


# ── helpers ───────────────────────────────────────────────────────────────────


def _fmt_arguments(arguments: dict[str, Any]) -> str:
    """Format tool arguments as a compact key=value block."""
    if not arguments:
        return "[dim](no arguments)[/dim]"
    lines = (f"[dim]{k}[/dim] = [yellow]{escape(repr(v))}[/yellow]" for k, v in arguments.items())
    return "  " + "\n  ".join(lines)


def _render_tool_turn(record: "TurnRecord") -> Panel:
    action = record.llm_action
    tool_name = action.get("tool_name", "?")
    arguments: dict[str, Any] = action.get("arguments") or {}

    body = Text.assemble(
        (f"{_ICON_TOOL} ", _STYLE_TOOL),
        (tool_name, "bold"),
        "\n",
    )

    args_text = _fmt_arguments(arguments)
    body.append_text(Text.from_markup(args_text))

    tool_result = record.tool_result or {}
    ok = tool_result.get("ok", False)
    output = tool_result.get("output")
    error = tool_result.get("error")
    blocked = tool_result.get("blocked", False)
    attempts = tool_result.get("attempts", 1)

    body.append("\n")
    if ok:
        body.append_text(
            Text.from_markup(f"[{_STYLE_OK}]{_ICON_OK} {escape(str(output))}[/{_STYLE_OK}]")
        )
    elif blocked:
        body.append_text(
            Text.from_markup(
                f"[{_STYLE_ERR}]{_ICON_ERR} blocked: {escape(str(error))}[/{_STYLE_ERR}]"
            )
        )
    else:
        retry_note = f"  (attempts: {attempts})" if attempts > 1 else ""
        body.append_text(
            Text.from_markup(
                f"[{_STYLE_ERR}]{_ICON_ERR} {escape(str(error))}{retry_note}[/{_STYLE_ERR}]"
            )
        )

    schema_retries = action.get("schema_retry_count", 0)
    if schema_retries:
        body.append(f"\n[dim]schema retry: {schema_retries}x[/dim]")

    title_tool = (
        f"[{_STYLE_DIM}]Turn {record.turn}[/{_STYLE_DIM}]  [{_STYLE_TOOL}]Tool Call[/{_STYLE_TOOL}]"
    )
    return Panel(
        body,
        title=title_tool,
        title_align="left",
        border_style="blue",
        padding=(0, 1),
    )


def _render_final_turn(record: "TurnRecord") -> Panel:
    action = record.llm_action
    content = action.get("content") or record.observation

    schema_retries = action.get("schema_retry_count", 0)
    footer = f"\n[dim]schema retry: {schema_retries}x[/dim]" if schema_retries else ""

    title_final = (
        f"[{_STYLE_DIM}]Turn {record.turn}[/{_STYLE_DIM}]"
        f"  [{_STYLE_FINAL}]{_ICON_OK} Final Response[/{_STYLE_FINAL}]"
    )
    return Panel(
        Text.from_markup(f"{escape(content)}{footer}"),
        title=title_final,
        title_align="left",
        border_style="green",
        padding=(0, 1),
    )


def _render_schema_error_turn(record: "TurnRecord") -> Panel:
    action = record.llm_action
    error = action.get("error", "Unknown schema error")
    attempts = action.get("attempts", 1)

    body = Text.from_markup(
        f"[{_STYLE_SCHEMA_ERR}]{_ICON_SCHEMA} {escape(str(error))}[/{_STYLE_SCHEMA_ERR}]"
        f"\n[dim]attempts: {attempts}[/dim]"
    )
    title_err = (
        f"[{_STYLE_DIM}]Turn {record.turn}[/{_STYLE_DIM}]  "
        f"[{_STYLE_ERR}]Schema Error[/{_STYLE_ERR}]"
    )
    return Panel(
        body,
        title=title_err,
        title_align="left",
        border_style="red",
        padding=(0, 1),
    )


def render_turn(record: "TurnRecord") -> Panel:
    """Render a single :class:`~harness.types.TurnRecord` as a rich Panel."""
    action = record.llm_action
    action_type = action.get("action_type") or action.get("type", "unknown")

    if action_type == "tool_call":
        return _render_tool_turn(record)
    if action_type == "final_response":
        return _render_final_turn(record)
    return _render_schema_error_turn(record)


# ── InteractiveSession ────────────────────────────────────────────────────────


class InteractiveSession:
    """Multi-turn interactive session with a Claude-Code-style terminal UI.

    Each user input triggers a full agent run. Turns are rendered live as the
    agent executes them: a spinner shows while the LLM/tools are working, and
    each completed turn is printed immediately via the ``on_turn`` callback.

    Session state is persisted to ``~/.harness/sessions/`` so that context
    accumulates across goals and survives process restarts.

    Args:
        agent: A configured :class:`~harness.agent.HarnessAgent` instance.
        console: Optional :class:`rich.console.Console`. A default console is
            created when ``None``.
        session_dir: Directory for session files. Defaults to
            ``~/.harness/sessions/``.
        new_session: If ``True``, always start a new session ignoring any
            existing one.
    """

    def __init__(
        self,
        agent: "HarnessAgent",
        console: Console | None = None,
        session_dir: Path | str | None = None,
        new_session: bool = False,
    ) -> None:
        self.agent = agent
        self.console = console or Console()
        self._status: Any = None  # rich Status object; active between turns
        self._streaming: bool = False
        self._session_mgr = SessionManager(session_dir)
        self._session: SessionState = self._init_session(new_session)

    # ── public ────────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the interactive chat loop. Runs until the user exits."""
        self._print_banner()
        try:
            while True:
                goal = self._prompt_goal()
                if goal is None:
                    break
                if goal:
                    self._run_goal(goal)
        except KeyboardInterrupt:
            pass
        finally:
            self._stop_status()
        self.console.print(f"\n[{_STYLE_DIM}]Goodbye![/{_STYLE_DIM}]\n")

    # ── private ───────────────────────────────────────────────────────────────

    def _init_session(self, new_session: bool) -> SessionState:
        """Load the latest session or create a new one, with user confirmation."""
        if new_session:
            state = self._session_mgr.load_or_create()
            self._session_mgr.save(state)
            return state

        existing = self._session_mgr.latest()
        if existing and existing.goals_completed:
            try:
                answer = Prompt.ask(
                    f"[{_STYLE_DIM}]Found previous session "
                    f"({len(existing.goals_completed)} goals completed). "
                    f"Continue?[/{_STYLE_DIM}]",
                    choices=["y", "n"],
                    default="y",
                )
            except (EOFError, KeyboardInterrupt):
                answer = "n"
            if answer == "y":
                return existing

        state = self._session_mgr.load_or_create()
        self._session_mgr.save(state)
        return state

    def _print_banner(self) -> None:
        goals_done = len(self._session.goals_completed)
        sid = self._session.session_id[:8]
        if goals_done:
            session_info = (
                f"  [{_STYLE_DIM}]Session {sid}...  "
                f"{goals_done} goals completed[/{_STYLE_DIM}]"
            )
        else:
            session_info = (
                f"  [{_STYLE_DIM}]New session {sid}...[/{_STYLE_DIM}]"
            )
        yolo_warn = ""
        if self.agent.config.trust_level == "yolo":
            yolo_warn = (
                "\n  [bold red]⚠ YOLO mode: all operations execute "
                "without confirmation[/bold red]"
            )
        self.console.print()
        self.console.print(
            Panel.fit(
                f"[{_STYLE_HEADER}]HAU[/{_STYLE_HEADER}]  "
                f"[{_STYLE_DIM}]v0.1.0  •  Enter a goal to chat, "
                f"Ctrl+C or exit to quit[/{_STYLE_DIM}]"
                + session_info
                + yolo_warn,
                border_style="cyan",
                padding=(0, 2),
            )
        )
        self.console.print()

    def _prompt_goal(self) -> str | None:
        """Show the user prompt and return the input string, or None to exit."""
        try:
            goal = Prompt.ask(f"[bold green]{_ICON_USER} You[/bold green]").strip()
        except (EOFError, KeyboardInterrupt):
            return None
        if goal.lower() in {"exit", "quit", "q", "bye", "\\q"}:
            return None
        return goal

    def _on_token(self, token: str) -> None:
        """Print streaming tokens directly to console."""
        self._stop_status()
        self.console.print(token, end="", highlight=False)
        self._streaming = True

    def _run_goal(self, goal: str) -> None:
        self.console.print()
        t0 = time.monotonic()

        # Build context from accumulated session summary
        context: dict = {}
        if self._session.accumulated_summary:
            context["session_history"] = self._session.accumulated_summary

        # Start spinner for the first LLM call
        self._streaming = False
        self._start_status("Thinking...")

        def on_turn(record: "TurnRecord") -> None:
            if self._streaming:
                self.console.print()  # newline after streaming output
                self._streaming = False
            self._stop_status()
            self.console.print(render_turn(record))

            action_type = (
                record.llm_action.get("action_type")
                or record.llm_action.get("type", "")
            )
            if action_type == "tool_call":
                self._start_status("Thinking...")

        try:
            result = self.agent.run(
                goal=goal,
                context=context,
                on_turn=on_turn,
                on_approve=self._approve_tool,
                on_token=self._on_token,
            )
        except KeyboardInterrupt:
            self._stop_status()
            self.console.print(f"\n[{_STYLE_DIM}]Interrupted[/{_STYLE_DIM}]\n")
            return
        finally:
            self._stop_status()

        # Persist session state after each completed run
        self._session_mgr.update(
            self._session,
            goal=goal,
            stop_reason=result.stop_reason,
            turns=len(result.turns),
            snapshot_path=result.snapshot_path,
        )
        self._session_mgr.save(self._session)

        duration = time.monotonic() - t0
        self._print_summary(result, duration)

    def _approve_tool(
        self,
        tool_name: str,
        description: str,
        arguments: Dict[str, Any],
    ) -> bool:
        """Prompt the user for approval before running a sensitive tool."""
        _ = arguments
        self._stop_status()
        short = (
            description[:80] + "..." if len(description) > 80
            else description
        )
        try:
            answer = Prompt.ask(
                f"[yellow]{_ICON_SCHEMA} Allow [bold]{tool_name}"
                f"[/bold]: {escape(short)}?[/yellow]",
                choices=["y", "n"],
                default="y",
            )
        except (EOFError, KeyboardInterrupt):
            return False
        approved = answer.lower() == "y"
        if approved:
            self._start_status("Running tool...")
        return approved

    def _print_summary(self, result: Any, duration: float) -> None:
        stop = result.stop_reason
        turns = len(result.turns)
        log = result.log_path

        stop_style = _STYLE_OK if stop in ("final_response", "goal_reached") else _STYLE_ERR
        self.console.print(
            f"  [{_STYLE_DIM}]"
            f"[/{_STYLE_DIM}][{stop_style}]{_ICON_OK}[/{stop_style}]"
            f"  stop=[bold]{stop}[/bold]"
            f"  {turns} turns"
            f"  [{_STYLE_DIM}]{duration:.2f}s[/{_STYLE_DIM}]"
            f"  [{_STYLE_DIM}]{escape(log)}[/{_STYLE_DIM}]"
        )
        self.console.print()

    def _start_status(self, message: str) -> None:
        self._status = self.console.status(f"[{_STYLE_DIM}]{message}[/{_STYLE_DIM}]")
        self._status.start()

    def _stop_status(self) -> None:
        if self._status is not None:
            self._status.stop()
            self._status = None
