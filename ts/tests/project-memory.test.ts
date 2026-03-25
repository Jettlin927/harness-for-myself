import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectMemory } from "../src/project-memory.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "hau-mem-test-"));
}

describe("ProjectMemory", () => {
  let root: string;
  let pm: ProjectMemory;

  beforeEach(() => {
    root = makeTmpDir();
    pm = new ProjectMemory(root);
  });

  it("creates .hau/memory/ directory on construction", () => {
    const newRoot = join(root, "subproject");
    new ProjectMemory(newRoot);
    expect(existsSync(join(newRoot, ".hau", "memory"))).toBe(true);
  });

  it("save and load roundtrip preserves all fields", () => {
    pm.save("test_command", "make check", { tags: ["convention"] });
    const entry = pm.load("test_command");
    expect(entry).not.toBeNull();
    expect(entry!.key).toBe("test_command");
    expect(entry!.content).toBe("make check");
    expect(entry!.tags).toEqual(["convention"]);
    expect(entry!.created_at).toBeTruthy();
  });

  it("load returns null for non-existent key", () => {
    expect(pm.load("nonexistent")).toBeNull();
  });

  it("search by content substring (case-insensitive)", () => {
    pm.save("arch", "MVC pattern with service layer");
    pm.save("test_cmd", "uv run pytest");
    const results = pm.search({ query: "mvc" });
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("arch");
  });

  it("search by tags filters correctly", () => {
    pm.save("a", "alpha", { tags: ["constraint"] });
    pm.save("b", "beta", { tags: ["convention"] });
    pm.save("c", "gamma", { tags: ["constraint", "convention"] });
    const results = pm.search({ tags: ["constraint"] });
    const keys = new Set(results.map((e) => e.key));
    expect(keys).toEqual(new Set(["a", "c"]));
  });

  it("search by content AND tags uses AND logic", () => {
    pm.save("a", "alpha value", { tags: ["constraint"] });
    pm.save("b", "alpha beta", { tags: ["convention"] });
    const results = pm.search({ query: "alpha", tags: ["constraint"] });
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("a");
  });

  it("search with no filters returns all entries", () => {
    pm.save("x", "one");
    pm.save("y", "two");
    const results = pm.search();
    expect(results).toHaveLength(2);
  });

  it("delete existing entry returns true", () => {
    pm.save("tmp", "temporary data");
    expect(pm.delete("tmp")).toBe(true);
    expect(pm.load("tmp")).toBeNull();
  });

  it("delete non-existent key returns false", () => {
    expect(pm.delete("ghost")).toBe(false);
  });

  it("listAll returns all entries sorted newest first", async () => {
    pm.save("a", "first");
    // Small delays to ensure distinct timestamps
    await new Promise((r) => setTimeout(r, 10));
    pm.save("b", "second");
    await new Promise((r) => setTimeout(r, 10));
    pm.save("c", "third");
    const entries = pm.listAll();
    const keys = new Set(entries.map((e) => e.key));
    expect(keys).toEqual(new Set(["a", "b", "c"]));
    // newest first — c was saved last
    expect(entries[0].key).toBe("c");
  });

  it("toContextString formats entries correctly", () => {
    pm.save("test_cmd", "make check", { tags: ["convention"] });
    pm.save("arch", "MVC pattern");
    const ctx = pm.toContextString();
    expect(ctx).toContain("test_cmd");
    expect(ctx).toContain("make check");
    expect(ctx).toContain("arch");
    expect(ctx).toContain("MVC pattern");
    expect(ctx).toContain("convention");
  });

  it("toContextString returns empty string when no memories", () => {
    expect(pm.toContextString()).toBe("");
  });

  it("toContextString respects maxEntries limit", () => {
    for (let i = 0; i < 5; i++) {
      pm.save(`key${i}`, `value${i}`);
    }
    const ctx = pm.toContextString(2);
    const lines = ctx.split("\n").filter((ln) => ln.startsWith("- "));
    expect(lines).toHaveLength(2);
  });

  it("saving same key overwrites previous entry", () => {
    pm.save("ver", "v1.0", { tags: ["release"] });
    pm.save("ver", "v2.0", { tags: ["release", "latest"] });
    const entry = pm.load("ver");
    expect(entry).not.toBeNull();
    expect(entry!.content).toBe("v2.0");
    expect(entry!.tags).toEqual(["release", "latest"]);
  });

  it("corrupted JSON files are silently skipped", () => {
    pm.save("good", "valid entry");
    const badPath = join(root, ".hau", "memory", "bad.json");
    writeFileSync(badPath, "not valid json{{{", "utf-8");
    const entries = pm.listAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("good");
    expect(pm.load("bad")).toBeNull();
  });
});
