import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { StrategyConfig } from "../src/config.js";

describe("StrategyConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  });

  // ── default ───────────────────────────────────────────────────

  it("default() returns baseline config", () => {
    const cfg = StrategyConfig.default();
    expect(cfg.version).toBe("v1.0");
    expect(cfg.max_steps).toBe(8);
    expect(cfg.max_budget).toBeNull();
    expect(cfg.max_failures).toBe(3);
    expect(cfg.max_history_turns).toBe(8);
    expect(cfg.goal_reached_token).toBeNull();
  });

  // ── load ──────────────────────────────────────────────────────

  it("loads complete JSON file", () => {
    const data = {
      version: "v2.0",
      description: "test config",
      max_steps: 5,
      max_budget: 100,
      max_failures: 2,
      max_history_turns: 4,
      goal_reached_token: "DONE",
    };
    const filePath = path.join(tmpDir, "full.json");
    fs.writeFileSync(filePath, JSON.stringify(data), "utf-8");

    const cfg = StrategyConfig.load(filePath);
    expect(cfg.version).toBe("v2.0");
    expect(cfg.description).toBe("test config");
    expect(cfg.max_steps).toBe(5);
    expect(cfg.max_budget).toBe(100);
    expect(cfg.max_failures).toBe(2);
    expect(cfg.max_history_turns).toBe(4);
    expect(cfg.goal_reached_token).toBe("DONE");
  });

  it("loads partial JSON with defaults for missing fields", () => {
    const data = { version: "v3.0", max_steps: 12 };
    const filePath = path.join(tmpDir, "partial.json");
    fs.writeFileSync(filePath, JSON.stringify(data), "utf-8");

    const cfg = StrategyConfig.load(filePath);
    const defaults = StrategyConfig.default();
    expect(cfg.version).toBe("v3.0");
    expect(cfg.max_steps).toBe(12);
    expect(cfg.description).toBe(defaults.description);
    expect(cfg.max_budget).toBe(defaults.max_budget);
    expect(cfg.max_failures).toBe(defaults.max_failures);
    expect(cfg.max_history_turns).toBe(defaults.max_history_turns);
    expect(cfg.goal_reached_token).toBe(defaults.goal_reached_token);
  });

  it("throws on unknown fields", () => {
    const data = { version: "v1.0", unknown_field: "oops" };
    const filePath = path.join(tmpDir, "unknown.json");
    fs.writeFileSync(filePath, JSON.stringify(data), "utf-8");

    expect(() => StrategyConfig.load(filePath)).toThrow(/unknown/i);
  });

  // ── toRunConfig ───────────────────────────────────────────────

  it("toRunConfig maps fields correctly", () => {
    const cfg = new StrategyConfig({
      version: "v1.0",
      description: "mapping test",
      max_steps: 10,
      max_budget: 50,
      max_failures: 4,
      max_history_turns: 6,
      goal_reached_token: "FINISHED",
    });
    const runCfg = cfg.toRunConfig();
    expect(runCfg.max_steps).toBe(10);
    expect(runCfg.max_budget).toBe(50);
    expect(runCfg.max_failures).toBe(4);
    expect(runCfg.max_history_turns).toBe(6);
    expect(runCfg.goal_reached_token).toBe("FINISHED");
  });

  it("toRunConfig excludes version and description", () => {
    const cfg = StrategyConfig.default();
    const runCfg = cfg.toRunConfig();
    expect(runCfg).not.toHaveProperty("version");
    expect(runCfg).not.toHaveProperty("description");
  });

  // ── toDict ────────────────────────────────────────────────────

  it("toDict returns all fields", () => {
    const cfg = new StrategyConfig({
      version: "v2.0",
      max_steps: 15,
    });
    const d = cfg.toDict();
    expect(d.version).toBe("v2.0");
    expect(d.max_steps).toBe(15);
    expect(d.description).toBe("");
    expect(d).toHaveProperty("max_budget");
    expect(d).toHaveProperty("max_failures");
    expect(d).toHaveProperty("max_history_turns");
    expect(d).toHaveProperty("goal_reached_token");
  });

  it("toDict roundtrips through StrategyConfig constructor", () => {
    const cfg = new StrategyConfig({
      version: "v5.0",
      description: "roundtrip",
      max_steps: 20,
      max_budget: 200,
      max_failures: 5,
      max_history_turns: 10,
      goal_reached_token: "END",
    });
    const d = cfg.toDict();
    const cfg2 = new StrategyConfig(d);
    expect(cfg2.version).toBe(cfg.version);
    expect(cfg2.max_steps).toBe(cfg.max_steps);
    expect(cfg2.max_budget).toBe(cfg.max_budget);
  });
});
