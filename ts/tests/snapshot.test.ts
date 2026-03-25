import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SnapshotStore } from "../src/snapshot.js";
import type { TurnRecord } from "../src/types.js";

function makeTurn(turn: number): TurnRecord {
  return {
    turn,
    goal: "snapshot test",
    working_memory: {},
    llm_raw_output: {},
    llm_action: { type: "tool_call" },
    tool_result: null,
    observation: `obs-${turn}`,
  };
}

describe("SnapshotStore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-test-"));
  });

  it("save is atomic (no .tmp residue, valid JSON)", () => {
    const store = new SnapshotStore(tmpDir);
    const state = {
      goal: "test",
      context: {},
      turns: [makeTurn(1)],
      summary: "",
      failure_count: 0,
      budget_used: 0,
      dangerous_tool_signatures: [],
    };
    const filePath = store.save(state);
    const content = fs.readFileSync(filePath, "utf-8");
    const payload = JSON.parse(content);
    expect(payload.goal).toBe("test");
    expect(payload.turns).toHaveLength(1);
    // No .tmp files left behind
    const tmpFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("load corrupted JSON raises ValueError", () => {
    const badPath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(badPath, '{"goal": "test", "turns": [', "utf-8");
    const store = new SnapshotStore(tmpDir);
    expect(() => store.load(badPath)).toThrow(/corrupted/i);
  });

  it("load missing file raises ValueError", () => {
    const store = new SnapshotStore(tmpDir);
    const missing = path.join(tmpDir, "nonexistent.json");
    expect(() => store.load(missing)).toThrow(/not found/i);
  });

  it("roundtrip preserves all fields", () => {
    const store = new SnapshotStore(tmpDir);
    const turns = [makeTurn(1), makeTurn(2)];
    const state = {
      goal: "roundtrip",
      context: { key: "value" },
      turns,
      summary: "test summary",
      failure_count: 1,
      budget_used: 3,
      dangerous_tool_signatures: ["sig1"],
    };
    const filePath = store.save(state);
    const loaded = store.load(filePath);
    expect(loaded.goal).toBe("roundtrip");
    expect(loaded.context).toEqual({ key: "value" });
    expect(loaded.turns).toHaveLength(2);
    expect(loaded.turns[0].observation).toBe("obs-1");
    expect(loaded.turns[1].observation).toBe("obs-2");
    expect(loaded.summary).toBe("test summary");
    expect(loaded.failure_count).toBe(1);
    expect(loaded.budget_used).toBe(3);
    expect(loaded.dangerous_tool_signatures).toEqual(["sig1"]);
  });
});
