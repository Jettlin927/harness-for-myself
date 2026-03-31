/**
 * HookManager — execute user-defined shell commands at agent lifecycle events.
 */

import * as childProcess from "node:child_process";
import type { HookDefinition, HookEvent } from "./types.js";

export interface HookResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export class HookManager {
  private readonly _hooks: HookDefinition[];
  private readonly _matcherSets: Map<HookDefinition, Set<string>>;

  constructor(hooks?: HookDefinition[]) {
    this._hooks = hooks ?? [];
    this._matcherSets = new Map();
    for (const h of this._hooks) {
      if (h.matcher) {
        this._matcherSets.set(h, new Set(h.matcher.split("|")));
      }
    }
  }

  /** Get hooks matching an event and optional tool name. */
  getHooks(event: HookEvent, toolName?: string): HookDefinition[] {
    return this._hooks.filter((h) => {
      if (h.event !== event) return false;
      const matcherSet = this._matcherSets.get(h);
      if (matcherSet && toolName) return matcherSet.has(toolName);
      return !matcherSet;
    });
  }

  /** Execute all hooks for an event. Returns results for each hook. */
  runHooks(
    event: HookEvent,
    toolName?: string,
    env?: Record<string, string>,
  ): HookResult[] {
    if (this._hooks.length === 0) return [];
    const hooks = this.getHooks(event, toolName);
    if (hooks.length === 0) return [];

    const mergedEnv = env ? { ...process.env, ...env } : process.env;
    const results: HookResult[] = [];

    for (const hook of hooks) {
      const timeout = (hook.timeout ?? 30) * 1000;
      const result = childProcess.spawnSync("sh", ["-c", hook.command], {
        timeout,
        encoding: "utf-8",
        env: mergedEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timedOut =
        !!result.error &&
        (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";

      results.push({
        command: hook.command,
        stdout: (result.stdout ?? "").trim(),
        stderr: (result.stderr ?? "").trim(),
        exitCode: timedOut ? -1 : (result.status ?? -1),
        timedOut,
      });
    }

    return results;
  }

  get hookCount(): number {
    return this._hooks.length;
  }
}
