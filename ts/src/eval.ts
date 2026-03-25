/**
 * Evaluation runner for batch-testing the agent harness against defined cases.
 * Loads eval cases, runs HarnessAgent, compares output against expectations.
 */

import type { HarnessAgent } from "./agent.js";

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface EvalCase {
  id: string;
  goal: string;
  context?: Record<string, unknown>;
  expected_stop_reason?: string;
  expected_keywords?: string[];
}

export interface EvalCaseResult {
  id: string;
  passed: boolean;
  stop_reason: string;
  turns: number;
  final_response: string;
  failures: string[];
  duration_s: number;
}

export interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  avg_turns: number;
  avg_duration_s: number;
  results: EvalCaseResult[];
  config_version: string;
  toDict(): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Built-in regression cases
// ---------------------------------------------------------------------------

export const BUILTIN_CASES: EvalCase[] = [
  {
    id: "add_numbers",
    goal: "please add numbers",
    expected_stop_reason: "final_response",
    expected_keywords: ["5"],
  },
  {
    id: "get_time",
    goal: "what is the current time",
    expected_stop_reason: "final_response",
    expected_keywords: [],
  },
  {
    id: "direct_answer",
    goal: "hello world",
    expected_stop_reason: "final_response",
    expected_keywords: [],
  },
];

// ---------------------------------------------------------------------------
// EvalRunner
// ---------------------------------------------------------------------------

export class EvalRunner {
  private agent: HarnessAgent;

  constructor(agent: HarnessAgent) {
    this.agent = agent;
  }

  /**
   * Run all cases and return an aggregated EvalReport.
   */
  async run(
    cases: EvalCase[],
    configVersion: string = "unversioned",
  ): Promise<EvalReport> {
    const results: EvalCaseResult[] = [];
    for (const c of cases) {
      const result = await this._runCase(c);
      results.push(result);
    }

    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const avgTurns = total > 0 ? results.reduce((s, r) => s + r.turns, 0) / total : 0;
    const avgDuration =
      total > 0 ? results.reduce((s, r) => s + r.duration_s, 0) / total : 0;

    const report: EvalReport = {
      total,
      passed,
      failed: total - passed,
      pass_rate: total > 0 ? passed / total : 0,
      avg_turns: avgTurns,
      avg_duration_s: avgDuration,
      results,
      config_version: configVersion,
      toDict() {
        return {
          total: this.total,
          passed: this.passed,
          failed: this.failed,
          pass_rate: this.pass_rate,
          avg_turns: this.avg_turns,
          avg_duration_s: this.avg_duration_s,
          results: this.results.map((r) => ({ ...r })),
          config_version: this.config_version,
        };
      },
    };

    return report;
  }

  /**
   * Run a single eval case and return the result.
   */
  private async _runCase(evalCase: EvalCase): Promise<EvalCaseResult> {
    const t0 = performance.now();
    const runResult = await this.agent.run(
      evalCase.goal,
      evalCase.context ? { ...evalCase.context } : {},
    );
    const duration = (performance.now() - t0) / 1000;

    const failures: string[] = [];

    if (
      evalCase.expected_stop_reason &&
      runResult.stop_reason !== evalCase.expected_stop_reason
    ) {
      failures.push(
        `stop_reason: expected='${evalCase.expected_stop_reason}', ` +
          `actual='${runResult.stop_reason}'`,
      );
    }

    const responseLower = runResult.final_response.toLowerCase();
    const keywords = evalCase.expected_keywords ?? [];
    for (const kw of keywords) {
      if (!responseLower.includes(kw.toLowerCase())) {
        failures.push(`missing keyword in response: '${kw}'`);
      }
    }

    return {
      id: evalCase.id,
      passed: failures.length === 0,
      stop_reason: runResult.stop_reason,
      turns: runResult.turns.length,
      final_response: runResult.final_response,
      failures,
      duration_s: Math.round(duration * 1000) / 1000,
    };
  }
}
