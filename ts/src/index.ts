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

// Agent
export { HarnessAgent } from "./agent.js";
export type { RunConfig } from "./agent.js";

// Subagent
export {
  SubAgentSpawner,
  createUseSkillCallable,
  resolveTrust,
} from "./subagent.js";
export type { SpawnResult, SkillResult } from "./subagent.js";

// Memory & Control
export { MemoryManager } from "./memory.js";
export { StopController } from "./stop-controller.js";
export { ErrorPolicy } from "./error-policy.js";
export { TrajectoryLogger } from "./logger.js";

// Persistence
export { SnapshotStore } from "./snapshot.js";
export { SessionManager } from "./session.js";
export type { SessionState } from "./session.js";
export { StrategyConfig } from "./config.js";

// Definitions & Context
export {
  parseDefinitionFile,
  loadAgentDefinitions,
  loadSkillDefinitions,
} from "./definitions.js";
export type { AgentDefinition, SkillDefinition } from "./definitions.js";
export { ProjectMemory } from "./project-memory.js";
export { loadProjectContext } from "./context.js";

// Anthropic LLM
export { AnthropicLLM } from "./anthropic-llm.js";

// Eval
export { EvalRunner, BUILTIN_CASES } from "./eval.js";
export type { EvalCase, EvalCaseResult, EvalReport } from "./eval.js";
