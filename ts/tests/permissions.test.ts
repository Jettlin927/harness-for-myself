import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessAgent } from "../src/agent.js";
import type { PermissionRule } from "../src/types.js";
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

// ---------------------------------------------------------------------------
// Fine-grained permission rules tests
// ---------------------------------------------------------------------------

describe("PermissionRules", () => {
  function makeAgentWithRules(
    trust: string,
    rules: PermissionRule[],
  ): HarnessAgent {
    return new HarnessAgent(new ScriptedLLM([]), {
      trust_level: trust as "ask" | "auto-edit" | "yolo",
      permission_rules: rules,
    });
  }

  it("rule allows bash with npm prefix", () => {
    const agent = makeAgentWithRules("ask", [
      { tool: "bash", pattern: "npm ", decision: "allow" },
    ]);
    expect(agent._checkPermission("bash", { command: "npm test" })).toBe("allow");
    expect(agent._checkPermission("bash", { command: "npm run build" })).toBe("allow");
  });

  it("rule denies bash with rm prefix", () => {
    const agent = makeAgentWithRules("ask", [
      { tool: "bash", pattern: "rm ", decision: "deny" },
    ]);
    expect(agent._checkPermission("bash", { command: "rm -rf /" })).toBe("deny");
  });

  it("wildcard tool matches all tools", () => {
    const agent = makeAgentWithRules("ask", [
      { tool: "*", decision: "allow" },
    ]);
    expect(agent._checkPermission("bash", { command: "anything" })).toBe("allow");
    expect(agent._checkPermission("edit_file", { path: "/tmp/x" })).toBe("allow");
  });

  it("first matching rule wins", () => {
    const agent = makeAgentWithRules("ask", [
      { tool: "bash", pattern: "npm test", decision: "allow" },
      { tool: "bash", pattern: "npm", decision: "deny" },
      { tool: "bash", decision: "ask" },
    ]);
    expect(agent._checkPermission("bash", { command: "npm test" })).toBe("allow");
    expect(agent._checkPermission("bash", { command: "npm install" })).toBe("deny");
    expect(agent._checkPermission("bash", { command: "ls" })).toBe("ask");
  });

  it("no matching rule falls back to trust_level", () => {
    const agent = makeAgentWithRules("yolo", [
      { tool: "bash", pattern: "rm", decision: "deny" },
    ]);
    // "echo" doesn't match rule → fallback to yolo → allow
    expect(agent._checkPermission("bash", { command: "echo hi" })).toBe("allow");
    // "rm" matches rule → deny
    expect(agent._checkPermission("bash", { command: "rm -rf" })).toBe("deny");
  });

  it("pattern matches file path for edit_file", () => {
    const agent = makeAgentWithRules("ask", [
      { tool: "edit_file", pattern: "/tmp/", decision: "allow" },
      { tool: "edit_file", decision: "ask" },
    ]);
    expect(agent._checkPermission("edit_file", { path: "/tmp/foo.ts" })).toBe("allow");
    expect(agent._checkPermission("edit_file", { path: "/etc/passwd" })).toBe("ask");
  });

  it("empty rules array uses trust_level fallback", () => {
    const agent = makeAgentWithRules("ask", []);
    expect(agent._checkPermission("bash", { command: "echo" })).toBe("ask");
    expect(agent._checkPermission("read_file", { path: "/tmp/x" })).toBe("allow");
  });

  it("_needsApproval backward compat delegates to _checkPermission", () => {
    const agent = makeAgentWithRules("ask", [
      { tool: "bash", decision: "allow" },
    ]);
    // bash would normally need approval in ask mode, but rule says allow
    expect(agent._needsApproval("bash")).toBe(false);
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
