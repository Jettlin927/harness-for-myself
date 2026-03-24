"""Interactive multi-turn chat entrypoint (no install required).

Usage
-----
    ./.venv/bin/python scripts/run_chat.py
    ./.venv/bin/python scripts/run_chat.py --llm deepseek
    ./.venv/bin/python scripts/run_chat.py --max-steps 12
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.harness.agent import HarnessAgent, RunConfig  # noqa: E402
from src.harness.llm import DeepSeekLLM, RuleBasedLLM  # noqa: E402
from src.harness.tui import InteractiveSession  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Interactive multi-turn agent chat.")
    parser.add_argument(
        "--llm",
        choices=["rule", "deepseek"],
        default="rule",
        help="LLM backend (default: rule)",
    )
    parser.add_argument("--api-key", default=None, help="DeepSeek API key")
    parser.add_argument("--max-steps", type=int, default=8, metavar="N")
    parser.add_argument("--log-dir", default="logs", metavar="DIR")
    args = parser.parse_args()

    llm = DeepSeekLLM(api_key=args.api_key) if args.llm == "deepseek" else RuleBasedLLM()
    agent = HarnessAgent(llm=llm, config=RunConfig(max_steps=args.max_steps, log_dir=args.log_dir))
    InteractiveSession(agent).start()


if __name__ == "__main__":
    main()
