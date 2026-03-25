/**
 * Snapshot store for atomic state persistence.
 * Saves and loads agent state snapshots with atomic write semantics.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TurnRecord } from "./types.js";

/** Shape of a persisted snapshot. */
export interface SnapshotState {
  goal: string;
  context: Record<string, unknown>;
  turns: TurnRecord[];
  summary: string;
  failure_count: number;
  budget_used: number;
  dangerous_tool_signatures: string[];
}

export class SnapshotStore {
  readonly snapshotDir: string;

  constructor(snapshotDir: string) {
    this.snapshotDir = snapshotDir;
    fs.mkdirSync(snapshotDir, { recursive: true });
  }

  /**
   * Atomically save a snapshot state to disk.
   * Writes to a .tmp file first, then renames to the final path.
   * Returns the path to the saved file.
   */
  save(state: SnapshotState): string {
    const now = new Date();
    const stamp = _formatTimestamp(now);
    const filename = `snapshot-${stamp}.json`;
    const filePath = path.join(this.snapshotDir, filename);
    const tmpPath = filePath + ".tmp";

    // Serialize turns as plain objects (they are already plain interfaces in TS)
    const payload = { ...state };
    const json = JSON.stringify(payload, null, 2);

    fs.writeFileSync(tmpPath, json, "utf-8");
    fs.renameSync(tmpPath, filePath);

    return filePath;
  }

  /**
   * Load a snapshot from the given path.
   * Validates JSON integrity and reconstructs TurnRecord objects.
   */
  load(filePath: string): SnapshotState {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Snapshot file not found: ${filePath}`);
    }

    let raw: unknown;
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      raw = JSON.parse(content);
    } catch {
      throw new Error(`Snapshot file is corrupted (invalid JSON): ${filePath}`);
    }

    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`Snapshot file does not contain a JSON object: ${filePath}`);
    }

    const data = raw as Record<string, unknown>;

    // Validate and reconstruct turns
    const rawTurns = (data.turns as unknown[]) ?? [];
    let turns: TurnRecord[];
    try {
      turns = rawTurns.map((t) => {
        if (typeof t !== "object" || t === null) {
          throw new Error("invalid turn");
        }
        const turn = t as Record<string, unknown>;
        return {
          turn: turn.turn as number,
          goal: turn.goal as string,
          working_memory: (turn.working_memory ?? {}) as Record<string, unknown>,
          llm_raw_output: turn.llm_raw_output,
          llm_action: (turn.llm_action ?? {}) as Record<string, unknown>,
          tool_result: (turn.tool_result ?? null) as Record<string, unknown> | null,
          observation: turn.observation as string,
        };
      });
    } catch {
      throw new Error(`Snapshot file has invalid turn data: ${filePath}`);
    }

    return {
      goal: data.goal as string,
      context: (data.context ?? {}) as Record<string, unknown>,
      turns,
      summary: (data.summary ?? "") as string,
      failure_count: (data.failure_count ?? 0) as number,
      budget_used: (data.budget_used ?? 0) as number,
      dangerous_tool_signatures: Array.isArray(data.dangerous_tool_signatures)
        ? (data.dangerous_tool_signatures as string[])
        : [],
    };
  }
}

/** Format a Date as YYYYMMDD-HHMMSS-ffffff (microseconds zero-padded). */
function _formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}${mo}${d}-${h}${mi}${s}-${ms}000`;
}
