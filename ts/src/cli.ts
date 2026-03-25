#!/usr/bin/env node
/**
 * CLI entry point for HAU (Harness for Yourself).
 * Uses commander.js for subcommand parsing.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { pathToFileURL } from "node:url";

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
  baseUrl?: string;
}): BaseLLM {
  const provider = opts.provider;
  const apiKey = opts.apiKey;
  const model = opts.model;
  const baseUrl = opts.baseUrl;

  if (provider === "anthropic") {
    // Dynamic import to avoid requiring the SDK when not in use
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AnthropicLLM } = require("./anthropic-llm.js");
    return new AnthropicLLM({
      model: model || "claude-sonnet-4-20250514",
      apiKey,
      baseUrl,
    });
  }

  const llmName = opts.llm ?? "rule";
  if (llmName === "deepseek" || provider === "deepseek") {
    return new DeepSeekLLM({
      apiKey,
      ...(model ? { model } : {}),
      ...(baseUrl ? { baseUrl } : {}),
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

  // No provider specified and using default rule backend → try saved config or launch wizard
  if (!provider && llmName === "rule") {
    const saved = loadSavedConfig();
    if (saved) {
      console.log(`\x1b[2m\u5DF2\u52A0\u8F7D\u914D\u7F6E: ${saved.provider} / ${saved.model ?? "default"}  (harness setup \u53EF\u91CD\u65B0\u914D\u7F6E)\x1b[0m`);
      opts.provider = saved.provider;
      opts.apiKey = saved.apiKey;
      if (saved.model) opts.model = saved.model;
      if (saved.baseUrl) opts.baseUrl = saved.baseUrl;
    } else {
      const setup = await interactiveSetup(null);
      if (!setup) return 1;
      opts.provider = setup.provider;
      opts.apiKey = setup.apiKey;
      if (setup.model) opts.model = setup.model;
      if (setup.baseUrl) opts.baseUrl = setup.baseUrl;
    }
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

// ---------------------------------------------------------------------------
// Saved config persistence (~/.hau/config.json)
// ---------------------------------------------------------------------------

interface SavedConfig {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const HAU_CONFIG_DIR = path.join(
  process.env.HOME ?? process.env.USERPROFILE ?? ".",
  ".hau",
);
const HAU_CONFIG_PATH = path.join(HAU_CONFIG_DIR, "config.json");

export function loadSavedConfig(): SavedConfig | null {
  try {
    const content = fs.readFileSync(HAU_CONFIG_PATH, "utf-8");
    const data = JSON.parse(content);
    if (data.provider && data.apiKey) return data as SavedConfig;
    return null;
  } catch {
    return null;
  }
}

export function saveSavedConfig(config: SavedConfig): void {
  fs.mkdirSync(HAU_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(HAU_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  // Restrict permissions: owner read/write only
  fs.chmodSync(HAU_CONFIG_PATH, 0o600);
}

function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 4) + "...";
  return key.slice(0, 8) + "..." + key.slice(-4);
}

// ---------------------------------------------------------------------------
// Interactive setup wizard
// ---------------------------------------------------------------------------

interface SetupResult {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

const PROVIDER_CHOICES = [
  { key: "1", name: "anthropic", label: "Anthropic (Claude)", defaultBaseUrl: "https://api.anthropic.com", models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-4-20250514"] },
  { key: "2", name: "deepseek", label: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com", models: ["deepseek-chat", "deepseek-reasoner"] },
] as const;

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function interactiveSetup(saved: SavedConfig | null): Promise<SetupResult | null> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const isReconfigure = saved !== null;
    const title = isReconfigure ? "HAU \u2014 \u91CD\u65B0\u914D\u7F6E" : "HAU \u2014 \u9996\u6B21\u8FDE\u63A5\u8BBE\u7F6E";

    console.log("\n\x1b[36m" + "\u2500".repeat(60) + "\x1b[0m");
    console.log(`\x1b[36m\x1b[1m  ${title}\x1b[0m`);
    console.log("\x1b[36m" + "\u2500".repeat(60) + "\x1b[0m\n");

    // Step 1: Choose provider
    console.log("  \x1b[1m\u9009\u62E9 LLM \u63D0\u4F9B\u5546\uFF1A\x1b[0m\n");
    for (const p of PROVIDER_CHOICES) {
      const current = saved?.provider === p.name ? " \x1b[2m(\u5F53\u524D)\x1b[0m" : "";
      console.log(`    ${p.key}) ${p.label}${current}`);
    }
    console.log();

    let provider: typeof PROVIDER_CHOICES[number] | undefined;
    const defaultProviderHint = saved ? `, \u56DE\u8F66\u4FDD\u6301 ${saved.provider}` : "";
    while (!provider) {
      const choice = await ask(rl, `  \x1b[32m\u25B8\x1b[0m \u8BF7\u9009\u62E9 (1/2${defaultProviderHint}): `);
      if (!choice && saved) {
        provider = PROVIDER_CHOICES.find((p) => p.name === saved.provider);
      } else {
        provider = PROVIDER_CHOICES.find((p) => p.key === choice || p.name === choice.toLowerCase());
      }
      if (!provider) {
        console.log("  \x1b[31m\u8BF7\u8F93\u5165 1 \u6216 2\x1b[0m");
      }
    }
    console.log(`\n  \x1b[32m\u2713\x1b[0m \u5DF2\u9009\u62E9: ${provider.label}\n`);

    // Step 2: API Key
    const envKey = provider.name === "anthropic"
      ? process.env.ANTHROPIC_API_KEY
      : process.env.DEEPSEEK_API_KEY;
    const existingKey = envKey ?? (saved?.provider === provider.name ? saved?.apiKey : undefined);

    let apiKey: string;
    if (existingKey) {
      const source = envKey ? "\u73AF\u5883\u53D8\u91CF" : "\u5DF2\u4FDD\u5B58\u914D\u7F6E";
      console.log(`  \x1b[2m\u68C0\u6D4B\u5230${source}\u4E2D\u7684 API Key: ${maskKey(existingKey)}\x1b[0m`);
      const useExisting = await ask(rl, "  \x1b[32m\u25B8\x1b[0m \u4F7F\u7528\u8BE5 Key\uFF1F(Y/n): ");
      if (useExisting.toLowerCase() === "n") {
        apiKey = await ask(rl, "  \x1b[32m\u25B8\x1b[0m \u8BF7\u8F93\u5165\u65B0\u7684 API Key: ");
      } else {
        apiKey = existingKey;
      }
    } else {
      apiKey = await ask(rl, "  \x1b[32m\u25B8\x1b[0m \u8BF7\u8F93\u5165 API Key: ");
    }

    if (!apiKey) {
      console.log("\n  \x1b[31m\u2717 \u672A\u63D0\u4F9B API Key\uFF0C\u65E0\u6CD5\u7EE7\u7EED\x1b[0m\n");
      return null;
    }
    console.log(`  \x1b[32m\u2713\x1b[0m API Key \u5DF2\u8BBE\u7F6E\n`);

    // Step 3: Base URL
    const existingBaseUrl = saved?.provider === provider.name ? saved?.baseUrl : undefined;
    const baseUrlDefault = existingBaseUrl ?? provider.defaultBaseUrl;
    console.log(`  \x1b[2mAPI Base URL \u9ED8\u8BA4: ${baseUrlDefault}\x1b[0m`);
    const baseUrlInput = await ask(rl, "  \x1b[32m\u25B8\x1b[0m Base URL (\u56DE\u8F66\u4F7F\u7528\u9ED8\u8BA4): ");
    const baseUrl = baseUrlInput || (existingBaseUrl ?? undefined);
    if (baseUrl) {
      console.log(`  \x1b[32m\u2713\x1b[0m Base URL: ${baseUrl}\n`);
    } else {
      console.log(`  \x1b[32m\u2713\x1b[0m Base URL: ${provider.defaultBaseUrl} (\u9ED8\u8BA4)\n`);
    }

    // Step 4: Choose model
    const existingModel = saved?.provider === provider.name ? saved?.model : undefined;
    console.log("  \x1b[1m\u9009\u62E9\u6A21\u578B\uFF1A\x1b[0m\n");
    for (let i = 0; i < provider.models.length; i++) {
      const isCurrent = existingModel === provider.models[i];
      const isDefault = i === 0 && !existingModel;
      const suffix = isCurrent ? " \x1b[2m(\u5F53\u524D)\x1b[0m" : isDefault ? " \x1b[2m(\u9ED8\u8BA4)\x1b[0m" : "";
      console.log(`    ${i + 1}) ${provider.models[i]}${suffix}`);
    }
    console.log();

    const modelChoice = await ask(rl, `  \x1b[32m\u25B8\x1b[0m \u8BF7\u9009\u62E9 (1-${provider.models.length}\uFF0C\u56DE\u8F66\u9ED8\u8BA4): `);
    let model: string | undefined;
    if (modelChoice) {
      const idx = parseInt(modelChoice, 10) - 1;
      if (idx >= 0 && idx < provider.models.length) {
        model = provider.models[idx];
      }
    }
    model = model ?? existingModel ?? provider.models[0];
    console.log(`\n  \x1b[32m\u2713\x1b[0m \u6A21\u578B: ${model}`);

    // Save config
    const config: SavedConfig = { provider: provider.name, apiKey, model, baseUrl };
    saveSavedConfig(config);
    console.log(`\n  \x1b[32m\u2713\x1b[0m \u914D\u7F6E\u5DF2\u4FDD\u5B58\u5230 ${HAU_CONFIG_PATH}`);

    console.log("\n\x1b[36m" + "\u2500".repeat(60) + "\x1b[0m");
    console.log(`  \x1b[2m\u63D0\u793A\uFF1A\u8FD0\u884C harness chat \u5C06\u81EA\u52A8\u52A0\u8F7D\u5DF2\u4FDD\u5B58\u7684\u914D\u7F6E\x1b[0m`);
    console.log(`  \x1b[2m      \u8FD0\u884C harness setup \u53EF\u91CD\u65B0\u914D\u7F6E\x1b[0m`);
    console.log("\x1b[36m" + "\u2500".repeat(60) + "\x1b[0m");

    return { provider: provider.name, apiKey, model, baseUrl };
  } finally {
    rl.close();
  }
}

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
      .option("--base-url <url>", "Custom API base URL")
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

  // --- setup ---
  program
    .command("setup")
    .description("Configure LLM provider, API key, model, and base URL.")
    .action(async () => {
      const saved = loadSavedConfig();
      const setup = await interactiveSetup(saved);
      process.exit(setup ? 0 : 1);
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
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
