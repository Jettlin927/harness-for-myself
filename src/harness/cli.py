"""Command-line interface for HAU (Harness for Yourself)."""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict

from .agent import HarnessAgent, RunConfig
from .llm import BaseLLM, DeepSeekLLM, RuleBasedLLM


def _load_strategy_config(path: str | None) -> "StrategyConfig | None":
    """Load a StrategyConfig from *path*, or return None if path is None."""
    if path is None:
        return None
    from .config import StrategyConfig

    return StrategyConfig.load(path)


def _build_llm(llm_name: str, api_key: str | None) -> BaseLLM:
    """Instantiate an LLM backend by name."""
    if llm_name == "deepseek":
        return DeepSeekLLM(api_key=api_key)
    if llm_name == "rule":
        return RuleBasedLLM()
    raise ValueError(f"Unknown LLM backend: {llm_name!r}. Choose 'rule' or 'deepseek'.")


def _parse_context(raw: str) -> Dict[str, Any]:
    """Parse a JSON string into a context dict."""
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"--context must be valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise SystemExit("--context must be a JSON object ({})")
    return value


def _build_run_config(args: argparse.Namespace) -> RunConfig:
    """Build a RunConfig from parsed CLI args, optionally seeded by --config."""
    project_root = getattr(args, "project_root", "") or ""
    allow_bash = getattr(args, "allow_bash", True)

    strategy = _load_strategy_config(getattr(args, "config", None))
    if strategy is not None:
        base = strategy.to_run_config()
        base.max_steps = args.max_steps
        base.snapshot_dir = getattr(args, "snapshot_dir", base.snapshot_dir)
        base.log_dir = getattr(args, "log_dir", base.log_dir)
        base.goal_reached_token = (
            getattr(args, "goal_reached_token", None)
            or base.goal_reached_token
        )
        base.project_root = project_root
        base.allow_bash = allow_bash
        return base
    return RunConfig(
        max_steps=args.max_steps,
        snapshot_dir=getattr(args, "snapshot_dir", None),
        log_dir=getattr(args, "log_dir", "logs"),
        goal_reached_token=getattr(args, "goal_reached_token", None),
        project_root=project_root,
        allow_bash=allow_bash,
    )


def _build_agent(args: argparse.Namespace) -> HarnessAgent:
    """Build an agent from parsed CLI args."""
    llm = _build_llm(args.llm, getattr(args, "api_key", None))
    config = _build_run_config(args)
    return HarnessAgent(llm=llm, config=config)


def _print_result(result: Any) -> None:
    """Print a RunResult summary to stdout."""
    print(f"final_response: {result.final_response}")
    print(f"stop_reason:    {result.stop_reason}")
    print(f"turns:          {len(result.turns)}")
    print(f"log_path:       {result.log_path}")
    if result.snapshot_path:
        print(f"snapshot_path:  {result.snapshot_path}")


def cmd_run(args: argparse.Namespace) -> int:
    """Execute the `run` subcommand."""
    agent = _build_agent(args)
    context = _parse_context(args.context)
    result = agent.run(goal=args.goal, context=context)
    _print_result(result)
    return 0


def cmd_resume(args: argparse.Namespace) -> int:
    """Execute the `resume` subcommand."""
    agent = _build_agent(args)
    result = agent.resume(snapshot_path=args.snapshot)
    _print_result(result)
    return 0


def cmd_chat(args: argparse.Namespace) -> int:
    """Execute the `chat` subcommand (interactive multi-turn TUI)."""
    from .tui import InteractiveSession

    agent = _build_agent(args)
    InteractiveSession(agent, new_session=getattr(args, "new_session", False)).start()
    return 0


def cmd_session(args: argparse.Namespace) -> int:
    """Execute the `session` subcommand."""
    from .session import SessionManager

    mgr = SessionManager()

    if getattr(args, "reset", False):
        state = mgr.latest()
        if state:
            mgr.delete(state.session_id)
            print(f"Deleted session {state.session_id[:8]}...")
        else:
            print("No active sessions.")
        return 0

    sessions = mgr.list_sessions()
    if not sessions:
        print("No saved sessions.")
        return 0

    for s in sessions:
        goals_done = len(s.goals_completed)
        print(f"[{s.session_id[:8]}...]  created: {s.created_at[:19]}  goals: {goals_done}")
        for i, g in enumerate(s.goals_completed[-3:], 1):
            goal_short = g["goal"][:60]
            print(f"  {i}. {goal_short}  stop={g['stop_reason']}  turns={g['turns']}")
        if args.verbose and s.accumulated_summary:
            print(f"  summary:\n    {s.accumulated_summary.replace(chr(10), chr(10) + '    ')}")
        print()

    return 0


def cmd_eval(args: argparse.Namespace) -> int:
    """Execute the `eval` subcommand (batch regression evaluation)."""
    import json as _json
    from pathlib import Path

    from .eval import BUILTIN_CASES, EvalCase, EvalRunner

    # Load cases
    if args.cases:
        raw_list = _json.loads(Path(args.cases).read_text(encoding="utf-8"))
    else:
        raw_list = BUILTIN_CASES

    cases = [
        EvalCase(
            id=item["id"],
            goal=item["goal"],
            context=item.get("context", {}),
            expected_stop_reason=item.get("expected_stop_reason"),
            expected_keywords=item.get("expected_keywords", []),
        )
        for item in raw_list
    ]

    # Build agent (uses --llm, --max-steps, --config from shared args)
    agent = _build_agent(args)

    # Determine config_version for the report
    strategy = _load_strategy_config(getattr(args, "config", None))
    config_version = strategy.version if strategy is not None else "unversioned"

    runner = EvalRunner(agent)
    report = runner.run(cases, config_version=config_version)

    report_dict = report.to_dict()
    output_json = _json.dumps(report_dict, ensure_ascii=False, indent=2)

    if args.output:
        Path(args.output).write_text(output_json, encoding="utf-8")
        print(f"Report saved to: {args.output}")
    else:
        print(output_json)

    print(
        f"\nResult: {report.passed}/{report.total} passed  "
        f"pass_rate={report.pass_rate:.0%}  "
        f"avg_turns={report.avg_turns:.1f}  "
        f"avg_duration={report.avg_duration_s:.3f}s  "
        f"config={report.config_version}",
        file=sys.stderr,
    )

    return 0 if report.failed == 0 else 1


def build_parser() -> argparse.ArgumentParser:
    """Build and return the top-level argument parser."""
    parser = argparse.ArgumentParser(
        prog="harness",
        description="HAU — Harness for Yourself.",
    )
    parser.add_argument(
        "-V", "--version", action="version", version="%(prog)s 0.1.0",
    )
    subparsers = parser.add_subparsers(dest="command", metavar="COMMAND")
    subparsers.required = True

    # --- shared options ---
    shared = argparse.ArgumentParser(add_help=False)
    shared.add_argument(
        "--llm",
        choices=["rule", "deepseek"],
        default="rule",
        help="LLM backend to use (default: rule)",
    )
    shared.add_argument("--api-key", default=None, help="API key (deepseek only)")
    shared.add_argument("--max-steps", type=int, default=8, metavar="N")
    shared.add_argument("--snapshot-dir", default=None, metavar="DIR")
    shared.add_argument("--log-dir", default="logs", metavar="DIR")
    shared.add_argument(
        "--config",
        default=None,
        metavar="FILE",
        help="Path to a StrategyConfig JSON file. CLI flags override config values.",
    )

    # --- run ---
    run_parser = subparsers.add_parser(
        "run",
        parents=[shared],
        help="Run the agent on a goal.",
    )
    run_parser.add_argument(
        "--project-root",
        default=os.getcwd(),
        metavar="DIR",
        help="Project directory for coding tools (default: cwd).",
    )
    run_parser.add_argument(
        "--no-bash",
        dest="allow_bash",
        action="store_false",
        default=True,
        help="Disable the bash tool.",
    )
    run_parser.add_argument("goal", help="Task goal for the agent.")
    run_parser.add_argument(
        "--context", default="{}", metavar="JSON", help="Extra context as a JSON object."
    )
    run_parser.add_argument(
        "--goal-reached-token",
        default=None,
        metavar="TOKEN",
        help="Stop early when this token appears in the final response.",
    )
    run_parser.set_defaults(func=cmd_run)

    # --- resume ---
    resume_parser = subparsers.add_parser(
        "resume",
        parents=[shared],
        help="Resume a run from a saved snapshot.",
    )
    resume_parser.add_argument("snapshot", help="Path to the snapshot JSON file.")
    resume_parser.add_argument(
        "--goal-reached-token",
        default=None,
        metavar="TOKEN",
        help="Stop early when this token appears in the final response.",
    )
    resume_parser.set_defaults(func=cmd_resume)

    # --- chat ---
    chat_parser = subparsers.add_parser(
        "chat",
        parents=[shared],
        help="Start an interactive multi-turn chat session (visual TUI).",
    )
    chat_parser.add_argument(
        "--project-root",
        default=os.getcwd(),
        metavar="DIR",
        help="Project directory for coding tools (default: cwd).",
    )
    chat_parser.add_argument(
        "--no-bash",
        dest="allow_bash",
        action="store_false",
        default=True,
        help="Disable the bash tool.",
    )
    chat_parser.add_argument(
        "--new-session",
        action="store_true",
        default=False,
        help="Start a fresh session, ignoring any existing saved session.",
    )
    chat_parser.set_defaults(func=cmd_chat)

    # --- session ---
    session_parser = subparsers.add_parser(
        "session",
        help="List or manage saved sessions.",
    )
    session_parser.add_argument(
        "--reset",
        action="store_true",
        default=False,
        help="Delete the most recent session.",
    )
    session_parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        default=False,
        help="Show accumulated summary for each session.",
    )
    session_parser.set_defaults(func=cmd_session)

    # --- eval ---
    eval_parser = subparsers.add_parser(
        "eval",
        parents=[shared],
        help="Run batch regression evaluation against a case set.",
    )
    eval_parser.add_argument(
        "--cases",
        default=None,
        metavar="FILE",
        help="Path to a JSON file of eval cases. Uses built-in cases if omitted.",
    )
    eval_parser.add_argument(
        "--output",
        default=None,
        metavar="FILE",
        help="Write JSON report to this file instead of stdout.",
    )
    eval_parser.set_defaults(func=cmd_eval)

    return parser


def main() -> None:
    """Entry point registered in pyproject.toml."""
    parser = build_parser()
    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
