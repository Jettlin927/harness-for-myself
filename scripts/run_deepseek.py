from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.harness import DeepSeekLLM, HarnessAgent, RunConfig  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the harness with DeepSeek API.")
    parser.add_argument("goal", help="Task/goal for the harness agent.")
    parser.add_argument("--max-steps", type=int, default=8)
    parser.add_argument("--context", default="{}", help="JSON object string")
    parser.add_argument("--model", default="deepseek-chat")
    parser.add_argument("--api-key", default=None, help="Optional DeepSeek API key override.")
    parser.add_argument("--save-root", default="~/Desktop/test")
    args = parser.parse_args()

    context = json.loads(args.context)
    save_root = str(Path(args.save_root).expanduser().resolve())
    context = {
        **context,
        "allowed_write_dir": save_root,
        "tooling_hint": (
            "If the user asks to save text locally, use write_text_file with an absolute path "
            f"under {save_root}."
        ),
    }
    api_key = args.api_key or os.environ.get("DEEPSEEK_API_KEY")

    llm = DeepSeekLLM(api_key=api_key, model=args.model)
    agent = HarnessAgent(
        llm=llm,
        config=RunConfig(
            max_steps=args.max_steps,
            allowed_write_roots=(save_root,),
        ),
    )
    result = agent.run(goal=args.goal, context=context)

    print("final_response:", result.final_response)
    print("stop_reason:", result.stop_reason)
    print("turns:", len(result.turns))
    print("log_path:", result.log_path)
    print("allowed_write_dir:", save_root)


if __name__ == "__main__":
    main()
