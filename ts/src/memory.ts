/**
 * Memory management — rolling window + compression + tagged observation extraction.
 */

import type { TurnRecord } from "./types.js";

export const MAX_OBSERVATION_CHARS = 2000;

// --- Public interfaces ---

export interface HistoryEntry {
  turn: number;
  action: Record<string, unknown>;
  observation: string;
  tool_result: Record<string, unknown> | null;
}

export interface WorkingMemory {
  goal: string;
  context: Record<string, unknown>;
  summary_memory: string;
  history: HistoryEntry[];
}

// --- Helper functions (exported for testing) ---

/** Truncate `text` to `limit` chars, appending a marker if cut. */
export function truncateStr(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n[observation truncated at ${limit} chars]`;
}

/** Return a shallow copy of `result` with long string fields truncated. */
export function truncateToolResult(result: unknown): unknown {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }

  const copy = { ...(result as Record<string, unknown>) };
  const output = copy.output;

  if (output !== null && typeof output === "object" && !Array.isArray(output)) {
    const outputObj = output as Record<string, unknown>;
    if ("content" in outputObj && typeof outputObj.content === "string") {
      if (outputObj.content.length > MAX_OBSERVATION_CHARS) {
        const outputCopy = { ...outputObj };
        outputCopy.content =
          outputObj.content.slice(0, MAX_OBSERVATION_CHARS) +
          `\n[observation truncated at ${MAX_OBSERVATION_CHARS} chars]`;
        copy.output = outputCopy;
      }
    }
  } else if (typeof output === "string" && output.length > MAX_OBSERVATION_CHARS) {
    copy.output =
      output.slice(0, MAX_OBSERVATION_CHARS) +
      `\n[observation truncated at ${MAX_OBSERVATION_CHARS} chars]`;
  }

  return copy;
}

/** Extract lines starting with `prefix` (case-insensitive) from turn observations. Deduped. */
function extractTaggedObservations(turns: TurnRecord[], prefix: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const turn of turns) {
    const observation = turn.observation.trim();
    if (observation.toLowerCase().startsWith(prefix.toLowerCase())) {
      const value = observation.slice(prefix.length).trim();
      if (value && !seen.has(value)) {
        seen.add(value);
        values.push(value);
      }
    }
  }
  return values;
}

// --- MemoryManager class ---

export class MemoryManager {
  public summary = "";

  constructor(public readonly maxHistoryTurns: number = 8) {}

  /** Build the working memory dict for the current turn. */
  buildWorkingMemory(
    goal: string,
    context: Record<string, unknown>,
    turns: TurnRecord[],
  ): WorkingMemory {
    const recentTurns = turns.slice(-this.maxHistoryTurns);
    const history: HistoryEntry[] = recentTurns.map((t) => ({
      turn: t.turn,
      action: t.llm_action,
      observation: truncateStr(t.observation, MAX_OBSERVATION_CHARS),
      tool_result: truncateToolResult(t.tool_result) as Record<string, unknown> | null,
    }));

    return {
      goal,
      context,
      summary_memory: this.summary,
      history,
    };
  }

  /** Compress old turns into summary when history exceeds threshold. Returns true if compressed. */
  maybeCompress(turns: TurnRecord[], maxTotalTurns?: number): boolean {
    const threshold = maxTotalTurns ?? this.maxHistoryTurns + 4;
    if (turns.length <= threshold) return false;

    const oldTurns = turns.slice(0, -this.maxHistoryTurns);
    if (oldTurns.length === 0) return false;

    const constraints = extractTaggedObservations(oldTurns, "constraint:");
    const openItems = extractTaggedObservations(oldTurns, "todo:");
    const evidence = extractTaggedObservations(oldTurns, "evidence:");
    const briefLines = oldTurns
      .slice(-4)
      .map((t) => `turn ${t.turn}: ${t.observation}`);

    const parts: string[] = [];
    if (constraints.length > 0) parts.push(`Constraints: ${constraints.join("; ")}`);
    if (openItems.length > 0) parts.push(`Open items: ${openItems.join("; ")}`);
    if (evidence.length > 0) parts.push(`Evidence: ${evidence.join("; ")}`);
    if (briefLines.length > 0) parts.push(`Recent compressed history: ${briefLines.join(" | ")}`);

    this.summary = parts.join(" || ");
    return true;
  }

  /** Return a compact one-line summary of a completed run. */
  summarizeRun(goal: string, turns: TurnRecord[], stopReason: string): string {
    const constraints = extractTaggedObservations(turns, "constraint:");
    const evidence = extractTaggedObservations(turns, "evidence:");

    const parts = [`[Goal: ${goal.slice(0, 80)}] stop=${stopReason} turns=${turns.length}`];
    if (constraints.length > 0) parts.push(`constraints: ${constraints.slice(0, 3).join("; ")}`);
    if (evidence.length > 0) parts.push(`evidence: ${evidence.slice(0, 3).join("; ")}`);

    return parts.join(" | ");
  }
}
