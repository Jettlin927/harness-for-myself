/**
 * Core type definitions for the HAU harness.
 * All shared types used across modules are defined here.
 */

// --- Type Aliases ---

export type ActionType = "tool_call" | "final_response";
export type TrustLevel = "ask" | "auto-edit" | "yolo";
export type AgentMode = "execute" | "plan";
export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

/** A trackable task within an agent run. */
export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

// --- Error Classes ---

/** Raised when LLM output fails strict schema validation. */
export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

/** Signal that a tool failure is transient and can be retried. */
export class RetryableToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableToolError";
  }
}

// --- Core Interfaces ---

/** Structured action produced by the LLM after schema validation. */
export interface LLMAction {
  action_type: ActionType;
  raw_output: unknown;
  tool_name: string | null;
  arguments: Record<string, unknown>;
  content: string | null;
}

/** Outcome of executing a single tool call. */
export interface ToolExecutionResult {
  ok: boolean;
  output: unknown;
  error: string | null;
  retryable: boolean;
  blocked: boolean;
  attempts: number;
}

/** Complete record of one turn in the agent loop. */
export interface TurnRecord {
  turn: number;
  goal: string;
  working_memory: Record<string, unknown>;
  llm_raw_output: unknown;
  llm_action: Record<string, unknown>;
  tool_result: Record<string, unknown> | null;
  observation: string;
}

/** Final result of an entire agent run. */
export interface RunResult {
  final_response: string;
  turns: TurnRecord[];
  stop_reason: string;
  log_path: string;
  snapshot_path: string | null;
  total_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
}

/** Token usage breakdown from a single LLM call (includes cache stats). */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  total_tokens: number;
}

/** Tool schema for Anthropic-compatible API. */
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Fine-grained permission rule for tool execution. */
export interface PermissionRule {
  tool: string;          // tool name or "*" for all
  pattern?: string;      // prefix match on command (bash) or path (file tools)
  decision: "allow" | "deny" | "ask";
}

// --- Helper Functions ---

/** Create a successful ToolExecutionResult. */
export function toolSuccess(output: unknown, attempts = 1): ToolExecutionResult {
  return { ok: true, output, error: null, retryable: false, blocked: false, attempts };
}

/** Create a failed ToolExecutionResult. */
export function toolError(
  error: string,
  options?: { retryable?: boolean; blocked?: boolean; attempts?: number },
): ToolExecutionResult {
  return {
    ok: false,
    output: null,
    error,
    retryable: options?.retryable ?? false,
    blocked: options?.blocked ?? false,
    attempts: options?.attempts ?? 1,
  };
}
