import { describe, expect, it } from "vitest";
import { HookManager } from "../src/hooks.js";
import type { HookDefinition } from "../src/types.js";

describe("HookManager", () => {
  it("getHooks filters by event", () => {
    const hooks: HookDefinition[] = [
      { event: "PreToolUse", command: "echo pre" },
      { event: "PostToolUse", command: "echo post" },
    ];
    const mgr = new HookManager(hooks);
    expect(mgr.getHooks("PreToolUse")).toHaveLength(1);
    expect(mgr.getHooks("PostToolUse")).toHaveLength(1);
    expect(mgr.getHooks("SessionStart")).toHaveLength(0);
  });

  it("getHooks filters by matcher", () => {
    const hooks: HookDefinition[] = [
      { event: "PostToolUse", matcher: "edit_file|write_file", command: "echo lint" },
      { event: "PostToolUse", command: "echo always" },
    ];
    const mgr = new HookManager(hooks);
    // edit_file matches both (matcher + no-matcher)
    expect(mgr.getHooks("PostToolUse", "edit_file")).toHaveLength(2);
    // bash matches only the no-matcher hook
    expect(mgr.getHooks("PostToolUse", "bash")).toHaveLength(1);
  });

  it("getHooks with no matcher matches all tools", () => {
    const hooks: HookDefinition[] = [
      { event: "PreToolUse", command: "echo all" },
    ];
    const mgr = new HookManager(hooks);
    expect(mgr.getHooks("PreToolUse", "anything")).toHaveLength(1);
  });

  it("runHooks executes commands", () => {
    const hooks: HookDefinition[] = [
      { event: "PostToolUse", command: "echo hello" },
    ];
    const mgr = new HookManager(hooks);
    const results = mgr.runHooks("PostToolUse");
    expect(results).toHaveLength(1);
    expect(results[0].stdout).toBe("hello");
    expect(results[0].exitCode).toBe(0);
    expect(results[0].timedOut).toBe(false);
  });

  it("runHooks passes environment variables", () => {
    const hooks: HookDefinition[] = [
      { event: "PostToolUse", command: "echo $HAU_TOOL_NAME" },
    ];
    const mgr = new HookManager(hooks);
    const results = mgr.runHooks("PostToolUse", undefined, {
      HAU_TOOL_NAME: "edit_file",
    });
    expect(results[0].stdout).toBe("edit_file");
  });

  it("runHooks handles failing commands", () => {
    const hooks: HookDefinition[] = [
      { event: "PostToolUse", command: "exit 42" },
    ];
    const mgr = new HookManager(hooks);
    const results = mgr.runHooks("PostToolUse");
    expect(results[0].exitCode).toBe(42);
  });

  it("runHooks handles timeout", () => {
    const hooks: HookDefinition[] = [
      { event: "PostToolUse", command: "sleep 60", timeout: 1 },
    ];
    const mgr = new HookManager(hooks);
    const results = mgr.runHooks("PostToolUse");
    expect(results[0].timedOut).toBe(true);
    expect(results[0].exitCode).toBe(-1);
  });

  it("runHooks returns empty for no matching hooks", () => {
    const mgr = new HookManager([]);
    expect(mgr.runHooks("SessionStart")).toEqual([]);
  });

  it("hookCount returns total", () => {
    const hooks: HookDefinition[] = [
      { event: "PreToolUse", command: "a" },
      { event: "PostToolUse", command: "b" },
    ];
    expect(new HookManager(hooks).hookCount).toBe(2);
    expect(new HookManager().hookCount).toBe(0);
  });

  it("multiple hooks execute in order", () => {
    const hooks: HookDefinition[] = [
      { event: "PostToolUse", command: "echo first" },
      { event: "PostToolUse", command: "echo second" },
    ];
    const mgr = new HookManager(hooks);
    const results = mgr.runHooks("PostToolUse");
    expect(results.map((r) => r.stdout)).toEqual(["first", "second"]);
  });
});
