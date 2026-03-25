import { describe, it, expect, vi, beforeEach } from "vitest";

import { buildProgram, parseContext, buildLlm, buildRunConfig, printResult } from "../src/cli.js";
import {
  renderTurn,
  renderToolTurn,
  renderFinalTurn,
  renderSchemaErrorTurn,
  expandSkill,
  InteractiveSession,
  ICON_OK,
  ICON_ERR,
  ICON_TOOL,
  ICON_SCHEMA,
  ICON_USER,
} from "../src/tui.js";
import { RuleBasedLLM } from "../src/llm.js";
import { HarnessAgent } from "../src/agent.js";
import type { TurnRecord, RunResult } from "../src/types.js";
import type { SkillDefinition } from "../src/definitions.js";

// ── CLI Parser Tests ────────────────────────────────────────────────────────

describe("CLI buildProgram", () => {
  it("creates program with correct name", () => {
    const program = buildProgram();
    expect(program.name()).toBe("harness");
  });

  it("has all subcommands", () => {
    const program = buildProgram();
    const cmds = program.commands.map((c) => c.name());
    expect(cmds).toContain("run");
    expect(cmds).toContain("resume");
    expect(cmds).toContain("chat");
    expect(cmds).toContain("session");
    expect(cmds).toContain("eval");
  });

  it("has version flag", () => {
    const program = buildProgram();
    expect(program.version()).toBe("0.1.0");
  });
});

// ── parseContext ────────────────────────────────────────────────────────────

describe("parseContext", () => {
  it("parses valid JSON object", () => {
    const result = parseContext('{"key": "value"}');
    expect(result).toEqual({ key: "value" });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseContext("not json")).toThrow("--context must be valid JSON");
  });

  it("throws on JSON array", () => {
    expect(() => parseContext("[1, 2]")).toThrow("--context must be a JSON object");
  });

  it("throws on JSON string", () => {
    expect(() => parseContext('"hello"')).toThrow("--context must be a JSON object");
  });

  it("parses empty object", () => {
    expect(parseContext("{}")).toEqual({});
  });

  it("parses nested object", () => {
    const result = parseContext('{"a": {"b": 1}}');
    expect(result).toEqual({ a: { b: 1 } });
  });
});

// ── buildLlm ────────────────────────────────────────────────────────────────

describe("buildLlm", () => {
  it("returns RuleBasedLLM by default", () => {
    const llm = buildLlm({});
    expect(llm).toBeInstanceOf(RuleBasedLLM);
  });

  it("returns RuleBasedLLM for llm=rule", () => {
    const llm = buildLlm({ llm: "rule" });
    expect(llm).toBeInstanceOf(RuleBasedLLM);
  });

  it("throws for unknown LLM backend", () => {
    expect(() => buildLlm({ llm: "unknown" })).toThrow("Unknown LLM backend");
  });
});

// ── buildRunConfig ──────────────────────────────────────────────────────────

describe("buildRunConfig", () => {
  it("returns default config", () => {
    const config = buildRunConfig({});
    expect(config.max_steps).toBe(8);
    expect(config.trust_level).toBe("ask");
    expect(config.log_dir).toBe("logs");
  });

  it("respects maxSteps", () => {
    const config = buildRunConfig({ maxSteps: 20 });
    expect(config.max_steps).toBe(20);
  });

  it("respects trust level", () => {
    const config = buildRunConfig({ trust: "yolo" });
    expect(config.trust_level).toBe("yolo");
  });

  it("respects projectRoot", () => {
    const config = buildRunConfig({ projectRoot: "/tmp/project" });
    expect(config.project_root).toBe("/tmp/project");
  });

  it("respects allowBash", () => {
    const config = buildRunConfig({ allowBash: false });
    expect(config.allow_bash).toBe(false);
  });

  it("respects goalReachedToken", () => {
    const config = buildRunConfig({ goalReachedToken: "DONE" });
    expect(config.goal_reached_token).toBe("DONE");
  });
});

// ── printResult ─────────────────────────────────────────────────────────────

describe("printResult", () => {
  it("prints result fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result: RunResult = {
      final_response: "Done!",
      turns: [],
      stop_reason: "final_response",
      log_path: "/tmp/log.jsonl",
      snapshot_path: null,
      total_tokens: 0,
    };
    printResult(result);
    expect(spy).toHaveBeenCalledWith("final_response: Done!");
    expect(spy).toHaveBeenCalledWith("stop_reason:    final_response");
    expect(spy).toHaveBeenCalledWith("turns:          0");
    expect(spy).toHaveBeenCalledWith("log_path:       /tmp/log.jsonl");
    spy.mockRestore();
  });

  it("prints snapshot_path when present", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result: RunResult = {
      final_response: "Done!",
      turns: [],
      stop_reason: "final_response",
      log_path: "/tmp/log.jsonl",
      snapshot_path: "/tmp/snap.json",
      total_tokens: 0,
    };
    printResult(result);
    expect(spy).toHaveBeenCalledWith("snapshot_path:  /tmp/snap.json");
    spy.mockRestore();
  });
});

// ── TUI Render Tests ────────────────────────────────────────────────────────

describe("renderTurn", () => {
  it("renders tool_call turn", () => {
    const record: TurnRecord = {
      turn: 1,
      goal: "test",
      working_memory: {},
      llm_raw_output: null,
      llm_action: {
        action_type: "tool_call",
        tool_name: "bash",
        arguments: { command: "echo hi" },
      },
      tool_result: { ok: true, output: "hi", error: null, blocked: false, attempts: 1 },
      observation: "",
    };
    const output = renderTurn(record);
    expect(output).toContain("Turn 1");
    expect(output).toContain("Tool Call");
    expect(output).toContain("bash");
    expect(output).toContain("hi");
  });

  it("renders final_response turn", () => {
    const record: TurnRecord = {
      turn: 2,
      goal: "test",
      working_memory: {},
      llm_raw_output: null,
      llm_action: {
        action_type: "final_response",
        content: "All done!",
      },
      tool_result: null,
      observation: "All done!",
    };
    const output = renderTurn(record);
    expect(output).toContain("Turn 2");
    expect(output).toContain("Final Response");
    expect(output).toContain("All done!");
  });

  it("renders schema_error turn", () => {
    const record: TurnRecord = {
      turn: 3,
      goal: "test",
      working_memory: {},
      llm_raw_output: null,
      llm_action: {
        type: "schema_error",
        error: "Missing required field",
        attempts: 2,
      },
      tool_result: null,
      observation: "",
    };
    const output = renderTurn(record);
    expect(output).toContain("Turn 3");
    expect(output).toContain("Schema Error");
    expect(output).toContain("Missing required field");
    expect(output).toContain("attempts: 2");
  });

  it("renders failed tool with retry note", () => {
    const record: TurnRecord = {
      turn: 1,
      goal: "test",
      working_memory: {},
      llm_raw_output: null,
      llm_action: {
        action_type: "tool_call",
        tool_name: "read_file",
        arguments: { path: "/nonexistent" },
      },
      tool_result: { ok: false, output: null, error: "File not found", blocked: false, attempts: 3 },
      observation: "",
    };
    const output = renderToolTurn(record);
    expect(output).toContain("read_file");
    expect(output).toContain("File not found");
    expect(output).toContain("attempts: 3");
  });

  it("renders blocked tool", () => {
    const record: TurnRecord = {
      turn: 1,
      goal: "test",
      working_memory: {},
      llm_raw_output: null,
      llm_action: {
        action_type: "tool_call",
        tool_name: "bash",
        arguments: { command: "rm -rf /" },
      },
      tool_result: { ok: false, output: null, error: "Blocked", blocked: true, attempts: 1 },
      observation: "",
    };
    const output = renderToolTurn(record);
    expect(output).toContain("blocked");
    expect(output).toContain("Blocked");
  });

  it("shows schema retry count on tool turn", () => {
    const record: TurnRecord = {
      turn: 1,
      goal: "test",
      working_memory: {},
      llm_raw_output: null,
      llm_action: {
        action_type: "tool_call",
        tool_name: "bash",
        arguments: {},
        schema_retry_count: 2,
      },
      tool_result: { ok: true, output: "ok", error: null, blocked: false, attempts: 1 },
      observation: "",
    };
    const output = renderToolTurn(record);
    expect(output).toContain("schema retry: 2x");
  });
});

// ── Skill expansion ─────────────────────────────────────────────────────────

describe("expandSkill", () => {
  const skills = new Map<string, SkillDefinition>([
    ["review", { name: "review", description: "Code review", body: "Review the code carefully." }],
    ["test", { name: "test", description: "Run tests", body: "Run all tests and report results." }],
  ]);

  it("returns goal unchanged when not a slash command", () => {
    const [expanded, err] = expandSkill("hello world", skills);
    expect(expanded).toBe("hello world");
    expect(err).toBeNull();
  });

  it("expands known skill", () => {
    const [expanded, err] = expandSkill("/review", skills);
    expect(expanded).toBe("Review the code carefully.");
    expect(err).toBeNull();
  });

  it("expands known skill with extra args", () => {
    const [expanded, err] = expandSkill("/review focus on security", skills);
    expect(expanded).toContain("Review the code carefully.");
    expect(expanded).toContain("Additional context: focus on security");
    expect(err).toBeNull();
  });

  it("returns error for unknown skill", () => {
    const [expanded, err] = expandSkill("/unknown", skills);
    expect(expanded).toBeNull();
    expect(err).toContain("Unknown skill: /unknown");
    expect(err).toContain("Available:");
    expect(err).toContain("/review");
  });

  it("returns error with empty skill list", () => {
    const empty = new Map<string, SkillDefinition>();
    const [expanded, err] = expandSkill("/anything", empty);
    expect(expanded).toBeNull();
    expect(err).toContain("Unknown skill: /anything");
  });
});

// ── InteractiveSession command handling ──────────────────────────────────────

describe("InteractiveSession._handleCommand", () => {
  function makeSession(): InteractiveSession {
    const llm = new RuleBasedLLM();
    const agent = new HarnessAgent(llm, { max_steps: 5, trust_level: "ask" as const });

    // Use a writable stream that captures output
    const chunks: string[] = [];
    const output = {
      write(data: string) {
        chunks.push(data);
        return true;
      },
    } as NodeJS.WritableStream;

    const session = new InteractiveSession({
      agent,
      output,
    });
    return session;
  }

  it("handles /help command", () => {
    const session = makeSession();
    expect(session._handleCommand("/help")).toBe(true);
  });

  it("handles /skills command", () => {
    const session = makeSession();
    expect(session._handleCommand("/skills")).toBe(true);
  });

  it("handles /agents command", () => {
    const session = makeSession();
    expect(session._handleCommand("/agents")).toBe(true);
  });

  it("handles /status command", () => {
    const session = makeSession();
    expect(session._handleCommand("/status")).toBe(true);
  });

  it("handles /trust with valid level", () => {
    const session = makeSession();
    expect(session._handleCommand("/trust yolo")).toBe(true);
  });

  it("handles /trust with invalid level", () => {
    const session = makeSession();
    expect(session._handleCommand("/trust invalid")).toBe(true);
  });

  it("handles /clear command", () => {
    const session = makeSession();
    expect(session._handleCommand("/clear")).toBe(true);
  });

  it("returns false for unknown command", () => {
    const session = makeSession();
    expect(session._handleCommand("/nonexistent")).toBe(false);
  });
});

// ── Icon constants ──────────────────────────────────────────────────────────

describe("TUI icons", () => {
  it("defines all icon constants", () => {
    expect(ICON_OK).toBeTruthy();
    expect(ICON_ERR).toBeTruthy();
    expect(ICON_TOOL).toBeTruthy();
    expect(ICON_SCHEMA).toBeTruthy();
    expect(ICON_USER).toBeTruthy();
  });
});
