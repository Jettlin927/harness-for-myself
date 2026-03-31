/**
 * Tests for SubAgentSpawner, trust resolution, tool whitelist, and use_skill.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HarnessAgent, type RunConfig } from "../src/agent.js";
import type { AgentDefinition, SkillDefinition } from "../src/definitions.js";
import { ScriptedLLM } from "../src/llm.js";
import {
  SubAgentSpawner,
  createUseSkillCallable,
  resolveTrust,
  type AgentFactory,
} from "../src/subagent.js";

/** Helper to build a full RunConfig with defaults. */
function makeConfig(overrides: Partial<RunConfig>): RunConfig {
  return {
    max_steps: 20,
    log_dir: "logs",
    max_history_turns: 20,
    schema_retry_limit: 1,
    max_budget: null,
    max_failures: 3,
    tool_retry_limit: 0,
    snapshot_dir: null,
    dangerous_tools: [],
    goal_reached_token: null,
    allowed_write_roots: [],
    project_root: "",
    allow_bash: true,
    max_tokens_budget: null,
    trust_level: "ask",
    permission_rules: [],
    mode: "execute",
    agent_depth: 0,
    ...overrides,
  };
}

/** Factory that creates HarnessAgent instances. */
const harnessFactory: AgentFactory = (llm, config) =>
  new HarnessAgent(llm, config);

describe("TestTrustResolution", () => {
  it("trust level only decreases", () => {
    // Parent=ask, child wants yolo -> stays ask
    expect(resolveTrust("ask", "yolo")).toBe("ask");
    // Parent=ask, child wants auto-edit -> stays ask
    expect(resolveTrust("ask", "auto-edit")).toBe("ask");
  });

  it("trust level inherits when lower", () => {
    // Parent=yolo, child wants auto-edit -> auto-edit (lower)
    expect(resolveTrust("yolo", "auto-edit")).toBe("auto-edit");
    // Parent=yolo, child wants ask -> ask (lower)
    expect(resolveTrust("yolo", "ask")).toBe("ask");
    // Parent=auto-edit, child wants ask -> ask (lower)
    expect(resolveTrust("auto-edit", "ask")).toBe("ask");
  });

  it("trust level null inherits parent", () => {
    expect(resolveTrust("yolo", null)).toBe("yolo");
    expect(resolveTrust("ask", null)).toBe("ask");
  });

  it("trust level same", () => {
    expect(resolveTrust("ask", "ask")).toBe("ask");
    expect(resolveTrust("yolo", "yolo")).toBe("yolo");
  });
});

describe("TestSpawnChildCompletes", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("spawn child completes", async () => {
    const childLlm = new ScriptedLLM([
      {
        type: "tool_call",
        tool_name: "echo",
        arguments: { text: "hello" },
      },
      { type: "final_response", content: "Child done." },
    ]);

    const parentConfig = makeConfig({
      max_steps: 5,
      trust_level: "yolo",
      agent_depth: 0,
      log_dir: tmpDir,
    });

    const agentDef: AgentDefinition = {
      name: "helper",
      description: "A helper agent",
      max_steps: null,
      trust_level: null,
      tools: null,
      system_instructions: "",
    };

    const spawner = new SubAgentSpawner(
      parentConfig,
      childLlm,
      [agentDef],
      undefined,
      harnessFactory,
    );

    const result = await spawner.call({
      goal: "Do something",
      agent: "helper",
    });
    expect(result.final_response).toBe("Child done.");
    expect(result.stop_reason).toBe("final_response");
    expect(result.turns).toBeGreaterThanOrEqual(1);
  });

  it("spawn without agent name", async () => {
    const childLlm = new ScriptedLLM([
      { type: "final_response", content: "Done without agent." },
    ]);

    const parentConfig = makeConfig({
      max_steps: 5,
      trust_level: "yolo",
      agent_depth: 0,
      log_dir: tmpDir,
    });

    const spawner = new SubAgentSpawner(
      parentConfig,
      childLlm,
      [],
      undefined,
      harnessFactory,
    );

    const result = await spawner.call({ goal: "Quick task" });
    expect(result.final_response).toBe("Done without agent.");
  });
});

describe("TestUnknownAgentRaises", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("unknown agent raises", async () => {
    const parentConfig = makeConfig({
      max_steps: 5,
      trust_level: "yolo",
      agent_depth: 0,
      log_dir: tmpDir,
    });

    const childLlm = new ScriptedLLM([]);
    const spawner = new SubAgentSpawner(
      parentConfig,
      childLlm,
      [],
      undefined,
      harnessFactory,
    );

    await expect(
      spawner.call({ goal: "Do something", agent: "nonexistent" }),
    ).rejects.toThrow("Unknown agent");
  });

  it("empty goal raises", async () => {
    const parentConfig = makeConfig({
      max_steps: 5,
      trust_level: "yolo",
      agent_depth: 0,
      log_dir: tmpDir,
    });

    const childLlm = new ScriptedLLM([]);
    const spawner = new SubAgentSpawner(
      parentConfig,
      childLlm,
      [],
      undefined,
      harnessFactory,
    );

    await expect(spawner.call({ goal: "" })).rejects.toThrow(
      "non-empty 'goal'",
    );
  });
});

describe("TestToolWhitelist", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("tool whitelist", async () => {
    const childLlm = new ScriptedLLM([
      {
        type: "tool_call",
        tool_name: "echo",
        arguments: { text: "hi" },
      },
      { type: "final_response", content: "Done." },
    ]);

    const parentConfig = makeConfig({
      max_steps: 5,
      trust_level: "yolo",
      agent_depth: 0,
      log_dir: tmpDir,
    });

    const agentDef: AgentDefinition = {
      name: "restricted",
      description: "Only echo allowed",
      max_steps: null,
      trust_level: null,
      tools: ["echo"],
      system_instructions: "",
    };

    const spawner = new SubAgentSpawner(
      parentConfig,
      childLlm,
      [agentDef],
      undefined,
      harnessFactory,
    );

    const result = await spawner.call({
      goal: "Echo only",
      agent: "restricted",
    });
    expect(result.final_response).toBe("Done.");
  });
});

describe("TestDepthLimit", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("depth limit prevents spawn_agent registration", () => {
    const llm = new ScriptedLLM([
      { type: "final_response", content: "Done." },
    ]);
    const agent = new HarnessAgent(llm, {
      max_steps: 5,
      trust_level: "yolo",
      agent_depth: 3,
      project_root: "/tmp/fake_hau_project",
      log_dir: tmpDir,
    });
    const toolNames = agent.tools.getToolSchemas().map((s) => s.name);
    expect(toolNames).not.toContain("spawn_agent");
  });

  it("depth below limit registers spawn_agent", () => {
    const llm = new ScriptedLLM([
      { type: "final_response", content: "Done." },
    ]);
    const agent = new HarnessAgent(llm, {
      max_steps: 5,
      trust_level: "yolo",
      agent_depth: 2,
      project_root: "/tmp/fake_hau_project",
      log_dir: tmpDir,
    });
    const toolNames = agent.tools.getToolSchemas().map((s) => s.name);
    expect(toolNames).toContain("spawn_agent");
  });
});

describe("TestUseSkill", () => {
  it("use skill returns instructions", () => {
    const skill: SkillDefinition = {
      name: "review",
      description: "Code review skill",
      body: "Review the code carefully.",
    };
    const fn = createUseSkillCallable([skill]);
    const result = fn({ name: "review" });
    expect(result.skill).toBe("review");
    expect(result.instructions).toBe("Review the code carefully.");
  });

  it("use skill unknown throws", () => {
    const fn = createUseSkillCallable([]);
    expect(() => fn({ name: "nonexistent" })).toThrow("Unknown skill");
  });

  it("use skill empty name throws", () => {
    const fn = createUseSkillCallable([]);
    expect(() => fn({ name: "" })).toThrow("non-empty 'name'");
  });
});
