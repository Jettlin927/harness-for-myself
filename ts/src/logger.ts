/**
 * Trajectory logger — JSONL append-only log of turn records.
 */

import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { TurnRecord } from "./types.js";

export class TrajectoryLogger {
  public readonly path: string;

  constructor(logDir: string) {
    mkdirSync(logDir, { recursive: true });

    const now = new Date();
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    const stamp = [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      "-",
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
      "-",
      pad(now.getMilliseconds() * 1000, 6), // microsecond-ish resolution
    ].join("");

    this.path = join(logDir, `trajectory-${stamp}.jsonl`);
  }

  /** Append a single turn record as one JSON line. */
  append(record: TurnRecord): void {
    const line = JSON.stringify(record) + "\n";
    appendFileSync(this.path, line, "utf-8");
  }
}
