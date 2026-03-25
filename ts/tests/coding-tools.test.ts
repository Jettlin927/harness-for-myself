import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  editFile,
  globFiles,
  grepSearch,
  listDirectory,
  readFile,
  runBash,
  writeFile,
} from "../src/coding-tools.js";

// ===========================================================================
// read_file
// ===========================================================================

describe("readFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "read-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1
  it("read small file", () => {
    const p = path.join(tmpDir, "small.txt");
    fs.writeFileSync(p, "line1\nline2\nline3\n", "utf-8");
    const result = readFile({ path: p }) as Record<string, unknown>;
    expect(result.lines).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.content).toContain("line1");
  });

  // 2
  it("read with offset and limit", () => {
    const p = path.join(tmpDir, "nums.txt");
    const lines = Array.from({ length: 10 }, (_, i) => `L${i + 1}`);
    fs.writeFileSync(p, lines.join("\n"), "utf-8");
    const result = readFile({ path: p, offset: 3, limit: 2 }) as Record<
      string,
      unknown
    >;
    const content = result.content as string;
    expect(content).toContain("L3");
    expect(content).toContain("L4");
    expect(content).not.toContain("L2");
    expect(content).not.toContain("L5");
  });

  // 3
  it("large file truncation", () => {
    const p = path.join(tmpDir, "big.txt");
    const lines = Array.from({ length: 500 }, (_, i) => `row${i}`);
    fs.writeFileSync(p, lines.join("\n"), "utf-8");
    const result = readFile({ path: p, limit: 10 }) as Record<
      string,
      unknown
    >;
    expect(result.truncated).toBe(true);
    expect(result.content as string).toContain("[truncated:");
    expect(result.content as string).toContain("of 500");
  });

  // 4
  it("relative path raises", () => {
    expect(() => readFile({ path: "relative/file.txt" })).toThrow("absolute");
  });

  // 5
  it("missing file raises", () => {
    expect(() =>
      readFile({ path: path.join(tmpDir, "nope.txt") }),
    ).toThrow(/not found/i);
  });

  // 6
  it("binary file raises", () => {
    const p = path.join(tmpDir, "binary.bin");
    fs.writeFileSync(p, Buffer.from([0x80, 0x81, 0x82, 0xff, 0xfe]));
    expect(() => readFile({ path: p })).toThrow("not valid UTF-8");
  });

  // 7
  it("empty path raises", () => {
    expect(() => readFile({ path: "" })).toThrow("non-empty string");
  });

  // 8
  it("non-string path raises", () => {
    expect(() => readFile({ path: 123 as unknown })).toThrow(
      "non-empty string",
    );
  });

  // 9
  it("line numbers are formatted correctly", () => {
    const p = path.join(tmpDir, "fmt.txt");
    fs.writeFileSync(p, "aaa\nbbb\n", "utf-8");
    const result = readFile({ path: p }) as Record<string, unknown>;
    const content = result.content as string;
    // Expect right-aligned line numbers with tab
    expect(content).toMatch(/^\s+1\taaa/);
    expect(content).toContain("\t" + "bbb");
  });
});

// ===========================================================================
// edit_file
// ===========================================================================

describe("editFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "edit-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 10
  it("single match replacement", () => {
    const p = path.join(tmpDir, "code.py");
    fs.writeFileSync(p, "hello world\n", "utf-8");
    const result = editFile({
      path: p,
      old_text: "hello",
      new_text: "goodbye",
    }) as Record<string, unknown>;
    expect(result.replacements).toBe(1);
  });

  // 11
  it("old_text not found raises", () => {
    const p = path.join(tmpDir, "code.py");
    fs.writeFileSync(p, "hello world\n", "utf-8");
    expect(() =>
      editFile({ path: p, old_text: "missing", new_text: "x" }),
    ).toThrow("not found");
  });

  // 12
  it("multiple matches raises", () => {
    const p = path.join(tmpDir, "dup.py");
    fs.writeFileSync(p, "aaa\naaa\n", "utf-8");
    expect(() =>
      editFile({ path: p, old_text: "aaa", new_text: "bbb" }),
    ).toThrow("2 matches");
  });

  // 13
  it("returns diff", () => {
    const p = path.join(tmpDir, "diffme.txt");
    fs.writeFileSync(p, "alpha\nbeta\ngamma\n", "utf-8");
    const result = editFile({
      path: p,
      old_text: "beta",
      new_text: "BETA",
    }) as Record<string, unknown>;
    const diff = result.diff as string;
    expect(diff).toContain("a/diffme.txt");
    expect(diff).toContain("b/diffme.txt");
    expect(diff).toContain("-beta");
    expect(diff).toContain("+BETA");
  });

  // 14
  it("replacement content is correct", () => {
    const p = path.join(tmpDir, "verify.txt");
    fs.writeFileSync(p, "foo bar baz\n", "utf-8");
    editFile({ path: p, old_text: "bar", new_text: "qux" });
    expect(fs.readFileSync(p, "utf-8")).toBe("foo qux baz\n");
  });

  // 15
  it("relative path raises", () => {
    expect(() =>
      editFile({
        path: "relative/file.txt",
        old_text: "a",
        new_text: "b",
      }),
    ).toThrow("absolute");
  });

  // 16
  it("missing file raises", () => {
    expect(() =>
      editFile({
        path: path.join(tmpDir, "nope.txt"),
        old_text: "a",
        new_text: "b",
      }),
    ).toThrow(/not found/i);
  });

  // 17
  it("empty path raises", () => {
    expect(() =>
      editFile({ path: "", old_text: "a", new_text: "b" }),
    ).toThrow("non-empty string");
  });
});

// ===========================================================================
// write_file
// ===========================================================================

describe("writeFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "write-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 18
  it("create new file", () => {
    const p = path.join(tmpDir, "new.txt");
    const result = writeFile({ path: p, content: "hello world" }) as Record<
      string,
      unknown
    >;
    expect(result.bytes_written).toBe(
      Buffer.byteLength("hello world", "utf-8"),
    );
    expect(fs.readFileSync(p, "utf-8")).toBe("hello world");
  });

  // 19
  it("creates parent dirs", () => {
    const p = path.join(tmpDir, "a", "b", "c", "deep.txt");
    const result = writeFile({ path: p, content: "nested" }) as Record<
      string,
      unknown
    >;
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p, "utf-8")).toBe("nested");
    expect(result.bytes_written).toBeDefined();
  });

  // 20
  it("refuses overwrite", () => {
    const p = path.join(tmpDir, "existing.txt");
    fs.writeFileSync(p, "original", "utf-8");
    expect(() => writeFile({ path: p, content: "overwrite" })).toThrow(
      "edit_file",
    );
  });

  // 21
  it("relative path raises", () => {
    expect(() =>
      writeFile({ path: "relative/file.txt", content: "data" }),
    ).toThrow("absolute");
  });

  // 22
  it("empty path raises", () => {
    expect(() => writeFile({ path: "", content: "data" })).toThrow(
      "non-empty string",
    );
  });

  // 23
  it("non-string path raises", () => {
    expect(() =>
      writeFile({ path: 123 as unknown, content: "data" }),
    ).toThrow("non-empty string");
  });

  // 24
  it("non-string content raises", () => {
    expect(() =>
      writeFile({ path: path.join(tmpDir, "x.txt"), content: 123 as unknown }),
    ).toThrow("string 'content'");
  });
});

// ===========================================================================
// run_bash
// ===========================================================================

describe("runBash", () => {
  // 25
  it("echo command", () => {
    const result = runBash({ command: "echo hello" }) as Record<
      string,
      unknown
    >;
    expect(result.returncode).toBe(0);
    expect(result.stdout).toContain("hello");
  });

  // 26
  it("failing command", () => {
    const result = runBash({ command: "exit 42" }) as Record<string, unknown>;
    expect(result.returncode).toBe(42);
  });

  // 27
  it("timeout handling", () => {
    const result = runBash({ command: "sleep 60", timeout: 1 }) as Record<
      string,
      unknown
    >;
    expect(result.returncode).toBe(-1);
    expect(result.stderr).toContain("timed out");
  });

  // 28
  it("empty command raises", () => {
    expect(() => runBash({ command: "" })).toThrow("non-empty string");
  });

  // 29
  it("non-string command raises", () => {
    expect(() => runBash({ command: 123 as unknown })).toThrow(
      "non-empty string",
    );
  });
});

// ===========================================================================
// glob_files
// ===========================================================================

describe("globFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "glob-test-"));
    fs.writeFileSync(path.join(tmpDir, "a.py"), "a", "utf-8");
    fs.writeFileSync(path.join(tmpDir, "b.txt"), "b", "utf-8");
    const sub = path.join(tmpDir, "sub");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, "c.py"), "c", "utf-8");
    fs.writeFileSync(path.join(sub, "d.py"), "d", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 30
  it("basic glob", () => {
    const result = globFiles({
      pattern: "*.py",
      root: tmpDir,
    }) as Record<string, unknown>;
    expect(result.total).toBe(1);
    expect((result.matches as string[])[0]).toContain("a.py");
  });

  // 31
  it("recursive glob", () => {
    const result = globFiles({
      pattern: "**/*.py",
      root: tmpDir,
    }) as Record<string, unknown>;
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(false);
  });

  // 32
  it("empty match", () => {
    const result = globFiles({
      pattern: "*.rs",
      root: tmpDir,
    }) as Record<string, unknown>;
    expect(result.total).toBe(0);
    expect(result.matches).toEqual([]);
  });

  // 33
  it("limit truncation", () => {
    const result = globFiles({
      pattern: "**/*.py",
      root: tmpDir,
      limit: 2,
    }) as Record<string, unknown>;
    expect((result.matches as string[]).length).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(3);
  });

  // 34
  it("relative root raises", () => {
    expect(() =>
      globFiles({ pattern: "*.py", root: "relative/path" }),
    ).toThrow("absolute");
  });

  // 35
  it("missing root raises", () => {
    expect(() =>
      globFiles({
        pattern: "*.py",
        root: path.join(tmpDir, "nonexistent"),
      }),
    ).toThrow(/not found/i);
  });

  // 36
  it("empty pattern raises", () => {
    expect(() => globFiles({ pattern: "", root: tmpDir })).toThrow(
      "non-empty string",
    );
  });

  // 37
  it("empty root raises", () => {
    expect(() => globFiles({ pattern: "*.py", root: "" })).toThrow(
      "non-empty string",
    );
  });
});

// ===========================================================================
// grep_search
// ===========================================================================

describe("grepSearch", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "grep-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "hello.py"),
      "def hello():\n    return 42\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "world.txt"),
      "hello world\ngoodbye world\n",
      "utf-8",
    );
    const sub = path.join(tmpDir, "sub");
    fs.mkdirSync(sub);
    fs.writeFileSync(
      path.join(sub, "deep.py"),
      "# deep module\nimport os\n",
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 38
  it("basic search", () => {
    const result = grepSearch({
      pattern: "hello",
      root: tmpDir,
    }) as Record<string, unknown>;
    expect(result.total).toBeGreaterThanOrEqual(2);
    const paths = (
      result.matches as Array<Record<string, unknown>>
    ).map((m) => m.path as string);
    expect(paths.some((p) => p.includes("hello.py"))).toBe(true);
  });

  // 39
  it("include filter", () => {
    const result = grepSearch({
      pattern: "hello",
      root: tmpDir,
      include: "*.py",
    }) as Record<string, unknown>;
    for (const m of result.matches as Array<Record<string, unknown>>) {
      expect((m.path as string).endsWith(".py")).toBe(true);
    }
  });

  // 40
  it("regex pattern", () => {
    const result = grepSearch({
      pattern: "def \\w+\\(",
      root: tmpDir,
    }) as Record<string, unknown>;
    expect(result.total).toBe(1);
    const match = (result.matches as Array<Record<string, unknown>>)[0];
    expect(match.content).toContain("def hello()");
  });

  // 41
  it("no matches", () => {
    const result = grepSearch({
      pattern: "zzz_nonexistent",
      root: tmpDir,
    }) as Record<string, unknown>;
    expect(result.total).toBe(0);
  });

  // 42
  it("limit truncation", () => {
    const result = grepSearch({
      pattern: ".",
      root: tmpDir,
      limit: 2,
    }) as Record<string, unknown>;
    expect((result.matches as unknown[]).length).toBe(2);
    expect(result.truncated).toBe(true);
  });

  // 43
  it("binary file skipped", () => {
    const binPath = path.join(tmpDir, "data.bin");
    fs.writeFileSync(
      binPath,
      Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, ...Buffer.from(" hello "), 0x00]),
    );
    const result = grepSearch({
      pattern: "hello",
      root: tmpDir,
    }) as Record<string, unknown>;
    const binMatches = (
      result.matches as Array<Record<string, unknown>>
    ).filter((m) => (m.path as string).includes("data.bin"));
    expect(binMatches.length).toBe(0);
  });

  // 44
  it("context lines", () => {
    const result = grepSearch({
      pattern: "return",
      root: tmpDir,
      context_lines: 1,
    }) as Record<string, unknown>;
    expect(result.total).toBeGreaterThanOrEqual(1);
    const match = (result.matches as Array<Record<string, unknown>>)[0];
    expect((match.content as string)).toContain("\n");
  });

  // 45
  it("relative root raises", () => {
    expect(() =>
      grepSearch({ pattern: "hello", root: "relative/path" }),
    ).toThrow("absolute");
  });

  // 46
  it("invalid regex raises", () => {
    expect(() =>
      grepSearch({ pattern: "[invalid", root: tmpDir }),
    ).toThrow("Invalid regex");
  });

  // 47
  it("skips .git directory", () => {
    const gitDir = path.join(tmpDir, ".git");
    fs.mkdirSync(gitDir);
    fs.writeFileSync(
      path.join(gitDir, "config"),
      "hello from git\n",
      "utf-8",
    );
    const result = grepSearch({
      pattern: "hello from git",
      root: tmpDir,
    }) as Record<string, unknown>;
    const gitMatches = (
      result.matches as Array<Record<string, unknown>>
    ).filter((m) => (m.path as string).includes(".git"));
    expect(gitMatches.length).toBe(0);
  });
});

// ===========================================================================
// list_directory
// ===========================================================================

describe("listDirectory", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "list-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // (numbering continues from above)

  it("list files and dirs", () => {
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "x", "utf-8");
    fs.mkdirSync(path.join(tmpDir, "subdir"));
    const result = listDirectory({ path: tmpDir }) as Record<string, unknown>;
    const entries = result.entries as Array<Record<string, unknown>>;
    const names = new Set(entries.map((e) => e.name));
    expect(names.has("file.txt")).toBe(true);
    expect(names.has("subdir")).toBe(true);
    const types = Object.fromEntries(
      entries.map((e) => [e.name, e.type]),
    );
    expect(types["file.txt"]).toBe("file");
    expect(types["subdir"]).toBe("directory");
  });

  it("empty directory", () => {
    const result = listDirectory({ path: tmpDir }) as Record<string, unknown>;
    expect(result.entries).toEqual([]);
  });

  it("relative path raises", () => {
    expect(() => listDirectory({ path: "relative/path" })).toThrow(
      "absolute",
    );
  });

  it("missing path raises", () => {
    expect(() =>
      listDirectory({ path: path.join(tmpDir, "nonexistent") }),
    ).toThrow(/not found/i);
  });

  it("file path raises", () => {
    const f = path.join(tmpDir, "afile.txt");
    fs.writeFileSync(f, "x", "utf-8");
    expect(() => listDirectory({ path: f })).toThrow("not a directory");
  });
});
