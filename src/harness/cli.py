"""Command-line interface for the minimal agent harness."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict

from .agent import HarnessAgent, RunConfig
from .llm import BaseLLM, DeepSeekLLM, RuleBasedLLM


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


def _build_agent(args: argparse.Namespace) -> HarnessAgent:
    """Build an agent from parsed CLI args."""
    llm = _build_llm(args.llm, getattr(args, "api_key", None))
    config = RunConfig(
        max_steps=args.max_steps,
        snapshot_dir=args.snapshot_dir,
        log_dir=args.log_dir,
        goal_reached_token=getattr(args, "goal_reached_token", None),
    )
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
            print(f"已删除会话 {state.session_id[:8]}…")
        else:
            print("无活跃会话。")
        return 0

    sessions = mgr.list_sessions()
    if not sessions:
        print("无已保存的会话。")
        return 0

    for s in sessions:
        goals_done = len(s.goals_completed)
        print(f"[{s.session_id[:8]}…]  创建: {s.created_at[:19]}  目标数: {goals_done}")
        for i, g in enumerate(s.goals_completed[-3:], 1):
            goal_short = g["goal"][:60]
            print(f"  {i}. {goal_short}  stop={g['stop_reason']}  turns={g['turns']}")
        if args.verbose and s.accumulated_summary:
            print(f"  摘要:\n    {s.accumulated_summary.replace(chr(10), chr(10) + '    ')}")
        print()

    return 0


def build_parser() -> argparse.ArgumentParser:
    """Build and return the top-level argument parser."""
    parser = argparse.ArgumentParser(
        prog="harness",
        description="Minimal single-agent harness CLI.",
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

    # --- run ---
    run_parser = subparsers.add_parser(
        "run",
        parents=[shared],
        help="Run the agent on a goal.",
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

    return parser


def main() -> None:
    """Entry point registered in pyproject.toml."""
    parser = build_parser()
    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
