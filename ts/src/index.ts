/**
 * HAU — Harness for Yourself
 * Public API exports.
 */

// Types
export type {
  ActionType,
  TrustLevel,
  LLMAction,
  ToolExecutionResult,
  TurnRecord,
  RunResult,
  ToolSchema,
} from "./types.js";

export { SchemaError, RetryableToolError, toolSuccess, toolError } from "./types.js";

// Schema
export { ensureDict, parseLLMAction } from "./schema.js";

// Tools
export { ToolDispatcher, registerCodingTools } from "./tools.js";

// Coding Tools
export {
  readFile,
  editFile,
  writeFile,
  runBash,
  globFiles,
  grepSearch,
  listDirectory,
} from "./coding-tools.js";

// LLM
export {
  BaseLLM,
  ScriptedLLM,
  RuleBasedLLM,
  DeepSeekLLM,
  buildSystemPrompt,
} from "./llm.js";
export type { TransportFn } from "./llm.js";
