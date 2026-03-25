/**
 * LLM output parsing and strict schema validation.
 * All LLM output must pass through parseLLMAction() before use.
 */

import { SchemaError, type LLMAction } from "./types.js";

/**
 * Normalize raw input to a plain object.
 * Accepts objects or JSON strings, rejects everything else.
 */
export function ensureDict(raw: unknown): Record<string, unknown> {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }

  if (typeof raw === "string") {
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch (exc) {
      throw new SchemaError(`LLM output is not valid JSON: ${(exc as Error).message}`);
    }
    if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new SchemaError("Decoded JSON must be an object.");
    }
    return decoded as Record<string, unknown>;
  }

  const typeName = raw === null ? "null" : typeof raw;
  throw new SchemaError(`LLM output must be dict or JSON string, got: ${typeName}`);
}

/**
 * Parse and validate raw LLM output into a structured LLMAction.
 *
 * Validates:
 * - Input is a dict (or valid JSON string)
 * - `type` field is "tool_call" or "final_response"
 * - tool_call: `tool_name` is non-empty string, `arguments` is object
 * - final_response: `content` is non-empty string (after trim)
 */
export function parseLLMAction(raw: unknown): LLMAction {
  const payload = ensureDict(raw);

  const actionType = payload["type"];
  if (actionType !== "tool_call" && actionType !== "final_response") {
    throw new SchemaError("Field 'type' must be 'tool_call' or 'final_response'.");
  }

  if (actionType === "final_response") {
    const content = payload["content"];
    if (typeof content !== "string" || content.trim() === "") {
      throw new SchemaError("final_response requires non-empty string 'content'.");
    }
    return {
      action_type: "final_response",
      raw_output: raw,
      tool_name: null,
      arguments: {},
      content,
    };
  }

  // actionType === "tool_call"
  const toolName = payload["tool_name"];
  if (typeof toolName !== "string" || toolName === "") {
    throw new SchemaError("tool_call requires non-empty string 'tool_name'.");
  }

  const args = payload["arguments"];
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new SchemaError("tool_call requires object 'arguments'.");
  }

  return {
    action_type: "tool_call",
    raw_output: raw,
    tool_name: toolName,
    arguments: args as Record<string, unknown>,
    content: null,
  };
}
