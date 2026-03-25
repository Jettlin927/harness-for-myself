/**
 * HarnessAgent — single-agent execution harness.
 * Orchestrates the memory → LLM → tool/final → observe → next turn loop
 * with strict schema validation, reliability guardrails, and trajectory logging.
 */

import type {
  LLMAction,
  RunResult,
  ToolExecutionResult,
  TrustLevel,
  TurnRecord,
} from "./types.js";
import { toolError } from "./types.js";
import { SchemaError } from "./types.js";
import { parseLLMAction } from "./schema.js";
import { ToolDispatcher, registerCodingTools } from "./tools.js";
import { MemoryManager, type WorkingMemory } from "./memory.js";
import { ErrorPolicy } from "./error-policy.js";
import { SnapshotStore } from "./snapshot.js";
import { StopController, type StopState } from "./stop-controller.js";
import { TrajectoryLogger } from "./logger.js";
import type { BaseLLM } from "./llm.js";
import { SubAgentSpawner } from "./subagent.js";

/** Cast WorkingMemory to Record<string, unknown> for use with LLM/TurnRecord. */
function wmToRecord(wm: WorkingMemory): Record<string, unknown> {
  return wm as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// RunConfig
// ---------------------------------------------------------------------------

export interface RunConfig {
  max_steps: number;
  log_dir: string;
  max_history_turns: number;
  schema_retry_limit: number;
  max_budget: number | null;
  max_failures: number | null;
  tool_retry_limit: number;
  snapshot_dir: string | null;
  dangerous_tools: string[];
  goal_reached_token: string | null;
  allowed_write_roots: string[];
  project_root: string;
  allow_bash: boolean;
  max_tokens_budget: number | null;
  trust_level: TrustLevel;
  agent_depth: number;
}

const DEFAULT_CONFIG: RunConfig = {
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
  agent_depth: 0,
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ActionResult {
  ok: boolean;
  action: LLMAction | null;
  llm_raw_output: unknown;
  schema_errors: string[];
  error: string | null;
}

interface RunOptions {
  resumeFrom?: string;
  onTurn?: (record: TurnRecord) => void;
  onApprove?: (toolName: string, description: string, args: Record<string, unknown>) => boolean;
  onToken?: (token: string) => void;
  onCompress?: () => void;
}

// ---------------------------------------------------------------------------
// HarnessAgent
// ---------------------------------------------------------------------------

export class HarnessAgent {
  readonly config: RunConfig;
  readonly tools: ToolDispatcher;
  readonly memory: MemoryManager;
  readonly errorPolicy: ErrorPolicy;
  readonly snapshotStore: SnapshotStore;
  readonly stopController: StopController;

  private static readonly _APPROVAL_REQUIRED_TOOLS = new Set([
    "bash",
    "edit_file",
    "write_text_file",
    "write_file",
    "save_memory",
    "spawn_agent",
  ]);

  constructor(
    public readonly llm: BaseLLM,
    config?: Partial<RunConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tools = new ToolDispatcher({
      allowedWriteRoots: this.config.allowed_write_roots,
    });

    if (this.config.project_root) {
      registerCodingTools(this.tools, {
        allowBash: this.config.allow_bash,
        projectRoot: this.config.project_root,
      });
    }

    // Sub-agent integration: register spawn_agent when depth < 3
    if (this.config.agent_depth < 3) {
      const spawner = new SubAgentSpawner(this.config, this.llm, []);
      this.tools.registerTool(
        "spawn_agent",
        (args: Record<string, unknown>) => {
          // Note: this returns a Promise; async tool execution handled by caller
          return spawner.call(args);
        },
        {
          type: "object",
          description: "Spawn a child agent to accomplish a sub-goal",
          properties: {
            goal: {
              type: "string",
              description: "The goal for the child agent",
            },
            agent: {
              type: "string",
              description: "Optional agent definition name",
            },
            max_steps: {
              type: "integer",
              description: "Optional max steps override",
            },
          },
          required: ["goal"],
        },
      );
    }

    if (this.llm.setToolSchemas) {
      this.llm.setToolSchemas(this.tools.getToolSchemas());
    }

    this.memory = new MemoryManager(this.config.max_history_turns);
    this.errorPolicy = new ErrorPolicy(this.config.tool_retry_limit);
    this.snapshotStore = new SnapshotStore(
      this.config.snapshot_dir ?? this.config.log_dir,
    );
    this.stopController = new StopController(
      this.config.max_budget,
      this.config.max_failures,
      this.config.goal_reached_token,
    );
  }

  async run(
    goal: string,
    context?: Record<string, unknown> | null,
    options?: RunOptions,
  ): Promise<RunResult> {
    this.llm.onToken = options?.onToken;

    const state = this._loadState(goal, context ?? {}, options?.resumeFrom);
    const effectiveGoal = state.goal;
    const effectiveContext = state.context;
    const turns = state.turns;
    this.memory.summary = state.summary;
    const logger = new TrajectoryLogger(this.config.log_dir);
    let stopReason = "max_steps_reached";
    let snapshotPath: string | null = state.snapshotPath;
    const dangerousSigs: string[] = state.dangerousToolSignatures;
    const runtimeState: StopState = {
      budgetUsed: state.budgetUsed,
      failureCount: state.failureCount,
    };

    let totalTokens = 0;

    for (let step = 0; step < this.config.max_steps; step++) {
      stopReason =
        this.stopController.checkBeforeTurn(runtimeState) ?? stopReason;
      if (stopReason === "max_budget_reached") break;

      const turnIdx = turns.length + 1;
      const workingMemory = this.memory.buildWorkingMemory(
        effectiveGoal,
        effectiveContext,
        turns,
      );

      const actionResult = await this._generateActionWithSchemaRetry(
        wmToRecord(workingMemory),
      );

      // Track token usage
      const raw = actionResult.llm_raw_output;
      if (
        raw !== null &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        "_usage" in (raw as Record<string, unknown>)
      ) {
        const usage = (raw as Record<string, unknown>)._usage;
        if (typeof usage === "object" && usage !== null) {
          totalTokens += ((usage as Record<string, unknown>).total_tokens as number) ?? 0;
        }
      }
      if (
        this.config.max_tokens_budget !== null &&
        totalTokens > this.config.max_tokens_budget
      ) {
        stopReason = "token_budget_exceeded";
        break;
      }

      runtimeState.budgetUsed += actionResult.schema_errors.length + 1;

      if (!actionResult.ok) {
        runtimeState.failureCount += 1;
        stopReason =
          this.stopController.checkAfterFailure(runtimeState) ?? "schema_error";
        const record: TurnRecord = {
          turn: turnIdx,
          goal: effectiveGoal,
          working_memory: wmToRecord(workingMemory),
          llm_raw_output: actionResult.llm_raw_output,
          llm_action: {
            type: "schema_error",
            error: actionResult.error,
            schema_errors: actionResult.schema_errors,
            attempts: actionResult.schema_errors.length,
          },
          tool_result: null,
          observation: actionResult.error ?? "",
        };
        turns.push(record);
        logger.append(record);
        if (options?.onTurn) options.onTurn(record);
        snapshotPath = this._saveSnapshot(
          effectiveGoal,
          effectiveContext,
          turns,
          runtimeState,
          dangerousSigs,
        );
        break;
      }

      const action = actionResult.action!;
      const llmRawOutput = actionResult.llm_raw_output;
      const schemaRetryCount = actionResult.schema_errors.length;

      if (action.action_type === "final_response") {
        stopReason = this.stopController.checkGoalReached(action.content ?? "")
          ? "goal_reached"
          : "final_response";

        const record: TurnRecord = {
          turn: turnIdx,
          goal: effectiveGoal,
          working_memory: wmToRecord(workingMemory),
          llm_raw_output: llmRawOutput,
          llm_action: {
            action_type: action.action_type,
            raw_output: action.raw_output,
            tool_name: action.tool_name,
            arguments: action.arguments,
            content: action.content,
            schema_retry_count: schemaRetryCount,
          },
          tool_result: null,
          observation: action.content ?? "",
        };
        turns.push(record);
        logger.append(record);
        if (options?.onTurn) options.onTurn(record);
        snapshotPath = this._saveSnapshot(
          effectiveGoal,
          effectiveContext,
          turns,
          runtimeState,
          dangerousSigs,
        );

        return {
          final_response: action.content ?? "",
          turns,
          stop_reason: stopReason,
          log_path: logger.path,
          snapshot_path: snapshotPath,
          total_tokens: totalTokens,
        };
      }

      // tool_call
      const toolResult = this._executeToolCall(
        action.tool_name ?? "",
        action.arguments,
        dangerousSigs,
        options?.onApprove,
      );
      runtimeState.budgetUsed += toolResult.attempts;
      if (!toolResult.ok) {
        runtimeState.failureCount += 1;
      }

      const observation =
        `tool=${action.tool_name}; ok=${toolResult.ok}; ` +
        `output=${toolResult.output}; error=${toolResult.error}`;

      const record: TurnRecord = {
        turn: turnIdx,
        goal: effectiveGoal,
        working_memory: wmToRecord(workingMemory),
        llm_raw_output: llmRawOutput,
        llm_action: {
          action_type: action.action_type,
          raw_output: action.raw_output,
          tool_name: action.tool_name,
          arguments: action.arguments,
          content: action.content,
          schema_retry_count: schemaRetryCount,
        },
        tool_result: {
          ok: toolResult.ok,
          output: toolResult.output,
          error: toolResult.error,
          retryable: toolResult.retryable,
          blocked: toolResult.blocked,
          attempts: toolResult.attempts,
        },
        observation,
      };
      turns.push(record);
      logger.append(record);
      if (options?.onTurn) options.onTurn(record);
      if (this.memory.maybeCompress(turns) && options?.onCompress) {
        options.onCompress();
      }
      snapshotPath = this._saveSnapshot(
        effectiveGoal,
        effectiveContext,
        turns,
        runtimeState,
        dangerousSigs,
      );
      stopReason =
        this.stopController.checkAfterFailure(runtimeState) ?? stopReason;
      if (stopReason === "max_failures_reached") break;
    }

    const finalResponse = `Stopped without final response. reason=${stopReason}`;
    return {
      final_response: finalResponse,
      turns,
      stop_reason: stopReason,
      log_path: logger.path,
      snapshot_path: snapshotPath,
      total_tokens: totalTokens,
    };
  }

  async resume(snapshotPath: string): Promise<RunResult> {
    return this.run("", null, { resumeFrom: snapshotPath });
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  private async _generateActionWithSchemaRetry(
    workingMemory: Record<string, unknown>,
  ): Promise<ActionResult> {
    const schemaErrors: string[] = [];
    const llmOutputs: unknown[] = [];
    let llmInput: Record<string, unknown> = { ...workingMemory };

    for (
      let attempt = 0;
      attempt <= this.config.schema_retry_limit;
      attempt++
    ) {
      const llmRawOutput = await this.llm.generate(llmInput);
      llmOutputs.push(llmRawOutput);

      try {
        const action = parseLLMAction(llmRawOutput);
        const outputForLog =
          llmOutputs.length === 1 ? llmOutputs[0] : llmOutputs;
        return {
          ok: true,
          action,
          llm_raw_output: outputForLog,
          schema_errors: schemaErrors,
          error: null,
        };
      } catch (exc) {
        if (!(exc instanceof SchemaError)) throw exc;
        schemaErrors.push(exc.message);
        if (attempt >= this.config.schema_retry_limit) {
          const outputForLog =
            llmOutputs.length === 1 ? llmOutputs[0] : llmOutputs;
          return {
            ok: false,
            action: null,
            llm_raw_output: outputForLog,
            schema_errors: schemaErrors,
            error: exc.message,
          };
        }
        llmInput = {
          ...workingMemory,
          schema_feedback: {
            last_error: exc.message,
            required_types: ["tool_call", "final_response"],
          },
        };
      }
    }

    return {
      ok: false,
      action: null,
      llm_raw_output: llmOutputs,
      schema_errors: schemaErrors,
      error: "Unexpected schema retry state.",
    };
  }

  private _loadState(
    goal: string,
    context: Record<string, unknown>,
    resumeFrom?: string,
  ): {
    goal: string;
    context: Record<string, unknown>;
    turns: TurnRecord[];
    summary: string;
    failureCount: number;
    budgetUsed: number;
    dangerousToolSignatures: string[];
    snapshotPath: string | null;
  } {
    if (!resumeFrom) {
      return {
        goal,
        context,
        turns: [],
        summary: "",
        failureCount: 0,
        budgetUsed: 0,
        dangerousToolSignatures: [],
        snapshotPath: null,
      };
    }

    const state = this.snapshotStore.load(resumeFrom);
    return {
      goal: state.goal,
      context: state.context,
      turns: state.turns,
      summary: state.summary ?? "",
      failureCount: state.failure_count ?? 0,
      budgetUsed: state.budget_used ?? 0,
      dangerousToolSignatures: state.dangerous_tool_signatures ?? [],
      snapshotPath: resumeFrom,
    };
  }

  private _saveSnapshot(
    goal: string,
    context: Record<string, unknown>,
    turns: TurnRecord[],
    runtimeState: StopState,
    dangerousToolSignatures: string[],
  ): string {
    return this.snapshotStore.save({
      goal,
      context,
      turns,
      summary: this.memory.summary,
      failure_count: runtimeState.failureCount,
      budget_used: runtimeState.budgetUsed,
      dangerous_tool_signatures: dangerousToolSignatures,
    });
  }

  _needsApproval(toolName: string): boolean {
    const trust = this.config.trust_level;
    if (trust === "yolo") return false;
    if (trust === "auto-edit") return toolName === "bash";
    // trust === "ask": all sensitive tools need approval
    return HarnessAgent._APPROVAL_REQUIRED_TOOLS.has(toolName);
  }

  private _executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    dangerousToolSignatures: string[],
    onApprove?: (
      toolName: string,
      description: string,
      args: Record<string, unknown>,
    ) => boolean,
  ): ToolExecutionResult {
    // Approval check
    if (this._needsApproval(toolName)) {
      if (!onApprove) {
        return toolError(
          `Tool '${toolName}' requires approval but no approval ` +
            "callback provided. Use --trust yolo or run in interactive mode.",
        );
      }
      const desc = HarnessAgent._describeToolCall(toolName, args);
      if (!onApprove(toolName, desc, args)) {
        return toolError("User denied tool execution");
      }
    }

    // Dangerous tool fingerprint check
    const fingerprint = JSON.stringify(
      { tool_name: toolName, arguments: args },
      Object.keys({ tool_name: toolName, arguments: args }).sort(),
    );
    if (
      this.config.dangerous_tools.includes(toolName) &&
      dangerousToolSignatures.includes(fingerprint)
    ) {
      return toolError(
        `Repeated dangerous tool call blocked: ${toolName}`,
        { blocked: true },
      );
    }

    // Retry loop
    let attempt = 0;
    let result: ToolExecutionResult;
    do {
      attempt += 1;
      result = this.tools.execute(toolName, args);
      result.attempts = attempt;
    } while (this.errorPolicy.shouldRetryTool(result, attempt));

    // Cache dangerous fingerprint on success
    if (
      this.config.dangerous_tools.includes(toolName) &&
      !dangerousToolSignatures.includes(fingerprint)
    ) {
      dangerousToolSignatures.push(fingerprint);
    }

    return result;
  }

  static _describeToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): string {
    if (toolName === "bash") return String(args.command ?? "");
    if (toolName === "edit_file") {
      const filePath = args.path ?? "";
      const oldText = String(args.old_text ?? "").slice(0, 50);
      return `${filePath}: '${oldText}'`;
    }
    if (toolName === "write_text_file") return String(args.path ?? "");
    if (toolName === "write_file") return String(args.path ?? "");
    if (toolName === "spawn_agent") return String(args.goal ?? "");
    return JSON.stringify(args);
  }
}
