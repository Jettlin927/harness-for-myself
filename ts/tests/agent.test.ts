import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HarnessAgent } from "../src/agent.js";
import { ScriptedLLM } from "../src/llm.js";

describe("HarnessAgentTests", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("unknown tool observation is recorded and agent can finish", async () => {
    const llm = new ScriptedLLM([
      { type: "tool_call", tool_name: "missing", arguments: {} },
      { type: "final_response", content: "handled" },
    ]);
    const agent = new HarnessAgent(llm, { log_dir: tmpDir, max_steps: 3 });
    const result = await agent.run("try unknown tool");

    expect(result.stop_reason).toBe("final_response");
    expect(result.turns[0].tool_result!.ok).toBe(false);
    expect(result.turns[0].observation).toContain("Unknown tool");
  });

  it("max_steps returns fallback response", async () => {
    const llm = new ScriptedLLM([
      { type: "tool_call", tool_name: "echo", arguments: { text: "loop" } },
    ]);
    const agent = new HarnessAgent(llm, { log_dir: tmpDir, max_steps: 1 });
    const result = await agent.run("never finalize");

    expect(result.stop_reason).toBe("max_steps_reached");
    expect(result.final_response).toContain("Stopped without final response");
  });

  it("run accepts null context", async () => {
    const llm = new ScriptedLLM([
      { type: "final_response", content: "ok" },
    ]);
    const agent = new HarnessAgent(llm, { log_dir: tmpDir, max_steps: 1 });
    const result = await agent.run("direct", null);

    expect(result.final_response).toBe("ok");
    expect(result.turns).toHaveLength(1);
  });

  it("agent can write text file via tool call", async () => {
    const outputPath = path.join(tmpDir, "jingyesi.txt");
    const llm = new ScriptedLLM([
      {
        type: "tool_call",
        tool_name: "write_text_file",
        arguments: {
          path: outputPath,
          content: "床前明月光",
        },
      },
      { type: "final_response", content: "saved" },
    ]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      max_steps: 3,
      allowed_write_roots: [tmpDir],
      trust_level: "yolo",
    });
    const result = await agent.run("save poem");

    expect(result.stop_reason).toBe("final_response");
    expect(fs.readFileSync(outputPath, "utf-8")).toBe("床前明月光");
    expect(result.turns[0].tool_result!.ok).toBe(true);
  });
});
