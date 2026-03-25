/**
 * Error policy — determines whether a failed tool call should be retried.
 */

import type { ToolExecutionResult } from "./types.js";

export class ErrorPolicy {
  public readonly toolRetryLimit: number;

  constructor(toolRetryLimit = 0) {
    this.toolRetryLimit = Math.max(0, toolRetryLimit);
  }

  /** Returns true if the tool should be retried. */
  shouldRetryTool(result: ToolExecutionResult, attempt: number): boolean {
    return !result.ok && result.retryable && attempt <= this.toolRetryLimit;
  }
}
