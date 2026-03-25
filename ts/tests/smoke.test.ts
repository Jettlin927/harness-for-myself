import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HarnessAgent } from "../src/agent.js";
import { ScriptedLLM } from "../src/llm.js";

describe("HarnessSmokeTests", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("tool_call then final_response completes normally", async () => {
    const llm = new ScriptedLLM([
      { type: "tool_call", tool_name: "add", arguments: { a: 3, b: 4 } },
      { type: "final_response", content: "sum done" },
    ]);
    const agent = new HarnessAgent(llm, { log_dir: tmpDir, max_steps: 5 });
    const result = await agent.run("please sum numbers");

    expect(result.stop_reason).toBe("final_response");
    expect(result.final_response).toBe("sum done");
    expect(result.turns).toHaveLength(2);

    const logLines = fs
      .readFileSync(result.log_path, "utf-8")
      .trim()
      .split("\n");
    expect(logLines).toHaveLength(2);
    const parsed = logLines.map((line) => JSON.parse(line));
    expect(parsed[0].llm_action.action_type).toBe("tool_call");
  });

  it("direct final_response completes in one turn", async () => {
    const llm = new ScriptedLLM([
      { type: "final_response", content: "hello" },
    ]);
    const agent = new HarnessAgent(llm, { log_dir: tmpDir, max_steps: 3 });
    const result = await agent.run("say hello");

    expect(result.final_response).toBe("hello");
    expect(result.turns).toHaveLength(1);
  });

  it("schema error stops the run", async () => {
    const llm = new ScriptedLLM([
      { type: "tool_call", arguments: {} },
      { type: "tool_call", arguments: {} },
    ]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      max_steps: 3,
      schema_retry_limit: 1,
    });
    const result = await agent.run("bad schema");

    expect(result.stop_reason).toBe("schema_error");
    expect(result.final_response).toContain("Stopped without final response");
  });

  it("schema retry recovers on second attempt", async () => {
    const llm = new ScriptedLLM([
      { type: "tool_call", arguments: {} },
      { type: "final_response", content: "recovered" },
    ]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      max_steps: 3,
      schema_retry_limit: 1,
    });
    const result = await agent.run("recover from schema drift");

    expect(result.stop_reason).toBe("final_response");
    expect(result.final_response).toBe("recovered");
    expect(result.turns[0].llm_action.schema_retry_count).toBe(1);
  });
});
