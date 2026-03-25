/**
 * Tests for EvalRunner — offline regression evaluation framework.
 * Translated from Python eval.py test scenarios + spec in 16-eval.md.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HarnessAgent } from "../src/agent.js";
import { ScriptedLLM } from "../src/llm.js";
import {
  BUILTIN_CASES,
  EvalRunner,
  type EvalCase,
  type EvalCaseResult,
  type EvalReport,
} from "../src/eval.js";

describe("EvalRunner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Helper: create an agent with a ScriptedLLM that always returns final_response. */
  function makeAgent(responses: Array<Record<string, unknown>>): HarnessAgent {
    const llm = new ScriptedLLM(responses);
    return new HarnessAgent(llm, { log_dir: tmpDir, max_steps: 5 });
  }

  // -------------------------------------------------------------------------
  // Basic run
  // -------------------------------------------------------------------------

  it("single passing case with keyword match", async () => {
    const agent = makeAgent([{ type: "final_response", content: "The answer is 5" }]);
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [
      {
        id: "add_numbers",
        goal: "please add numbers",
        expected_stop_reason: "final_response",
        expected_keywords: ["5"],
      },
    ];

    const report = await runner.run(cases);

    expect(report.total).toBe(1);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.pass_rate).toBe(1.0);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].passed).toBe(true);
    expect(report.results[0].failures).toEqual([]);
    expect(report.results[0].stop_reason).toBe("final_response");
    expect(report.results[0].turns).toBe(1);
  });

  it("single failing case — wrong stop_reason", async () => {
    // Agent hits max_steps → stop_reason = "max_steps_reached"
    const llm = new ScriptedLLM([
      { type: "tool_call", tool_name: "echo", arguments: { text: "loop" } },
    ]);
    const agent = new HarnessAgent(llm, { log_dir: tmpDir, max_steps: 1 });
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [
      {
        id: "should_finish",
        goal: "do something",
        expected_stop_reason: "final_response",
        expected_keywords: [],
      },
    ];

    const report = await runner.run(cases);

    expect(report.total).toBe(1);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.pass_rate).toBe(0.0);
    expect(report.results[0].passed).toBe(false);
    expect(report.results[0].failures.length).toBeGreaterThan(0);
    expect(report.results[0].failures[0]).toContain("stop_reason");
  });

  it("single failing case — missing keyword", async () => {
    const agent = makeAgent([{ type: "final_response", content: "hello world" }]);
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [
      {
        id: "keyword_miss",
        goal: "say something with 5",
        expected_stop_reason: "final_response",
        expected_keywords: ["5", "banana"],
      },
    ];

    const report = await runner.run(cases);

    expect(report.passed).toBe(0);
    expect(report.failed).toBe(1);
    const result = report.results[0];
    expect(result.passed).toBe(false);
    // Should have failures for both missing keywords
    expect(result.failures.length).toBe(2);
    expect(result.failures[0]).toContain("5");
    expect(result.failures[1]).toContain("banana");
  });

  it("keyword match is case-insensitive", async () => {
    const agent = makeAgent([{ type: "final_response", content: "Hello WORLD" }]);
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [
      {
        id: "case_insensitive",
        goal: "greet",
        expected_stop_reason: "final_response",
        expected_keywords: ["hello", "world"],
      },
    ];

    const report = await runner.run(cases);

    expect(report.passed).toBe(1);
    expect(report.results[0].passed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Multiple cases
  // -------------------------------------------------------------------------

  it("multiple cases — mixed pass/fail", async () => {
    // We need separate agents per case, but EvalRunner uses one agent.
    // ScriptedLLM pops responses in order, so we provide responses for both cases.
    const llm = new ScriptedLLM([
      { type: "final_response", content: "result is 5" },
      { type: "final_response", content: "no keyword here" },
    ]);
    const agent = new HarnessAgent(llm, { log_dir: tmpDir, max_steps: 5 });
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [
      {
        id: "pass_case",
        goal: "add",
        expected_stop_reason: "final_response",
        expected_keywords: ["5"],
      },
      {
        id: "fail_case",
        goal: "find banana",
        expected_stop_reason: "final_response",
        expected_keywords: ["banana"],
      },
    ];

    const report = await runner.run(cases);

    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.pass_rate).toBe(0.5);
    expect(report.results[0].passed).toBe(true);
    expect(report.results[1].passed).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Aggregation
  // -------------------------------------------------------------------------

  it("avg_turns and avg_duration_s are computed", async () => {
    const llm = new ScriptedLLM([
      { type: "final_response", content: "a" },
      { type: "final_response", content: "b" },
    ]);
    const agent = new HarnessAgent(llm, { log_dir: tmpDir, max_steps: 5 });
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [
      { id: "c1", goal: "g1" },
      { id: "c2", goal: "g2" },
    ];

    const report = await runner.run(cases);

    expect(report.avg_turns).toBe(1);
    expect(report.avg_duration_s).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // config_version
  // -------------------------------------------------------------------------

  it("config_version is passed through to report", async () => {
    const agent = makeAgent([{ type: "final_response", content: "ok" }]);
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [{ id: "v1", goal: "test" }];

    const report = await runner.run(cases, "v2.1");

    expect(report.config_version).toBe("v2.1");
  });

  it("config_version defaults to 'unversioned'", async () => {
    const agent = makeAgent([{ type: "final_response", content: "ok" }]);
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [{ id: "v1", goal: "test" }];

    const report = await runner.run(cases);

    expect(report.config_version).toBe("unversioned");
  });

  // -------------------------------------------------------------------------
  // Context
  // -------------------------------------------------------------------------

  it("context defaults to empty object if not provided", async () => {
    const agent = makeAgent([{ type: "final_response", content: "ok" }]);
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [{ id: "no_ctx", goal: "test" }];

    const report = await runner.run(cases);

    expect(report.passed).toBe(1);
  });

  it("context is passed through to agent.run", async () => {
    const agent = makeAgent([{ type: "final_response", content: "ok" }]);
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [
      { id: "with_ctx", goal: "test", context: { key: "value" } },
    ];

    const report = await runner.run(cases);

    expect(report.passed).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Optional expected fields
  // -------------------------------------------------------------------------

  it("no expected_stop_reason means any stop_reason passes", async () => {
    // Agent hits max_steps but no expected_stop_reason → still passes
    const llm = new ScriptedLLM([
      { type: "tool_call", tool_name: "echo", arguments: { text: "x" } },
    ]);
    const agent = new HarnessAgent(llm, { log_dir: tmpDir, max_steps: 1 });
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [
      { id: "any_reason", goal: "whatever" },
    ];

    const report = await runner.run(cases);

    // No stop_reason check → passes (no keyword check either)
    expect(report.results[0].passed).toBe(true);
  });

  it("empty expected_keywords means no keyword check", async () => {
    const agent = makeAgent([{ type: "final_response", content: "anything" }]);
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [
      {
        id: "no_kw",
        goal: "test",
        expected_stop_reason: "final_response",
        expected_keywords: [],
      },
    ];

    const report = await runner.run(cases);

    expect(report.results[0].passed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Duration tracking
  // -------------------------------------------------------------------------

  it("duration_s is recorded for each case", async () => {
    const agent = makeAgent([{ type: "final_response", content: "ok" }]);
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [{ id: "dur", goal: "test" }];

    const report = await runner.run(cases);

    expect(report.results[0].duration_s).toBeGreaterThanOrEqual(0);
    expect(typeof report.results[0].duration_s).toBe("number");
  });

  // -------------------------------------------------------------------------
  // BUILTIN_CASES
  // -------------------------------------------------------------------------

  it("BUILTIN_CASES has expected structure", () => {
    expect(BUILTIN_CASES.length).toBe(3);
    expect(BUILTIN_CASES[0].id).toBe("add_numbers");
    expect(BUILTIN_CASES[1].id).toBe("get_time");
    expect(BUILTIN_CASES[2].id).toBe("direct_answer");

    for (const c of BUILTIN_CASES) {
      expect(c.goal).toBeTruthy();
      expect(c.expected_stop_reason).toBe("final_response");
      expect(Array.isArray(c.expected_keywords)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Empty cases list
  // -------------------------------------------------------------------------

  it("empty cases list returns zero report", async () => {
    const agent = makeAgent([]);
    const runner = new EvalRunner(agent);

    const report = await runner.run([]);

    expect(report.total).toBe(0);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.pass_rate).toBe(0);
    expect(report.avg_turns).toBe(0);
    expect(report.avg_duration_s).toBe(0);
    expect(report.results).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // EvalCaseResult fields
  // -------------------------------------------------------------------------

  it("result includes final_response text", async () => {
    const agent = makeAgent([{ type: "final_response", content: "hello 42" }]);
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [{ id: "resp", goal: "test" }];

    const report = await runner.run(cases);

    expect(report.results[0].final_response).toBe("hello 42");
    expect(report.results[0].id).toBe("resp");
  });

  // -------------------------------------------------------------------------
  // toDict serialization
  // -------------------------------------------------------------------------

  it("report toDict returns plain object", async () => {
    const agent = makeAgent([{ type: "final_response", content: "ok" }]);
    const runner = new EvalRunner(agent);
    const cases: EvalCase[] = [{ id: "ser", goal: "test" }];

    const report = await runner.run(cases);
    const dict = report.toDict();

    expect(typeof dict).toBe("object");
    expect(dict.total).toBe(1);
    expect(dict.passed).toBe(1);
    expect(Array.isArray(dict.results)).toBe(true);
    expect(dict.config_version).toBe("unversioned");
    // Should be JSON-serializable
    const json = JSON.stringify(dict);
    expect(json).toBeTruthy();
  });
});
