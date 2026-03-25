import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HarnessAgent } from "../src/agent.js";
import { ScriptedLLM } from "../src/llm.js";
import { MemoryManager } from "../src/memory.js";
import { RetryableToolError } from "../src/types.js";
import type { TurnRecord } from "../src/types.js";

function makeTurn(turn: number, observation: string): TurnRecord {
  return {
    turn,
    goal: "demo",
    working_memory: {},
    llm_raw_output: {},
    llm_action: { type: "tool_call" },
    tool_result: null,
    observation,
  };
}

describe("HarnessReliabilityTests", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reliability-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("goal_reached_token stops run", async () => {
    const llm = new ScriptedLLM([
      { type: "final_response", content: "done GOAL_REACHED" },
      { type: "final_response", content: "should not be used" },
    ]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      goal_reached_token: "GOAL_REACHED",
    });
    const result = await agent.run("finish when marker appears");

    expect(result.stop_reason).toBe("goal_reached");
    expect(result.final_response).toBe("done GOAL_REACHED");
    expect(result.turns).toHaveLength(1);
  });

  it("retryable tool error retries once and succeeds", async () => {
    const llm = new ScriptedLLM([
      { type: "tool_call", tool_name: "flaky", arguments: { value: 7 } },
      { type: "final_response", content: "recovered" },
    ]);
    const attempts = { count: 0 };

    const flaky = (args: Record<string, unknown>): unknown => {
      attempts.count += 1;
      if (attempts.count === 1) {
        throw new RetryableToolError("temporary issue");
      }
      return { value: args.value };
    };

    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      tool_retry_limit: 1,
    });
    agent.tools.registerTool("flaky", flaky);
    const result = await agent.run("call flaky tool");

    expect(result.stop_reason).toBe("final_response");
    expect(attempts.count).toBe(2);
    expect(result.turns[0].tool_result!.ok).toBe(true);
    expect(result.turns[0].tool_result!.attempts).toBe(2);
  });

  it("non-retryable failures stop at max_failures", async () => {
    const llm = new ScriptedLLM([
      { type: "tool_call", tool_name: "missing", arguments: {} },
      { type: "final_response", content: "should not be reached" },
    ]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      max_failures: 1,
    });
    const result = await agent.run("fail fast");

    expect(result.stop_reason).toBe("max_failures_reached");
    expect(result.final_response).toContain("Stopped without final response");
    expect(result.turns).toHaveLength(1);
  });

  it("max_budget stops before extra turn", async () => {
    const llm = new ScriptedLLM([
      { type: "tool_call", tool_name: "echo", arguments: { text: "once" } },
      { type: "final_response", content: "late final" },
    ]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      max_steps: 5,
      max_budget: 2,
    });
    const result = await agent.run("budgeted run");

    expect(result.stop_reason).toBe("max_budget_reached");
    expect(result.turns).toHaveLength(1);
  });

  it("snapshot is persisted and resume continues", async () => {
    const llm = new ScriptedLLM([
      { type: "tool_call", tool_name: "echo", arguments: { text: "first" } },
      { type: "final_response", content: "resumed final" },
    ]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      max_steps: 1,
      snapshot_dir: tmpDir,
    });
    const first = await agent.run("resume demo", { user: "alice" });

    expect(first.stop_reason).toBe("max_steps_reached");
    expect(first.snapshot_path).toBeTruthy();
    expect(fs.existsSync(first.snapshot_path!)).toBe(true);

    const resumed = await agent.resume(first.snapshot_path!);
    expect(resumed.stop_reason).toBe("final_response");
    expect(resumed.final_response).toBe("resumed final");
    expect(resumed.turns).toHaveLength(2);
    expect(resumed.turns[0].goal).toBe("resume demo");

    const payload = JSON.parse(
      fs.readFileSync(first.snapshot_path!, "utf-8"),
    );
    expect(payload.goal).toBe("resume demo");
    expect(payload.context).toEqual({ user: "alice" });
  });

  it("repeated dangerous tool call is blocked", async () => {
    const llm = new ScriptedLLM([
      {
        type: "tool_call",
        tool_name: "delete_file",
        arguments: { path: "/tmp/a" },
      },
      {
        type: "tool_call",
        tool_name: "delete_file",
        arguments: { path: "/tmp/a" },
      },
    ]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      max_steps: 2,
      dangerous_tools: ["delete_file"],
    });
    agent.tools.registerTool(
      "delete_file",
      (args) => ({ deleted: args.path }),
    );
    const result = await agent.run("dangerous repeat");

    expect(result.turns[1].tool_result!.ok).toBe(false);
    expect(result.turns[1].tool_result!.blocked).toBe(true);
    expect(result.turns[1].tool_result!.error).toContain(
      "Repeated dangerous tool call",
    );
  });
});

describe("TokenBudgetTests", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "token-budget-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("token budget exceeded stops run", async () => {
    const llm = new ScriptedLLM([
      {
        type: "tool_call",
        tool_name: "echo",
        arguments: { text: "a" },
        _usage: { total_tokens: 5000 },
      },
      {
        type: "tool_call",
        tool_name: "echo",
        arguments: { text: "b" },
        _usage: { total_tokens: 5000 },
      },
      {
        type: "tool_call",
        tool_name: "echo",
        arguments: { text: "c" },
        _usage: { total_tokens: 5000 },
      },
    ]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      max_steps: 10,
      max_tokens_budget: 8000,
    });
    const result = await agent.run("token budget test");

    expect(result.stop_reason).toBe("token_budget_exceeded");
    expect(result.turns).toHaveLength(1);
  });

  it("token budget null allows unlimited", async () => {
    const llm = new ScriptedLLM([
      {
        type: "tool_call",
        tool_name: "echo",
        arguments: { text: "a" },
        _usage: { total_tokens: 99999 },
      },
      {
        type: "final_response",
        content: "done",
        _usage: { total_tokens: 99999 },
      },
    ]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      max_tokens_budget: null,
    });
    const result = await agent.run("unlimited tokens");

    expect(result.stop_reason).toBe("final_response");
    expect(result.final_response).toBe("done");
  });
});

describe("LongConversationTests", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "long-conv-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("25-turn run completes with compression", async () => {
    const script: Record<string, unknown>[] = [];
    for (let i = 1; i <= 24; i++) {
      script.push({
        type: "tool_call",
        tool_name: "echo",
        arguments: { text: `step ${i}` },
      });
    }
    script.push({ type: "final_response", content: "all 25 turns done" });

    const llm = new ScriptedLLM(script);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      max_steps: 30,
      max_history_turns: 10,
      max_failures: null,
    });
    const result = await agent.run("long conversation test");

    expect(result.stop_reason).toBe("final_response");
    expect(result.turns).toHaveLength(25);
    expect(agent.memory.summary).toBeTruthy();
  });

  it("compression preserves tagged observations", () => {
    const memory = new MemoryManager(5);
    const turns: TurnRecord[] = [
      makeTurn(1, "constraint: must use Python 3.12"),
      makeTurn(2, "todo: add type hints to module X"),
      makeTurn(3, "evidence: root cause is null pointer in line 42"),
      makeTurn(4, "normal observation"),
      makeTurn(5, "normal observation"),
      makeTurn(6, "normal observation"),
      makeTurn(7, "normal observation"),
      makeTurn(8, "normal observation"),
      makeTurn(9, "normal observation"),
      makeTurn(10, "normal observation"),
      makeTurn(11, "normal observation"),
      makeTurn(12, "normal observation"),
      makeTurn(13, "normal observation"),
      makeTurn(14, "normal observation"),
      makeTurn(15, "normal observation"),
      makeTurn(16, "normal observation"),
      makeTurn(17, "normal observation"),
      makeTurn(18, "normal observation"),
      makeTurn(19, "normal observation"),
      makeTurn(20, "final observation"),
    ];

    const compressed = memory.maybeCompress(turns, 9);

    expect(compressed).toBe(true);
    expect(memory.summary).toContain("must use Python 3.12");
    expect(memory.summary).toContain("add type hints to module X");
    expect(memory.summary).toContain(
      "root cause is null pointer in line 42",
    );
  });

  it("working memory stays bounded", () => {
    for (const maxHist of [4, 8, 12]) {
      const memory = new MemoryManager(maxHist);
      const turns: TurnRecord[] = [];
      let wm: ReturnType<MemoryManager["buildWorkingMemory"]>;
      for (let i = 1; i <= 30; i++) {
        turns.push(makeTurn(i, `observation ${i}`));
        wm = memory.buildWorkingMemory("bounded test", {}, turns);
        expect(wm.history.length).toBeLessThanOrEqual(maxHist);
      }
      expect(wm!.history).toHaveLength(maxHist);
    }
  });
});

describe("MemoryCompactionTests", () => {
  it("summary preserves constraints, todos, and evidence", () => {
    const memory = new MemoryManager(2);
    const turns: TurnRecord[] = [
      makeTurn(1, "constraint: stay within budget"),
      makeTurn(2, "todo: still need final answer"),
      makeTurn(3, "evidence: api returned 200"),
      makeTurn(4, "plain observation"),
      makeTurn(5, "recent"),
    ];

    const compressed = memory.maybeCompress(turns, 4);

    expect(compressed).toBe(true);
    expect(memory.summary).toContain("Constraints: stay within budget");
    expect(memory.summary).toContain("Open items: still need final answer");
    expect(memory.summary).toContain("Evidence: api returned 200");
  });
});
