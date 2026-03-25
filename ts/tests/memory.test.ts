import { describe, it, expect } from "vitest";
import {
  MemoryManager,
  truncateStr,
  truncateToolResult,
  MAX_OBSERVATION_CHARS,
} from "../src/memory.js";
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

describe("MemoryManager", () => {
  describe("buildWorkingMemory", () => {
    it("returns last maxHistoryTurns entries", () => {
      const memory = new MemoryManager(2);
      const turns = [makeTurn(1, "first"), makeTurn(2, "second"), makeTurn(3, "third")];

      const wm = memory.buildWorkingMemory("goal", { user: "u" }, turns);

      expect(wm.goal).toBe("goal");
      expect(wm.context).toEqual({ user: "u" });
      expect(wm.history).toHaveLength(2);
      expect(wm.history[0].turn).toBe(2);
      expect(wm.history[1].turn).toBe(3);
    });

    it("handles empty turns", () => {
      const memory = new MemoryManager(3);
      const wm = memory.buildWorkingMemory("goal", {}, []);
      expect(wm.history).toEqual([]);
      expect(wm.summary_memory).toBe("");
    });

    it("truncates long observations to MAX_OBSERVATION_CHARS", () => {
      const longObs = "x".repeat(3000);
      const turns = [makeTurn(1, longObs)];
      const memory = new MemoryManager(5);
      const wm = memory.buildWorkingMemory("goal", {}, turns);
      const obs = wm.history[0].observation;
      expect(obs).toContain("[observation truncated at 2000 chars]");
      expect(obs.startsWith("x".repeat(2000))).toBe(true);
    });

    it("does not truncate short observations", () => {
      const shortObs = "hello world";
      const turns = [makeTurn(1, shortObs)];
      const memory = new MemoryManager(5);
      const wm = memory.buildWorkingMemory("goal", {}, turns);
      expect(wm.history[0].observation).toBe(shortObs);
    });

    it("truncates tool_result with long string output", () => {
      const tr: TurnRecord = {
        turn: 1,
        goal: "demo",
        working_memory: {},
        llm_raw_output: {},
        llm_action: { type: "tool_call" },
        tool_result: { ok: true, output: "y".repeat(3000), error: null },
        observation: "ok",
      };
      const memory = new MemoryManager(5);
      const wm = memory.buildWorkingMemory("goal", {}, [tr]);
      const output = (wm.history[0].tool_result as Record<string, unknown>).output as string;
      expect(output).toContain("[observation truncated at 2000 chars]");
      expect(output.startsWith("y".repeat(2000))).toBe(true);
    });

    it("truncates tool_result with nested output.content", () => {
      const tr: TurnRecord = {
        turn: 1,
        goal: "demo",
        working_memory: {},
        llm_raw_output: {},
        llm_action: { type: "tool_call" },
        tool_result: {
          ok: true,
          output: { content: "z".repeat(3000) },
          error: null,
        },
        observation: "ok",
      };
      const memory = new MemoryManager(5);
      const wm = memory.buildWorkingMemory("goal", {}, [tr]);
      const result = wm.history[0].tool_result as Record<string, unknown>;
      const output = result.output as Record<string, unknown>;
      expect(output.content as string).toContain("[observation truncated at 2000 chars]");
    });

    it("returns non-dict tool_result unchanged", () => {
      const tr: TurnRecord = {
        turn: 1,
        goal: "demo",
        working_memory: {},
        llm_raw_output: {},
        llm_action: { type: "tool_call" },
        tool_result: "plain string result" as unknown as Record<string, unknown>,
        observation: "ok",
      };
      const memory = new MemoryManager(5);
      const wm = memory.buildWorkingMemory("goal", {}, [tr]);
      expect(wm.history[0].tool_result).toBe("plain string result");
    });
  });

  describe("maybeCompress", () => {
    it("does not compress at threshold boundary", () => {
      const memory = new MemoryManager(3);
      // threshold = 3 + 4 = 7; 7 turns should NOT trigger
      const turns = Array.from({ length: 7 }, (_, i) => makeTurn(i + 1, `obs-${i + 1}`));
      expect(memory.maybeCompress(turns)).toBe(false);
      expect(memory.summary).toBe("");
    });

    it("compresses when exceeding threshold", () => {
      const memory = new MemoryManager(3);
      // threshold = 7; 8 turns should trigger
      const turns = Array.from({ length: 8 }, (_, i) => makeTurn(i + 1, `obs-${i + 1}`));
      expect(memory.maybeCompress(turns)).toBe(true);
      expect(memory.summary).toContain("turn 5: obs-5");
    });

    it("extracts constraint tags into summary", () => {
      const memory = new MemoryManager(2);
      const turns = [
        makeTurn(1, "constraint: must be fast"),
        makeTurn(2, "normal obs"),
        makeTurn(3, "todo: fix later"),
        makeTurn(4, "evidence: works on linux"),
        makeTurn(5, "obs-5"),
        makeTurn(6, "obs-6"),
        makeTurn(7, "obs-7"),
      ];
      expect(memory.maybeCompress(turns)).toBe(true);
      expect(memory.summary).toContain("Constraints: must be fast");
      expect(memory.summary).toContain("Open items: fix later");
      expect(memory.summary).toContain("Evidence: works on linux");
    });

    it("does not modify turns array", () => {
      const memory = new MemoryManager(3);
      const turns = Array.from({ length: 8 }, (_, i) => makeTurn(i + 1, `obs-${i + 1}`));
      const originalLength = turns.length;
      memory.maybeCompress(turns);
      expect(turns).toHaveLength(originalLength);
    });
  });

  describe("summarizeRun", () => {
    it("produces correct format", () => {
      const memory = new MemoryManager(3);
      const turns = [
        makeTurn(1, "constraint: be safe"),
        makeTurn(2, "evidence: all tests pass"),
        makeTurn(3, "done"),
      ];
      const result = memory.summarizeRun("fix the bug", turns, "goal_reached");
      expect(result).toContain("[Goal: fix the bug]");
      expect(result).toContain("stop=goal_reached");
      expect(result).toContain("turns=3");
      expect(result).toContain("constraints: be safe");
      expect(result).toContain("evidence: all tests pass");
    });
  });
});

describe("truncateStr", () => {
  it("truncates long text", () => {
    const result = truncateStr("a".repeat(3000), 2000);
    expect(result).toHaveLength(2000 + "\n[observation truncated at 2000 chars]".length);
    expect(result).toContain("[observation truncated at 2000 chars]");
  });

  it("returns short text unchanged", () => {
    expect(truncateStr("short", 2000)).toBe("short");
  });
});

describe("truncateToolResult", () => {
  it("returns non-object unchanged", () => {
    expect(truncateToolResult("hello")).toBe("hello");
    expect(truncateToolResult(42)).toBe(42);
    expect(truncateToolResult(null)).toBeNull();
  });
});
