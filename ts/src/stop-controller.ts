/**
 * Stop condition controller — stateless checkers for budget, failure count, and goal token.
 */

export interface StopState {
  budgetUsed: number;
  failureCount: number;
}

export class StopController {
  constructor(
    private readonly maxBudget: number | null = null,
    private readonly maxFailures: number | null = null,
    private readonly goalReachedToken: string | null = null,
  ) {}

  /** Check before a turn starts. Returns stop reason or null. */
  checkBeforeTurn(state: StopState): string | null {
    if (this.maxBudget !== null && state.budgetUsed >= this.maxBudget) {
      return "max_budget_reached";
    }
    return null;
  }

  /** Check after a failure. Returns stop reason or null. */
  checkAfterFailure(state: StopState): string | null {
    if (this.maxFailures !== null && state.failureCount >= this.maxFailures) {
      return "max_failures_reached";
    }
    return null;
  }

  /** Check if content contains the goal-reached token. */
  checkGoalReached(content: string): boolean {
    if (!this.goalReachedToken) return false;
    return content.includes(this.goalReachedToken);
  }
}
