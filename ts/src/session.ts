/**
 * Session-level persistence for the interactive agent harness.
 * Manages cross-run state so that accumulated context and goal history
 * survive across multiple agent.run() calls and process restarts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";

// ── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_SESSION_DIR = path.join(os.homedir(), ".harness", "sessions");
export const MAX_SUMMARY_ENTRIES = 5;

// ── Types ────────────────────────────────────────────────────────────────────

export interface GoalRecord {
  goal: string;
  stop_reason: string;
  turns: number;
  timestamp: string; // ISO 8601
}

export interface SessionState {
  session_id: string;
  created_at: string; // ISO 8601
  goals_completed: GoalRecord[];
  accumulated_summary: string;
  last_snapshot_path: string | null;
}

// ── SessionManager ───────────────────────────────────────────────────────────

export class SessionManager {
  readonly sessionDir: string;

  constructor(sessionDir?: string) {
    this.sessionDir = sessionDir ?? DEFAULT_SESSION_DIR;
    fs.mkdirSync(this.sessionDir, { recursive: true });
  }

  /**
   * Return an existing session or create a new one.
   * If sessionId is given and a file exists, load it. Otherwise create fresh.
   */
  loadOrCreate(sessionId?: string): SessionState {
    if (sessionId) {
      const filePath = this._path(sessionId);
      if (fs.existsSync(filePath)) {
        return this._load(filePath);
      }
    }
    return this._new();
  }

  /**
   * Return the most recently modified session, or null if none exist.
   */
  latest(): SessionState | null {
    const files = this._sortedFiles();
    if (files.length === 0) return null;
    return this._load(files[0]);
  }

  /**
   * Return all sessions sorted by modification time (newest first).
   */
  listSessions(): SessionState[] {
    return this._sortedFiles().map((f) => this._load(f));
  }

  /**
   * Append a completed goal to the session and refresh the summary.
   * Mutates state in place and returns it.
   */
  update(
    state: SessionState,
    goal: string,
    stopReason: string,
    turns: number,
    snapshotPath?: string,
  ): SessionState {
    const entry: GoalRecord = {
      goal,
      stop_reason: stopReason,
      turns,
      timestamp: new Date().toISOString(),
    };
    state.goals_completed.push(entry);

    if (snapshotPath) {
      state.last_snapshot_path = snapshotPath;
    }

    state.accumulated_summary = this._buildSummary(state.goals_completed);
    return state;
  }

  /**
   * Persist session state to disk. Returns the file path.
   */
  save(state: SessionState): string {
    const filePath = this._path(state.session_id);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
    return filePath;
  }

  /**
   * Delete a session file. Returns true if it existed.
   */
  delete(sessionId: string): boolean {
    const filePath = this._path(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _path(sessionId: string): string {
    return path.join(this.sessionDir, `${sessionId}.json`);
  }

  private _new(): SessionState {
    return {
      session_id: randomUUID(),
      created_at: new Date().toISOString(),
      goals_completed: [],
      accumulated_summary: "",
      last_snapshot_path: null,
    };
  }

  private _load(filePath: string): SessionState {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as SessionState;
  }

  private _sortedFiles(): string[] {
    const entries = fs
      .readdirSync(this.sessionDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const fullPath = path.join(this.sessionDir, f);
        const stat = fs.statSync(fullPath);
        return { path: fullPath, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return entries.map((e) => e.path);
  }

  /**
   * Build accumulated_summary from the most recent goal entries.
   */
  private _buildSummary(goals: GoalRecord[]): string {
    const recent = goals.slice(-MAX_SUMMARY_ENTRIES);
    const lines = recent.map((entry, i) => {
      const goalShort = entry.goal.slice(0, 80);
      return `[Past goal ${i + 1}: ${goalShort}] stop=${entry.stop_reason} turns=${entry.turns}`;
    });
    return lines.join("\n");
  }
}
