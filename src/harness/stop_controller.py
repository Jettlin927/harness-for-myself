from __future__ import annotations

from dataclasses import dataclass


@dataclass
class StopState:
    budget_used: int = 0
    failure_count: int = 0


class StopController:
    def __init__(
        self,
        *,
        max_budget: int | None = None,
        max_failures: int | None = None,
        goal_reached_token: str | None = None,
    ) -> None:
        self.max_budget = max_budget
        self.max_failures = max_failures
        self.goal_reached_token = goal_reached_token

    def check_before_turn(self, state: StopState) -> str | None:
        if self.max_budget is not None and state.budget_used >= self.max_budget:
            return "max_budget_reached"
        return None

    def check_after_failure(self, state: StopState) -> str | None:
        if self.max_failures is not None and state.failure_count >= self.max_failures:
            return "max_failures_reached"
        return None

    def check_goal_reached(self, content: str) -> bool:
        if not self.goal_reached_token:
            return False
        return self.goal_reached_token in content
