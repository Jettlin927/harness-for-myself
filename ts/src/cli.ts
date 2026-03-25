#!/usr/bin/env node
/**
 * CLI entry point for HAU (Harness for Yourself).
 * Uses commander.js for subcommand parsing.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";

import { HarnessAgent, type RunConfig } from "./agent.js";
import type { BaseLLM } from "./llm.js";
import { RuleBasedLLM, DeepSeekLLM } from "./llm.js";
import { StrategyConfig } from "./config.js";
import { SessionManager } from "./session.js";
import { loadProjectContext } from "./context.js";
import type { RunResult } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function parseContext(raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    throw new Error(`--context must be valid JSON: ${(err as Error).message}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("--context must be a JSON object ({})");
  }
  return value as Record<string, unknown>;
}

function loadStrategyConfig(configPath: string | undefined): StrategyConfig | null {
  if (!configPath) return null;
  return StrategyConfig.load(configPath);
}

export function buildLlm(opts: {
  llm?: string;
  provider?: string;
  apiKey?: string;
  model?: string;
}): BaseLLM {
  const provider = opts.provider;
  const apiKey = opts.apiKey;
  const model = opts.model;

  if (provider === "anthropic") {
    // Dynamic import to avoid requiring the SDK when not in use
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AnthropicLLM } = require("./anthropic-llm.js");
    return new AnthropicLLM({
      model: model || "claude-sonnet-4-20250514",
      apiKey,
    });
  }

  const llmName = opts.llm ?? "rule";
  if (llmName === "deepseek" || provider === "deepseek") {
    return new DeepSeekLLM({
      apiKey,
      ...(model ? { model } : {}),
    });
  }
  if (llmName === "rule") {
    return new RuleBasedLLM();
  }
  throw new Error(`Unknown LLM backend: '${llmName}'. Choose 'rule' or 'deepseek'.`);
}

export function buildRunConfig(opts: {
  llm?: string;
  provider?: string;
  apiKey?: string;
  model?: string;
  trust?: string;
  maxSteps?: number;
  snapshotDir?: string;
  logDir?: string;
  config?: string;
  projectRoot?: string;
  allowBash?: boolean;
  goalReachedToken?: string;
}): Partial<RunConfig> {
  const strategy = loadStrategyConfig(opts.config);

  if (strategy) {
    const base = strategy.toRunConfig();
    return {
      max_steps: opts.maxSteps ?? base.max_steps,
      snapshot_dir: opts.snapshotDir ?? null,
      log_dir: opts.logDir ?? "logs",
      goal_reached_token: opts.goalReachedToken ?? base.goal_reached_token,
      project_root: opts.projectRoot ?? "",
      allow_bash: opts.allowBash ?? true,
      trust_level: (opts.trust as "ask" | "auto-edit" | "yolo") ?? "ask",
      max_budget: base.max_budget,
      max_failures: base.max_failures,
      max_history_turns: base.max_history_turns,
    };
  }

  return {
    max_steps: opts.maxSteps ?? 8,
    snapshot_dir: opts.snapshotDir ?? null,
    log_dir: opts.logDir ?? "logs",
    goal_reached_token: opts.goalReachedToken ?? null,
    project_root: opts.projectRoot ?? "",
    allow_bash: opts.allowBash ?? true,
    trust_level: (opts.trust as "ask" | "auto-edit" | "yolo") ?? "ask",
  };
}

export function buildAgent(opts: {
  llm?: string;
  provider?: string;
  apiKey?: string;
  model?: string;
  trust?: string;
  maxSteps?: number;
  snapshotDir?: string;
  logDir?: string;
  config?: string;
  projectRoot?: string;
  allowBash?: boolean;
  goalReachedToken?: string;
}): HarnessAgent {
  const llm = buildLlm(opts);
  const config = buildRunConfig(opts);
  return new HarnessAgent(llm, config);
}

export function printResult(result: RunResult): void {
  console.log(`final_response: ${result.final_response}`);
  console.log(`stop_reason:    ${result.stop_reason}`);
  console.log(`turns:          ${result.turns.length}`);
  console.log(`log_path:       ${result.log_path}`);
  if (result.snapshot_path) {
    console.log(`snapshot_path:  ${result.snapshot_path}`);
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function cmdRun(goal: string, opts: Record<string, unknown>): Promise<number> {
  const agent = buildAgent(opts as any);
  const context = parseContext((opts.context as string) ?? "{}");
  if (agent.config.project_root) {
    context.project = loadProjectContext(agent.config.project_root);
  }
  const result = await agent.run(goal, context);
  printResult(result);
  return 0;
}

async function cmdResume(snapshot: string, opts: Record<string, unknown>): Promise<number> {
  const agent = buildAgent(opts as any);
  const result = await agent.resume(snapshot);
  printResult(result);
  return 0;
}

async function cmdChat(opts: Record<string, unknown>): Promise<number> {
  const { InteractiveSession } = await import("./tui.js");

  const provider = opts.provider as string | undefined;
  const llmName = (opts.llm as string) ?? "rule";
  if (!provider && llmName === "rule") {
    console.log("\x1b[2m\u63D0\u793A\uFF1A\u4F7F\u7528 --provider anthropic \u8FDE\u63A5 Claude API\x1b[0m");
  }

  let agent: HarnessAgent;
  try {
    agent = buildAgent(opts as any);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`\x1b[31m${ICON_ERR} ${msg}\x1b[0m`);
    if (msg.includes("API key") || msg.toLowerCase().includes("api_key")) {
      console.error("\x1b[2m  \u8BBE\u7F6E\u65B9\u6CD5\uFF1Aexport ANTHROPIC_API_KEY=sk-ant-...\x1b[0m");
      console.error(
        "\x1b[2m  \u6216\u521B\u5EFA\u9879\u76EE\u6839\u76EE\u5F55 .env \u6587\u4EF6\uFF1AANTHROPIC_API_KEY=sk-ant-...\x1b[0m",
      );
    }
    return 1;
  }

  const session = new InteractiveSession({
    agent,
    newSession: opts.newSession as boolean | undefined,
  });
  await session.start();
  return 0;
}

const ICON_ERR = "\u2717";

function cmdSession(opts: Record<string, unknown>): number {
  const mgr = new SessionManager();

  if (opts.reset) {
    const state = mgr.latest();
    if (state) {
      mgr.delete(state.session_id);
      console.log(`Deleted session ${state.session_id.slice(0, 8)}...`);
    } else {
      console.log("No active sessions.");
    }
    return 0;
  }

  const sessions = mgr.listSessions();
  if (sessions.length === 0) {
    console.log("No saved sessions.");
    return 0;
  }

  for (const s of sessions) {
    const goalsCompleted = s.goals_completed.length;
    console.log(
      `[${s.session_id.slice(0, 8)}...]  created: ${s.created_at.slice(0, 19)}  goals: ${goalsCompleted}`,
    );
    const recentGoals = s.goals_completed.slice(-3);
    recentGoals.forEach((g, i) => {
      const goalShort = g.goal.slice(0, 60);
      console.log(`  ${i + 1}. ${goalShort}  stop=${g.stop_reason}  turns=${g.turns}`);
    });
    if (opts.verbose && s.accumulated_summary) {
      console.log(`  summary:\n    ${s.accumulated_summary.replace(/\n/g, "\n    ")}`);
    }
    console.log();
  }

  return 0;
}

async function cmdEval(opts: Record<string, unknown>): Promise<number> {
  // Eval module loaded dynamically
  let EvalRunner: any;
  let EvalCase: any;
  let BUILTIN_CASES: any;
  try {
    // Use indirect dynamic import to avoid TypeScript static resolution
    const modulePath = "./eval.js";
    const evalMod = await (Function("p", "return import(p)")(modulePath) as Promise<any>);
    EvalRunner = evalMod.EvalRunner;
    EvalCase = evalMod.EvalCase;
    BUILTIN_CASES = evalMod.BUILTIN_CASES;
  } catch {
    console.error("Eval module not available.");
    return 1;
  }

  // Load cases
  let rawList: any[];
  if (opts.cases) {
    const content = fs.readFileSync(opts.cases as string, "utf-8");
    rawList = JSON.parse(content);
  } else {
    rawList = BUILTIN_CASES;
  }

  const cases = rawList.map(
    (item: any) =>
      new EvalCase({
        id: item.id,
        goal: item.goal,
        context: item.context ?? {},
        expected_stop_reason: item.expected_stop_reason,
        expected_keywords: item.expected_keywords ?? [],
      }),
  );

  const agent = buildAgent(opts as any);
  const strategy = loadStrategyConfig(opts.config as string | undefined);
  const configVersion = strategy ? strategy.version : "unversioned";

  const runner = new EvalRunner(agent);
  const report = await runner.run(cases, { configVersion });

  const reportDict = report.toDict();
  const outputJson = JSON.stringify(reportDict, null, 2);

  if (opts.output) {
    fs.writeFileSync(opts.output as string, outputJson, "utf-8");
    console.log(`Report saved to: ${opts.output}`);
  } else {
    console.log(outputJson);
  }

  console.error(
    `\nResult: ${report.passed}/${report.total} passed  ` +
      `pass_rate=${(report.pass_rate * 100).toFixed(0)}%  ` +
      `avg_turns=${report.avg_turns.toFixed(1)}  ` +
      `avg_duration=${report.avg_duration_s.toFixed(3)}s  ` +
      `config=${report.config_version}`,
  );

  return report.failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI program
// ---------------------------------------------------------------------------

export function buildProgram(): Command {
  const program = new Command();
  program.name("harness").description("HAU \u2014 Harness for Yourself.").version("0.1.0", "-V, --version");

  // Shared options helper — adds common flags to a command
  function addSharedOptions(cmd: Command): Command {
    return cmd
      .option("--llm <backend>", "LLM backend (rule|deepseek)", "rule")
      .option("--api-key <key>", "API key")
      .option("--provider <provider>", "LLM provider (deepseek|anthropic)")
      .option("--model <model>", "Override default model")
      .option("--trust <level>", "Trust level (ask|auto-edit|yolo)", "ask")
      .option("--max-steps <n>", "Maximum steps", parseInt, 8)
      .option("--snapshot-dir <dir>", "Snapshot directory")
      .option("--log-dir <dir>", "Log directory", "logs")
      .option("--config <file>", "StrategyConfig JSON file");
  }

  // --- run ---
  const runCmd = program
    .command("run <goal>")
    .description("Run the agent on a goal.");
  addSharedOptions(runCmd);
  runCmd
    .option("--project-root <dir>", "Project directory", process.cwd())
    .option("--no-bash", "Disable the bash tool")
    .option("--context <json>", "Extra context as JSON", "{}")
    .option("--goal-reached-token <token>", "Stop early token")
    .action(async (goal: string, opts: Record<string, unknown>) => {
      // Map commander's --no-bash to allowBash
      const o = { ...opts, allowBash: opts.bash !== false, projectRoot: opts.projectRoot };
      const code = await cmdRun(goal, o);
      process.exit(code);
    });

  // --- resume ---
  const resumeCmd = program
    .command("resume <snapshot>")
    .description("Resume a run from a saved snapshot.");
  addSharedOptions(resumeCmd);
  resumeCmd
    .option("--goal-reached-token <token>", "Stop early token")
    .action(async (snapshot: string, opts: Record<string, unknown>) => {
      const code = await cmdResume(snapshot, opts);
      process.exit(code);
    });

  // --- chat ---
  const chatCmd = program
    .command("chat")
    .description("Start an interactive multi-turn chat session.");
  addSharedOptions(chatCmd);
  chatCmd
    .option("--project-root <dir>", "Project directory", process.cwd())
    .option("--no-bash", "Disable the bash tool")
    .option("--new-session", "Start a fresh session")
    .action(async (opts: Record<string, unknown>) => {
      const o = {
        ...opts,
        allowBash: opts.bash !== false,
        projectRoot: opts.projectRoot,
        newSession: opts.newSession ?? false,
      };
      const code = await cmdChat(o);
      process.exit(code);
    });

  // --- session ---
  program
    .command("session")
    .description("List or manage saved sessions.")
    .option("--reset", "Delete the most recent session")
    .option("-v, --verbose", "Show accumulated summary")
    .action((opts: Record<string, unknown>) => {
      const code = cmdSession(opts);
      process.exit(code);
    });

  // --- eval ---
  const evalCmd = program
    .command("eval")
    .description("Run batch regression evaluation.");
  addSharedOptions(evalCmd);
  evalCmd
    .option("--cases <file>", "JSON eval cases file")
    .option("--output <file>", "Output report file")
    .action(async (opts: Record<string, unknown>) => {
      const code = await cmdEval(opts);
      process.exit(code);
    });

  return program;
}

export async function main(argv?: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv ?? process.argv);
}

// Run if invoked directly
const isMainModule =
  typeof import.meta.url !== "undefined" &&
  import.meta.url.startsWith("file:") &&
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url === `file://${path.resolve(process.argv[1])}`);

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
