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

from .definitions import AgentDefinition, SkillDefinition
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
        self._total_tokens: int = 0
        self._project_context: dict[str, Any] = {}
        if self.agent.config.project_root:
            from .context import load_project_context

            self._project_context = load_project_context(Path(self.agent.config.project_root))

        # Load skill definitions from .hau/skills/
        self._skills: dict[str, SkillDefinition] = {}
        self._agent_defs: list[AgentDefinition] = []
        if self._project_context:
            project_root = self._project_context.get("project_root", "")
            if project_root:
                from .definitions import load_agent_definitions, load_skill_definitions

                hau_dir = Path(project_root) / ".hau"
                for skill in load_skill_definitions(hau_dir):
                    self._skills[skill.name] = skill
                self._agent_defs = load_agent_definitions(hau_dir)

        # Auto-approve flag for "a" (allow all) in approval prompt
        self._auto_approve_this_goal: bool = False

    # ── public ────────────────────────────────────────────────────────────────

    @staticmethod
    def _expand_skill(
        goal: str, skills: dict[str, SkillDefinition]
    ) -> tuple[str | None, str | None]:
        """Expand a /skill command.

        Returns ``(expanded_goal, None)`` on success,
        ``(None, error_message)`` for unknown skill,
        or ``(goal, None)`` unchanged when *goal* is not a slash command.
        """
        if not goal.startswith("/"):
            return goal, None

        skill_name = goal.lstrip("/").split()[0]
        extra_args = goal[len(skill_name) + 2 :].strip()  # +2 for "/" and space
        skill = skills.get(skill_name)
        if skill is None:
            available = ", ".join(f"/{s}" for s in sorted(skills))
            msg = f"Unknown skill: /{skill_name}"
            if available:
                msg += f"\nAvailable: {available}"
            return None, msg

        expanded = skill.body
        if extra_args:
            expanded += f"\n\nAdditional context: {extra_args}"
        return expanded, None

    def start(self) -> None:
        """Start the interactive chat loop. Runs until the user exits."""
        self._print_banner()
        try:
            while True:
                goal = self._prompt_goal()
                if goal is None:
                    break
                if not goal:
                    continue

                # Built-in command handling
                if goal.startswith("/"):
                    if self._handle_command(goal):
                        continue

                    # Skill expansion (only if not a built-in command)
                    if self._skills:
                        expanded, err = self._expand_skill(goal, self._skills)
                        if err is not None:
                            self.console.print(f"[red]{err.splitlines()[0]}[/red]")
                            if "\n" in err:
                                self.console.print(f"[dim]{err.split(chr(10), 1)[1]}[/dim]")
                            continue
                        if expanded is not None:
                            skill_name = goal.lstrip("/").split()[0]
                            skill = self._skills[skill_name]
                            self.console.print(
                                f"[dim]Skill: {skill.name} — {skill.description}[/dim]"
                            )
                            goal = expanded

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
        trust = self.agent.config.trust_level
        max_steps = self.agent.config.max_steps

        # Line 1: project info
        project_lang = "unknown"
        branch = "n/a"
        if self._project_context:
            pt = self._project_context.get("project_type", {})
            langs = ", ".join(pt.get("languages", []))
            if langs:
                project_lang = langs
            git = self._project_context.get("git")
            branch = git.get("branch", "?") if git else "not a git repo"

        line1 = (
            f"[{_STYLE_DIM}]Project:[/{_STYLE_DIM}] {project_lang}  "
            f"[{_STYLE_DIM}]Branch:[/{_STYLE_DIM}] {branch}  "
            f"[{_STYLE_DIM}]Trust:[/{_STYLE_DIM}] {trust}  "
            f"[{_STYLE_DIM}]Steps:[/{_STYLE_DIM}] {max_steps}"
        )

        # Line 2: session info
        if goals_done:
            line2 = f"[{_STYLE_DIM}]Session:[/{_STYLE_DIM}] {sid}  ({goals_done} goals completed)"
        else:
            line2 = f"[{_STYLE_DIM}]Session:[/{_STYLE_DIM}] {sid}  (new)"

        # Line 3: commands
        line3 = f"\n[{_STYLE_DIM}]命令:[/{_STYLE_DIM}] /help /skills /agents /status /trust /clear"

        # Line 4: skills (if any)
        line4 = ""
        if self._skills:
            skill_list = ", ".join(f"/{name}" for name in sorted(self._skills))
            line4 = f"\n[{_STYLE_DIM}]Skills:[/{_STYLE_DIM}] {skill_list}"

        # Line 5: usage hint
        line5 = f"\n[{_STYLE_DIM}]输入任务开始对话，exit 退出[/{_STYLE_DIM}]"

        # Line 6: YOLO warning (conditional)
        line6 = ""
        if trust == "yolo":
            line6 = "\n[bold red]⚠ YOLO 模式：所有操作自动执行[/bold red]"

        body = f"{line1}\n{line2}{line3}{line4}{line5}{line6}"

        self.console.print()
        self.console.print(
            Panel(
                body,
                title=f"[{_STYLE_HEADER}]HAU v0.1.0[/{_STYLE_HEADER}]",
                title_align="left",
                border_style="cyan",
                padding=(0, 1),
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

    def _handle_command(self, cmd: str) -> bool:
        """Handle a built-in /command. Returns True if the command was handled."""
        parts = cmd.strip().split(None, 1)
        command = parts[0].lower()
        arg = parts[1].strip() if len(parts) > 1 else ""

        if command == "/help":
            self.console.print(
                Panel(
                    "[bold]可用命令[/bold]\n"
                    "  /help        显示此帮助信息\n"
                    "  /skills      列出所有已加载的 skill\n"
                    "  /agents      列出所有已加载的 agent 定义\n"
                    "  /status      显示当前会话状态\n"
                    "  /trust MODE  修改信任级别 (ask/auto-edit/yolo)\n"
                    "  /clear       新建会话，重置状态\n"
                    "\n[dim]输入 /skillname 可展开对应 skill 为任务[/dim]",
                    title="[bold cyan]Help[/bold cyan]",
                    title_align="left",
                    border_style="cyan",
                    padding=(0, 1),
                )
            )
            return True

        if command == "/skills":
            if not self._skills:
                self.console.print("[dim]没有已加载的 skill[/dim]")
            else:
                lines = []
                for name in sorted(self._skills):
                    skill = self._skills[name]
                    lines.append(f"  [bold]/{name}[/bold]  {skill.description}")
                self.console.print(
                    Panel(
                        "\n".join(lines),
                        title="[bold cyan]Skills[/bold cyan]",
                        title_align="left",
                        border_style="cyan",
                        padding=(0, 1),
                    )
                )
            return True

        if command == "/agents":
            if not self._agent_defs:
                self.console.print("[dim]没有已加载的 agent 定义[/dim]")
            else:
                lines = []
                for agent_def in self._agent_defs:
                    lines.append(f"  [bold]{agent_def.name}[/bold]  {agent_def.description}")
                self.console.print(
                    Panel(
                        "\n".join(lines),
                        title="[bold cyan]Agents[/bold cyan]",
                        title_align="left",
                        border_style="cyan",
                        padding=(0, 1),
                    )
                )
            return True

        if command == "/status":
            goals_done = len(self._session.goals_completed)
            sid = self._session.session_id[:8]
            trust = self.agent.config.trust_level
            token_line = (
                f"  Token 用量:      ~{self._total_tokens:,}" if self._total_tokens > 0 else ""
            )
            self.console.print(
                Panel(
                    f"  Session ID:      {sid}\n"
                    f"  Goals completed: {goals_done}\n"
                    f"  Trust level:     {trust}\n"
                    f"  Max steps:       {self.agent.config.max_steps}"
                    + (f"\n{token_line}" if token_line else ""),
                    title="[bold cyan]Status[/bold cyan]",
                    title_align="left",
                    border_style="cyan",
                    padding=(0, 1),
                )
            )
            return True

        if command == "/trust":
            valid_levels = {"ask", "auto-edit", "yolo"}
            if arg not in valid_levels:
                self.console.print(f"[red]用法: /trust <{'|'.join(sorted(valid_levels))}>[/red]")
                return True
            old_level = self.agent.config.trust_level
            self.agent.config.trust_level = arg
            self.console.print(f"[green]{_ICON_OK} Trust level: {old_level} -> {arg}[/green]")
            return True

        if command == "/clear":
            self._session = self._session_mgr.load_or_create()
            self._session_mgr.save(self._session)
            sid = self._session.session_id[:8]
            self.console.print(f"[green]{_ICON_OK} 新会话已创建: {sid}[/green]")
            return True

        return False

    def _on_token(self, token: str) -> None:
        """Print streaming tokens directly to console."""
        self._stop_status()
        self.console.print(token, end="", highlight=False)
        self._streaming = True

    def _run_goal(self, goal: str) -> None:
        self._auto_approve_this_goal = False
        self.console.print()
        t0 = time.monotonic()

        # Build context from accumulated session summary
        context: dict = {}
        if self._session.accumulated_summary:
            context["session_history"] = self._session.accumulated_summary
        if self._project_context:
            context["project"] = self._project_context

        # Start spinner for the first LLM call
        self._streaming = False
        self._start_status(f"Thinking... (Step 1/{self.agent.config.max_steps})")

        def on_turn(record: "TurnRecord") -> None:
            if self._streaming:
                self.console.print()  # newline after streaming output
                self._streaming = False
            self._stop_status()
            self.console.print(render_turn(record))

            action_type = record.llm_action.get("action_type") or record.llm_action.get("type", "")
            if action_type == "tool_call":
                turn_num = record.turn
                max_steps = self.agent.config.max_steps
                self._start_status(f"Thinking... (Step {turn_num}/{max_steps})")

        def on_compress() -> None:
            self._stop_status()
            self.console.print(
                f"  [{_STYLE_DIM}]ℹ 早期对话已压缩为摘要以节省上下文空间[/{_STYLE_DIM}]"
            )
            self._start_status("Thinking...")

        try:
            result = self.agent.run(
                goal=goal,
                context=context,
                on_turn=on_turn,
                on_approve=self._approve_tool,
                on_token=self._on_token,
                on_compress=on_compress,
            )
        except KeyboardInterrupt:
            self._stop_status()
            self.console.print(f"\n[{_STYLE_DIM}]Interrupted[/{_STYLE_DIM}]\n")
            return
        finally:
            self._stop_status()

        self._total_tokens += result.total_tokens

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
        if self._auto_approve_this_goal:
            return True
        self._stop_status()

        # Show diff preview for edit_file
        if tool_name == "edit_file":
            import difflib

            path = arguments.get("path", "")
            old_text = arguments.get("old_text", "")
            new_text = arguments.get("new_text", "")
            if old_text and new_text:
                diff = difflib.unified_diff(
                    old_text.splitlines(keepends=True),
                    new_text.splitlines(keepends=True),
                    fromfile=f"a/{Path(path).name}",
                    tofile=f"b/{Path(path).name}",
                )
                diff_str = "".join(diff)
                if diff_str:
                    self.console.print(
                        Panel(
                            escape(diff_str),
                            title=f"edit_file: {path}",
                            border_style="yellow",
                        )
                    )

        short = description[:80] + "..." if len(description) > 80 else description
        try:
            answer = Prompt.ask(
                f"[yellow]{_ICON_SCHEMA} Allow [bold]{tool_name}[/bold]: "
                f"{escape(short)}?[/yellow]  [dim](y/n/a)[/dim]",
                choices=["y", "n", "a"],
                default="y",
            )
        except (EOFError, KeyboardInterrupt):
            return False
        if answer.lower() == "a":
            self._auto_approve_this_goal = True
            self._start_status("Running tool...")
            return True
        approved = answer.lower() == "y"
        if approved:
            self._start_status("Running tool...")
        return approved

    def _print_summary(self, result: Any, duration: float) -> None:
        stop = result.stop_reason
        turns = len(result.turns)
        log = result.log_path
        tokens = getattr(result, "total_tokens", 0)

        tokens_info = f"  ~{tokens:,} tokens" if tokens > 0 else ""
        stop_style = _STYLE_OK if stop in ("final_response", "goal_reached") else _STYLE_ERR
        icon = _ICON_OK if stop in ("final_response", "goal_reached") else _ICON_ERR
        self.console.print(
            f"  [{stop_style}]{icon}[/{stop_style}] {stop}  "
            f"{turns} turns  {duration:.1f}s{tokens_info}"
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
