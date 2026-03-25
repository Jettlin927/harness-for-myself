/**
 * Versioned strategy configuration for the agent harness.
 * Supports loading from JSON files, conversion to RunConfig, and serialization.
 */

import * as fs from "node:fs";

// ── RunConfig (temporary, will be provided by agent.ts later) ────────────────

export interface RunConfig {
  max_steps: number;
  max_budget: number | null;
  max_failures: number | null;
  max_history_turns: number;
  goal_reached_token: string | null;
}

// ── Known fields ─────────────────────────────────────────────────────────────

const KNOWN_FIELDS = new Set([
  "version",
  "description",
  "max_steps",
  "max_budget",
  "max_failures",
  "max_history_turns",
  "goal_reached_token",
]);

// ── StrategyConfig ───────────────────────────────────────────────────────────

export interface StrategyConfigData {
  version?: string;
  description?: string;
  max_steps?: number;
  max_budget?: number | null;
  max_failures?: number | null;
  max_history_turns?: number;
  goal_reached_token?: string | null;
}

export class StrategyConfig {
  readonly version: string;
  readonly description: string;
  readonly max_steps: number;
  readonly max_budget: number | null;
  readonly max_failures: number | null;
  readonly max_history_turns: number;
  readonly goal_reached_token: string | null;

  constructor(data?: StrategyConfigData) {
    const defaults = StrategyConfig._defaults();
    this.version = data?.version ?? defaults.version;
    this.description = data?.description ?? defaults.description;
    this.max_steps = data?.max_steps ?? defaults.max_steps;
    this.max_budget = data?.max_budget !== undefined ? data.max_budget : defaults.max_budget;
    this.max_failures =
      data?.max_failures !== undefined ? data.max_failures : defaults.max_failures;
    this.max_history_turns = data?.max_history_turns ?? defaults.max_history_turns;
    this.goal_reached_token =
      data?.goal_reached_token !== undefined
        ? data.goal_reached_token
        : defaults.goal_reached_token;
  }

  /** Return the built-in baseline strategy. */
  static default(): StrategyConfig {
    return new StrategyConfig();
  }

  /**
   * Load a StrategyConfig from a JSON file.
   * Unknown fields cause a ValueError. Missing fields use defaults.
   */
  static load(filePath: string): StrategyConfig {
    const content = fs.readFileSync(filePath, "utf-8");
    const raw = JSON.parse(content) as Record<string, unknown>;

    const unknown = Object.keys(raw).filter((k) => !KNOWN_FIELDS.has(k));
    if (unknown.length > 0) {
      throw new Error(`Unknown fields in config file: ${unknown.join(", ")}`);
    }

    return new StrategyConfig(raw as StrategyConfigData);
  }

  /** Convert to a RunConfig (excludes version and description). */
  toRunConfig(): RunConfig {
    return {
      max_steps: this.max_steps,
      max_budget: this.max_budget,
      max_failures: this.max_failures,
      max_history_turns: this.max_history_turns,
      goal_reached_token: this.goal_reached_token,
    };
  }

  /** Serialize to a plain object. */
  toDict(): Record<string, unknown> {
    return {
      version: this.version,
      description: this.description,
      max_steps: this.max_steps,
      max_budget: this.max_budget,
      max_failures: this.max_failures,
      max_history_turns: this.max_history_turns,
      goal_reached_token: this.goal_reached_token,
    };
  }

  private static _defaults() {
    return {
      version: "v1.0",
      description: "",
      max_steps: 8,
      max_budget: null as number | null,
      max_failures: 3 as number | null,
      max_history_turns: 8,
      goal_reached_token: null as string | null,
    };
  }
}
