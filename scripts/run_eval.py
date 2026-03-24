"""Batch evaluation entrypoint.

Usage
-----
    # 使用内置示例用例集（rule-based LLM）：
    ./.venv/bin/python scripts/run_eval.py

    # 加载自定义用例 JSON 文件：
    ./.venv/bin/python scripts/run_eval.py --cases path/to/cases.json

    # 保存报告到文件：
    ./.venv/bin/python scripts/run_eval.py --output report.json

Cases file format (JSON array)
-------------------------------
[
  {
    "id": "add_numbers",
    "goal": "please add numbers",
    "context": {},
    "expected_stop_reason": "final_response",
    "expected_keywords": ["5"]
  }
]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.harness import HarnessAgent, RuleBasedLLM, RunConfig  # noqa: E402
from src.harness.eval import BUILTIN_CASES, EvalCase, EvalRunner  # noqa: E402


def load_cases(path: str | None) -> list[EvalCase]:
    if path is None:
        raw_list = BUILTIN_CASES
    else:
        raw_list = json.loads(Path(path).read_text(encoding="utf-8"))

    return [
        EvalCase(
            id=item["id"],
            goal=item["goal"],
            context=item.get("context", {}),
            expected_stop_reason=item.get("expected_stop_reason"),
            expected_keywords=item.get("expected_keywords", []),
        )
        for item in raw_list
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch evaluation runner for the agent harness.")
    parser.add_argument(
        "--cases",
        default=None,
        metavar="FILE",
        help="Path to a JSON file containing eval cases. Uses built-in cases if omitted.",
    )
    parser.add_argument(
        "--output",
        default=None,
        metavar="FILE",
        help="Write JSON report to this file instead of stdout.",
    )
    parser.add_argument("--max-steps", type=int, default=8)
    args = parser.parse_args()

    cases = load_cases(args.cases)
    agent = HarnessAgent(llm=RuleBasedLLM(), config=RunConfig(max_steps=args.max_steps))
    runner = EvalRunner(agent)
    report = runner.run(cases)

    report_dict = report.to_dict()
    output_json = json.dumps(report_dict, ensure_ascii=False, indent=2)

    if args.output:
        Path(args.output).write_text(output_json, encoding="utf-8")
        print(f"Report saved to: {args.output}")
    else:
        print(output_json)

    # Print summary to stderr so it always shows even when piping JSON
    print(
        f"\nResult: {report.passed}/{report.total} passed  "
        f"pass_rate={report.pass_rate:.0%}  "
        f"avg_turns={report.avg_turns:.1f}  "
        f"avg_duration={report.avg_duration_s:.3f}s",
        file=sys.stderr,
    )

    sys.exit(0 if report.failed == 0 else 1)


if __name__ == "__main__":
    main()
