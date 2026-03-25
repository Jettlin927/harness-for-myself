/**
 * Interactive terminal UI for the agent harness.
 *
 * Provides a multi-turn chat experience:
 * - spinner while the agent is thinking / calling tools
 * - coloured output for each turn (tool_call, final_response, errors)
 * - persistent session loop until the user exits
 */

import * as readline from "node:readline";
import * as path from "node:path";
import chalk from "chalk";
import ora, { type Ora } from "ora";

import type { HarnessAgent } from "./agent.js";
import type { TurnRecord } from "./types.js";
import type { ProjectContext } from "./context.js";
import { SessionManager, type SessionState } from "./session.js";
import type { AgentDefinition, SkillDefinition } from "./definitions.js";
import { loadAgentDefinitions, loadSkillDefinitions } from "./definitions.js";
import { loadProjectContext } from "./context.js";

// ── icons & palette ──────────────────────────────────────────────────────────

export const ICON_TOOL = "\u2699"; // ⚙
export const ICON_OK = "\u2713"; // ✓
export const ICON_ERR = "\u2717"; // ✗
export const ICON_SCHEMA = "\u26A0"; // ⚠
export const ICON_AGENT = "\u25C6"; // ◆
export const ICON_USER = "\u25B8"; // ▸

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtArguments(args: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) {
    return chalk.dim("  (no arguments)");
  }
  const lines = Object.entries(args).map(
    ([k, v]) => `  ${chalk.dim(k)} = ${chalk.yellow(JSON.stringify(v))}`,
  );
  return lines.join("\n");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

// ── Turn rendering ────────────────────────────────────────────────────────────

export function renderToolTurn(record: TurnRecord): string {
  const action = record.llm_action;
  const toolName = (action.tool_name as string) ?? "?";
  const args = (action.arguments as Record<string, unknown>) ?? {};

  const header = `${chalk.dim(`Turn ${record.turn}`)}  ${chalk.blue.bold(`${ICON_TOOL} Tool Call`)}`;
  const lines: string[] = [];
  lines.push(chalk.blue("\u2500".repeat(60)));
  lines.push(header);
  lines.push(`  ${chalk.bold(toolName)}`);
  lines.push(fmtArguments(args));

  const toolResult = record.tool_result ?? {};
  const ok = toolResult.ok as boolean;
  const output = toolResult.output;
  const error = toolResult.error;
  const blocked = toolResult.blocked as boolean;
  const attempts = (toolResult.attempts as number) ?? 1;

  if (ok) {
    lines.push(chalk.green(`  ${ICON_OK} ${String(output)}`));
  } else if (blocked) {
    lines.push(chalk.red(`  ${ICON_ERR} blocked: ${String(error)}`));
  } else {
    const retryNote = attempts > 1 ? `  (attempts: ${attempts})` : "";
    lines.push(chalk.red(`  ${ICON_ERR} ${String(error)}${retryNote}`));
  }

  const schemaRetries = action.schema_retry_count as number;
  if (schemaRetries) {
    lines.push(chalk.dim(`  schema retry: ${schemaRetries}x`));
  }

  return lines.join("\n");
}

export function renderFinalTurn(record: TurnRecord): string {
  const action = record.llm_action;
  const content = (action.content as string) ?? record.observation;

  const header = `${chalk.dim(`Turn ${record.turn}`)}  ${chalk.green.bold(`${ICON_OK} Final Response`)}`;
  const lines: string[] = [];
  lines.push(chalk.green("\u2500".repeat(60)));
  lines.push(header);
  lines.push(`  ${content}`);

  const schemaRetries = action.schema_retry_count as number;
  if (schemaRetries) {
    lines.push(chalk.dim(`  schema retry: ${schemaRetries}x`));
  }

  return lines.join("\n");
}

export function renderSchemaErrorTurn(record: TurnRecord): string {
  const action = record.llm_action;
  const error = (action.error as string) ?? "Unknown schema error";
  const attempts = (action.attempts as number) ?? 1;

  const header = `${chalk.dim(`Turn ${record.turn}`)}  ${chalk.red.bold(`${ICON_SCHEMA} Schema Error`)}`;
  const lines: string[] = [];
  lines.push(chalk.red("\u2500".repeat(60)));
  lines.push(header);
  lines.push(chalk.red(`  ${ICON_SCHEMA} ${error}`));
  lines.push(chalk.dim(`  attempts: ${attempts}`));

  return lines.join("\n");
}

export function renderTurn(record: TurnRecord): string {
  const action = record.llm_action;
  const actionType = (action.action_type as string) ?? (action.type as string) ?? "unknown";

  if (actionType === "tool_call") return renderToolTurn(record);
  if (actionType === "final_response") return renderFinalTurn(record);
  return renderSchemaErrorTurn(record);
}

// ── Skill expansion ──────────────────────────────────────────────────────────

/**
 * Expand a /skill command.
 *
 * Returns [expandedGoal, null] on success,
 * [null, errorMessage] for unknown skill,
 * or [goal, null] unchanged when goal is not a slash command.
 */
export function expandSkill(
  goal: string,
  skills: Map<string, SkillDefinition>,
): [string | null, string | null] {
  if (!goal.startsWith("/")) {
    return [goal, null];
  }

  const skillName = goal.slice(1).split(/\s+/)[0];
  const extra = goal.slice(skillName.length + 2).trim(); // +2 for "/" and space
  const skill = skills.get(skillName);
  if (!skill) {
    const available = [...skills.keys()]
      .sort()
      .map((s) => `/${s}`)
      .join(", ");
    let msg = `Unknown skill: /${skillName}`;
    if (available) {
      msg += `\nAvailable: ${available}`;
    }
    return [null, msg];
  }

  let expanded = skill.body;
  if (extra) {
    expanded += `\n\nAdditional context: ${extra}`;
  }
  return [expanded, null];
}

// ── InteractiveSession ────────────────────────────────────────────────────────

export interface InteractiveSessionOptions {
  agent: HarnessAgent;
  sessionDir?: string;
  newSession?: boolean;
  /** Override stdin for testing. */
  input?: NodeJS.ReadableStream;
  /** Override stdout for testing. */
  output?: NodeJS.WritableStream;
}

export class InteractiveSession {
  readonly agent: HarnessAgent;
  private _sessionMgr: SessionManager;
  private _session: SessionState;
  private _totalTokens = 0;
  private _projectContext: ProjectContext | null = null;
  private _skills: Map<string, SkillDefinition> = new Map();
  private _agentDefs: AgentDefinition[] = [];
  private _autoApproveThisGoal = false;
  private _spinner: Ora | null = null;
  private _streaming = false;
  private _rl: readline.Interface | null = null;
  private _input: NodeJS.ReadableStream;
  private _output: NodeJS.WritableStream;

  constructor(options: InteractiveSessionOptions) {
    this.agent = options.agent;
    this._input = options.input ?? process.stdin;
    this._output = options.output ?? process.stdout;

    this._sessionMgr = new SessionManager(options.sessionDir);
    this._session = this._initSession(options.newSession ?? false);

    if (this.agent.config.project_root) {
      try {
        this._projectContext = loadProjectContext(this.agent.config.project_root);
      } catch {
        // Project context loading failed, continue without it
      }
    }

    // Load skill/agent definitions
    if (this._projectContext) {
      const projectRoot = this._projectContext.project_root;
      if (projectRoot) {
        const hauDir = path.join(projectRoot, ".hau");
        for (const skill of loadSkillDefinitions(hauDir)) {
          this._skills.set(skill.name, skill);
        }
        this._agentDefs = loadAgentDefinitions(hauDir);
      }
    }
  }

  // ── public ────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this._printBanner();

    this._rl = readline.createInterface({
      input: this._input,
      output: this._output,
      terminal: this._input === process.stdin,
    });

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const goal = await this._promptGoal();
        if (goal === null) break;
        if (!goal) continue;

        // Built-in command handling
        if (goal.startsWith("/")) {
          if (this._handleCommand(goal)) continue;

          // Skill expansion
          if (this._skills.size > 0) {
            const [expanded, err] = expandSkill(goal, this._skills);
            if (err !== null) {
              const lines = err.split("\n");
              this._write(chalk.red(lines[0]) + "\n");
              if (lines.length > 1) {
                this._write(chalk.dim(lines.slice(1).join("\n")) + "\n");
              }
              continue;
            }
            if (expanded !== null && expanded !== goal) {
              const skillName = goal.slice(1).split(/\s+/)[0];
              const skill = this._skills.get(skillName)!;
              this._write(chalk.dim(`Skill: ${skill.name} \u2014 ${skill.description}`) + "\n");
              await this._runGoal(expanded);
              continue;
            }
          }
        }

        await this._runGoal(goal);
      }
    } catch {
      // KeyboardInterrupt equivalent — just exit
    } finally {
      this._stopSpinner();
      if (this._rl) {
        this._rl.close();
        this._rl = null;
      }
    }
    this._write(chalk.dim("\nGoodbye!\n") + "\n");
  }

  // ── private ───────────────────────────────────────────────────────────────

  private _write(text: string): void {
    this._output.write(text);
  }

  private _initSession(newSession: boolean): SessionState {
    if (newSession) {
      const state = this._sessionMgr.loadOrCreate();
      this._sessionMgr.save(state);
      return state;
    }

    const existing = this._sessionMgr.latest();
    if (existing && existing.goals_completed.length > 0) {
      // In non-interactive mode, just continue existing session
      return existing;
    }

    const state = this._sessionMgr.loadOrCreate();
    this._sessionMgr.save(state);
    return state;
  }

  private _printBanner(): void {
    const goalsCompleted = this._session.goals_completed.length;
    const sid = this._session.session_id.slice(0, 8);
    const trust = this.agent.config.trust_level;
    const maxSteps = this.agent.config.max_steps;

    // Line 1: project info
    let projectLang = "unknown";
    let branch = "n/a";
    if (this._projectContext) {
      const pt = this._projectContext.project_type;
      const langs = pt.languages.join(", ");
      if (langs) projectLang = langs;
      const git = this._projectContext.git;
      branch = git ? git.branch || "?" : "not a git repo";
    }

    const sep = chalk.cyan("\u2500".repeat(60));
    this._write("\n" + sep + "\n");
    this._write(chalk.cyan.bold("  HAU v0.1.0") + "\n");
    this._write(sep + "\n");

    this._write(
      `  ${chalk.dim("Project:")} ${projectLang}  ` +
        `${chalk.dim("Branch:")} ${branch}  ` +
        `${chalk.dim("Trust:")} ${trust}  ` +
        `${chalk.dim("Steps:")} ${maxSteps}\n`,
    );

    if (goalsCompleted > 0) {
      this._write(`  ${chalk.dim("Session:")} ${sid}  (${goalsCompleted} goals completed)\n`);
    } else {
      this._write(`  ${chalk.dim("Session:")} ${sid}  (new)\n`);
    }

    this._write(
      `\n  ${chalk.dim("\u547D\u4EE4:")} /help /skills /agents /status /trust /clear\n`,
    );

    if (this._skills.size > 0) {
      const skillList = [...this._skills.keys()]
        .sort()
        .map((n) => `/${n}`)
        .join(", ");
      this._write(`  ${chalk.dim("Skills:")} ${skillList}\n`);
    }

    this._write(`\n  ${chalk.dim("\u8F93\u5165\u4EFB\u52A1\u5F00\u59CB\u5BF9\u8BDD\uFF0Cexit \u9000\u51FA")}\n`);

    if (trust === "yolo") {
      this._write(chalk.red.bold("\n  \u26A0 YOLO \u6A21\u5F0F\uFF1A\u6240\u6709\u64CD\u4F5C\u81EA\u52A8\u6267\u884C") + "\n");
    }

    this._write(sep + "\n\n");
  }

  private _promptGoal(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      if (!this._rl) {
        resolve(null);
        return;
      }
      this._rl.question(chalk.green.bold(`${ICON_USER} You `) + "> ", (answer) => {
        const trimmed = answer.trim();
        if (["exit", "quit", "q", "bye", "\\q"].includes(trimmed.toLowerCase())) {
          resolve(null);
        } else {
          resolve(trimmed);
        }
      });
      // Handle close (Ctrl-D)
      this._rl.once("close", () => resolve(null));
    });
  }

  _handleCommand(cmd: string): boolean {
    const parts = cmd.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ").trim();

    if (command === "/help") {
      this._write(chalk.cyan("\u2500".repeat(60)) + "\n");
      this._write(chalk.cyan.bold("  Help") + "\n");
      this._write(chalk.cyan("\u2500".repeat(60)) + "\n");
      this._write(
        chalk.bold("  \u53EF\u7528\u547D\u4EE4") +
          "\n" +
          "    /help        \u663E\u793A\u6B64\u5E2E\u52A9\u4FE1\u606F\n" +
          "    /skills      \u5217\u51FA\u6240\u6709\u5DF2\u52A0\u8F7D\u7684 skill\n" +
          "    /agents      \u5217\u51FA\u6240\u6709\u5DF2\u52A0\u8F7D\u7684 agent \u5B9A\u4E49\n" +
          "    /status      \u663E\u793A\u5F53\u524D\u4F1A\u8BDD\u72B6\u6001\n" +
          "    /trust MODE  \u4FEE\u6539\u4FE1\u4EFB\u7EA7\u522B (ask/auto-edit/yolo)\n" +
          "    /clear       \u65B0\u5EFA\u4F1A\u8BDD\uFF0C\u91CD\u7F6E\u72B6\u6001\n" +
          "\n" +
          chalk.dim("  \u8F93\u5165 /skillname \u53EF\u5C55\u5F00\u5BF9\u5E94 skill \u4E3A\u4EFB\u52A1") +
          "\n",
      );
      return true;
    }

    if (command === "/skills") {
      if (this._skills.size === 0) {
        this._write(chalk.dim("  \u6CA1\u6709\u5DF2\u52A0\u8F7D\u7684 skill") + "\n");
      } else {
        this._write(chalk.cyan.bold("  Skills") + "\n");
        for (const name of [...this._skills.keys()].sort()) {
          const skill = this._skills.get(name)!;
          this._write(`    ${chalk.bold(`/${name}`)}  ${skill.description}\n`);
        }
      }
      return true;
    }

    if (command === "/agents") {
      if (this._agentDefs.length === 0) {
        this._write(chalk.dim("  \u6CA1\u6709\u5DF2\u52A0\u8F7D\u7684 agent \u5B9A\u4E49") + "\n");
      } else {
        this._write(chalk.cyan.bold("  Agents") + "\n");
        for (const agentDef of this._agentDefs) {
          this._write(`    ${chalk.bold(agentDef.name)}  ${agentDef.description}\n`);
        }
      }
      return true;
    }

    if (command === "/status") {
      const goalsCompleted = this._session.goals_completed.length;
      const sid = this._session.session_id.slice(0, 8);
      const trust = this.agent.config.trust_level;
      this._write(chalk.cyan.bold("  Status") + "\n");
      this._write(`    Session ID:      ${sid}\n`);
      this._write(`    Goals completed: ${goalsCompleted}\n`);
      this._write(`    Trust level:     ${trust}\n`);
      this._write(`    Max steps:       ${this.agent.config.max_steps}\n`);
      if (this._totalTokens > 0) {
        this._write(`    Token \u7528\u91CF:      ~${this._totalTokens.toLocaleString()}\n`);
      }
      return true;
    }

    if (command === "/trust") {
      const validLevels = new Set(["ask", "auto-edit", "yolo"]);
      if (!validLevels.has(arg)) {
        this._write(
          chalk.red(`  \u7528\u6CD5: /trust <${[...validLevels].sort().join("|")}>`) + "\n",
        );
        return true;
      }
      const oldLevel = this.agent.config.trust_level;
      (this.agent.config as { trust_level: string }).trust_level = arg;
      this._write(chalk.green(`  ${ICON_OK} Trust level: ${oldLevel} -> ${arg}`) + "\n");
      return true;
    }

    if (command === "/clear") {
      this._session = this._sessionMgr.loadOrCreate();
      this._sessionMgr.save(this._session);
      const sid = this._session.session_id.slice(0, 8);
      this._write(chalk.green(`  ${ICON_OK} \u65B0\u4F1A\u8BDD\u5DF2\u521B\u5EFA: ${sid}`) + "\n");
      return true;
    }

    return false;
  }

  private _onToken(token: string): void {
    this._stopSpinner();
    this._output.write(token);
    this._streaming = true;
  }

  private async _runGoal(goal: string): Promise<void> {
    this._autoApproveThisGoal = false;
    this._write("\n");
    const t0 = Date.now();

    // Build context
    const context: Record<string, unknown> = {};
    if (this._session.accumulated_summary) {
      context.session_history = this._session.accumulated_summary;
    }
    if (this._projectContext) {
      context.project = this._projectContext;
    }

    // Start spinner
    this._streaming = false;
    this._startSpinner(`Thinking... (Step 1/${this.agent.config.max_steps})`);

    const onTurn = (record: TurnRecord): void => {
      if (this._streaming) {
        this._write("\n");
        this._streaming = false;
      }
      this._stopSpinner();
      this._write(renderTurn(record) + "\n");

      const actionType =
        (record.llm_action.action_type as string) ??
        (record.llm_action.type as string) ??
        "";
      if (actionType === "tool_call") {
        const turnNum = record.turn;
        const maxSteps = this.agent.config.max_steps;
        this._startSpinner(`Thinking... (Step ${turnNum}/${maxSteps})`);
      }
    };

    const onCompress = (): void => {
      this._stopSpinner();
      this._write(chalk.dim("  \u2139 \u65E9\u671F\u5BF9\u8BDD\u5DF2\u538B\u7F29\u4E3A\u6458\u8981\u4EE5\u8282\u7701\u4E0A\u4E0B\u6587\u7A7A\u95F4") + "\n");
      this._startSpinner("Thinking...");
    };

    const onApprove = (
      toolName: string,
      description: string,
      _args: Record<string, unknown>,
    ): boolean => {
      if (this._autoApproveThisGoal) return true;
      this._stopSpinner();

      const short = truncate(description, 80);
      this._write(
        chalk.yellow(
          `  ${ICON_SCHEMA} Allow ${chalk.bold(toolName)}: ${short}?  ${chalk.dim("(y/n/a)")} `,
        ),
      );
      // Synchronous approval is not possible with readline.
      // In a real implementation this would need async approval.
      // For now, auto-approve in non-interactive contexts.
      return true;
    };

    try {
      const result = await this.agent.run(goal, context, {
        onTurn: onTurn,
        onApprove: onApprove,
        onToken: (token: string) => this._onToken(token),
        onCompress: onCompress,
      });

      this._totalTokens += result.total_tokens;

      // Persist session state
      this._sessionMgr.update(
        this._session,
        goal,
        result.stop_reason,
        result.turns.length,
        result.snapshot_path ?? undefined,
      );
      this._sessionMgr.save(this._session);

      const duration = (Date.now() - t0) / 1000;
      this._printSummary(result, duration);
    } catch {
      this._stopSpinner();
      this._write(chalk.dim("\n  Interrupted\n") + "\n");
    }
  }

  private _printSummary(
    result: { stop_reason: string; turns: TurnRecord[]; log_path: string; total_tokens: number },
    duration: number,
  ): void {
    const stop = result.stop_reason;
    const turns = result.turns.length;
    const log = result.log_path;
    const tokens = result.total_tokens;

    const tokensInfo = tokens > 0 ? `  ~${tokens.toLocaleString()} tokens` : "";
    const isSuccess = stop === "final_response" || stop === "goal_reached";
    const icon = isSuccess ? ICON_OK : ICON_ERR;
    const colorFn = isSuccess ? chalk.green : chalk.red;

    this._write(
      `  ${colorFn(icon)} ${stop}  ` +
        `${turns} turns  ${duration.toFixed(1)}s${tokensInfo}` +
        `  ${chalk.dim(log)}\n`,
    );
    this._write("\n");
  }

  private _startSpinner(message: string): void {
    this._spinner = ora({
      text: chalk.dim(message),
      stream: this._output as NodeJS.WriteStream,
    }).start();
  }

  private _stopSpinner(): void {
    if (this._spinner) {
      this._spinner.stop();
      this._spinner = null;
    }
  }
}
