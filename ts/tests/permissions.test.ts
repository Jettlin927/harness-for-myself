import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessAgent } from "../src/agent.js";
import { ScriptedLLM } from "../src/llm.js";

// ---------------------------------------------------------------------------
// _needsApproval logic tests
// ---------------------------------------------------------------------------

describe("TestNeedsApproval", () => {
  function makeAgent(trust: string): HarnessAgent {
    return new HarnessAgent(new ScriptedLLM([]), {
      trust_level: trust as "ask" | "auto-edit" | "yolo",
    });
  }

  // -- ask mode --

  it("ask mode: bash needs approval", () => {
    expect(makeAgent("ask")._needsApproval("bash")).toBe(true);
  });

  it("ask mode: edit_file needs approval", () => {
    expect(makeAgent("ask")._needsApproval("edit_file")).toBe(true);
  });

  it("ask mode: write_text_file needs approval", () => {
    expect(makeAgent("ask")._needsApproval("write_text_file")).toBe(true);
  });

  it("ask mode: read_file does not need approval", () => {
    expect(makeAgent("ask")._needsApproval("read_file")).toBe(false);
  });

  it("ask mode: echo does not need approval", () => {
    expect(makeAgent("ask")._needsApproval("echo")).toBe(false);
  });

  // -- auto-edit mode --

  it("auto-edit mode: bash needs approval", () => {
    expect(makeAgent("auto-edit")._needsApproval("bash")).toBe(true);
  });

  it("auto-edit mode: edit_file does not need approval", () => {
    expect(makeAgent("auto-edit")._needsApproval("edit_file")).toBe(false);
  });

  it("auto-edit mode: write_text_file does not need approval", () => {
    expect(makeAgent("auto-edit")._needsApproval("write_text_file")).toBe(
      false,
    );
  });

  // -- yolo mode --

  it("yolo mode: nothing needs approval", () => {
    const agent = makeAgent("yolo");
    expect(agent._needsApproval("bash")).toBe(false);
    expect(agent._needsApproval("edit_file")).toBe(false);
    expect(agent._needsApproval("write_text_file")).toBe(false);
    expect(agent._needsApproval("read_file")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end trust tests
// ---------------------------------------------------------------------------

describe("TestTrustEndToEnd", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "permissions-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const bashAction = () => ({
    type: "tool_call",
    tool_name: "bash",
    arguments: { command: "echo hi" },
  });

  const editAction = () => ({
    type: "tool_call",
    tool_name: "edit_file",
    arguments: {
      path: "/tmp/test_permissions_dummy.txt",
      old_text: "a",
      new_text: "b",
    },
  });

  const echoAction = () => ({
    type: "tool_call",
    tool_name: "echo",
    arguments: { text: "hello" },
  });

  const finalAction = () => ({
    type: "final_response",
    content: "done",
  });

  it("ask denied blocks tool", async () => {
    const llm = new ScriptedLLM([bashAction(), finalAction()]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      trust_level: "ask",
      max_steps: 4,
    });
    agent.tools.registerTool("bash", (args) => args.command);

    const deny = vi.fn().mockReturnValue(false);
    const result = await agent.run("test", undefined, { onApprove: deny });

    expect(deny).toHaveBeenCalledOnce();
    const hasBlocked = result.turns.some(
      (t) => (t.tool_result as Record<string, unknown> | null)?.error === "User denied tool execution",
    );
    expect(hasBlocked).toBe(true);
  });

  it("yolo skips approval", async () => {
    const llm = new ScriptedLLM([echoAction(), finalAction()]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      trust_level: "yolo",
      max_steps: 4,
    });
    agent.tools.registerTool("echo", (args) => args.text);

    const spy = vi.fn().mockReturnValue(true);
    const result = await agent.run("test", undefined, { onApprove: spy });

    expect(spy).not.toHaveBeenCalled();
    expect(result.stop_reason).toBe("final_response");
  });

  it("auto-edit allows edit_file without approval", async () => {
    const llm = new ScriptedLLM([editAction(), finalAction()]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      trust_level: "auto-edit",
      max_steps: 4,
    });
    agent.tools.registerTool("edit_file", () => "ok");

    const spy = vi.fn().mockReturnValue(true);
    await agent.run("test", undefined, { onApprove: spy });

    expect(spy).not.toHaveBeenCalled();
  });

  it("auto-edit still asks for bash", async () => {
    const llm = new ScriptedLLM([bashAction(), finalAction()]);
    const agent = new HarnessAgent(llm, {
      log_dir: tmpDir,
      trust_level: "auto-edit",
      max_steps: 4,
    });
    agent.tools.registerTool("bash", (args) => args.command);

    const spy = vi.fn().mockReturnValue(true);
    await agent.run("test", undefined, { onApprove: spy });

    expect(spy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// No approve callback blocks sensitive tools
// ---------------------------------------------------------------------------

describe("TestNoApproveCallbackBlocks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-approve-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("no approve callback blocks sensitive tool", async () => {
    const agent = new HarnessAgent(
      new ScriptedLLM([
        {
          type: "tool_call",
          tool_name: "bash",
          arguments: { command: "echo hi" },
        },
        { type: "final_response", content: "done" },
      ]),
      {
        log_dir: tmpDir,
        trust_level: "ask",
        project_root: tmpDir,
      },
    );
    const result = await agent.run("test");

    expect(result.turns[0].tool_result!.ok).toBe(false);
    expect(result.turns[0].tool_result!.error).toContain("requires approval");
  });
});
