from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.harness import HarnessAgent, RuleBasedLLM, RunConfig  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Run HAU MVP loop.")
    parser.add_argument("goal", help="Task/goal for the harness agent.")
    parser.add_argument("--max-steps", type=int, default=8)
    parser.add_argument("--context", default="{}", help="JSON object string")
    args = parser.parse_args()

    context = json.loads(args.context)
    agent = HarnessAgent(llm=RuleBasedLLM(), config=RunConfig(max_steps=args.max_steps))
    result = agent.run(goal=args.goal, context=context)

    print("final_response:", result.final_response)
    print("stop_reason:", result.stop_reason)
    print("turns:", len(result.turns))
    print("log_path:", result.log_path)


if __name__ == "__main__":
    main()
