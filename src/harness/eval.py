"""Evaluation runner for batch-testing the agent harness against defined cases."""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List


@dataclass
class EvalCase:
    """A single evaluation case.

    Attributes:
        id: Unique identifier for the case.
        goal: The task goal string passed to the agent.
        context: Optional extra context dict.
        expected_stop_reason: If set, the run is considered passing only when
            ``RunResult.stop_reason`` matches this value.
        expected_keywords: If non-empty, the run is considered passing only when
            every keyword appears (case-insensitive) in the final response.
    """

    id: str
    goal: str
    context: Dict[str, Any] = field(default_factory=dict)
    expected_stop_reason: str | None = None
    expected_keywords: List[str] = field(default_factory=list)


@dataclass
class EvalCaseResult:
    """Result of running a single eval case.

    Attributes:
        id: Case identifier.
        passed: Whether all expectations were met.
        stop_reason: Actual stop reason from the run.
        turns: Number of turns used.
        final_response: Final response text.
        failures: List of failure reasons (empty when passed).
        duration_s: Wall-clock duration in seconds.
    """

    id: str
    passed: bool
    stop_reason: str
    turns: int
    final_response: str
    failures: List[str]
    duration_s: float


@dataclass
class EvalReport:
    """Aggregated results across all eval cases.

    Attributes:
        total: Total number of cases.
        passed: Number of cases that passed.
        failed: Number of cases that failed.
        pass_rate: Fraction of cases that passed (0.0–1.0).
        avg_turns: Average number of turns across all cases.
        avg_duration_s: Average wall-clock duration per case.
        results: Per-case results.
    """

    total: int
    passed: int
    failed: int
    pass_rate: float
    avg_turns: float
    avg_duration_s: float
    results: List[EvalCaseResult]

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a plain dict suitable for JSON output."""
        return asdict(self)


class EvalRunner:
    """Runs a list of :class:`EvalCase` objects against a :class:`HarnessAgent`.

    Example::

        from harness import HarnessAgent, RunConfig, RuleBasedLLM
        from harness.eval import EvalCase, EvalRunner

        cases = [
            EvalCase(
                id="add_numbers",
                goal="please add numbers",
                expected_stop_reason="final_response",
                expected_keywords=["5"],
            ),
        ]
        agent = HarnessAgent(llm=RuleBasedLLM(), config=RunConfig())
        runner = EvalRunner(agent)
        report = runner.run(cases)
        print(report.pass_rate)
    """

    def __init__(self, agent: Any) -> None:
        """
        Args:
            agent: A :class:`~harness.agent.HarnessAgent` instance.
        """
        self.agent = agent

    def run(self, cases: List[EvalCase]) -> EvalReport:
        """Run all cases and return an aggregated :class:`EvalReport`.

        Args:
            cases: List of eval cases to execute.

        Returns:
            An :class:`EvalReport` with per-case results and aggregate metrics.
        """
        results: List[EvalCaseResult] = []
        for case in cases:
            result = self._run_case(case)
            results.append(result)

        total = len(results)
        passed = sum(1 for r in results if r.passed)
        avg_turns = sum(r.turns for r in results) / total if total else 0.0
        avg_duration = sum(r.duration_s for r in results) / total if total else 0.0

        return EvalReport(
            total=total,
            passed=passed,
            failed=total - passed,
            pass_rate=passed / total if total else 0.0,
            avg_turns=avg_turns,
            avg_duration_s=avg_duration,
            results=results,
        )

    def _run_case(self, case: EvalCase) -> EvalCaseResult:
        t0 = time.monotonic()
        run_result = self.agent.run(goal=case.goal, context=dict(case.context))
        duration = time.monotonic() - t0

        failures: List[str] = []

        if case.expected_stop_reason and run_result.stop_reason != case.expected_stop_reason:
            failures.append(
                f"stop_reason: expected={case.expected_stop_reason!r}, "
                f"actual={run_result.stop_reason!r}"
            )

        response_lower = run_result.final_response.lower()
        for kw in case.expected_keywords:
            if kw.lower() not in response_lower:
                failures.append(f"missing keyword in response: {kw!r}")

        return EvalCaseResult(
            id=case.id,
            passed=len(failures) == 0,
            stop_reason=run_result.stop_reason,
            turns=len(run_result.turns),
            final_response=run_result.final_response,
            failures=failures,
            duration_s=round(duration, 3),
        )
