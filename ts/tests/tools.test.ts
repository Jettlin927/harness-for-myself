import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolDispatcher, registerCodingTools } from "../src/tools.js";
import { RetryableToolError } from "../src/types.js";

// ---------------------------------------------------------------------------
// ToolDispatcher — core execution
// ---------------------------------------------------------------------------

describe("ToolDispatcher", () => {
  let tmpDir: string;
  let dispatcher: ToolDispatcher;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tools-test-"));
    dispatcher = new ToolDispatcher({ allowedWriteRoots: [tmpDir] });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1
  it("echo happy path", () => {
    const result = dispatcher.execute("echo", { text: "hello" });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ echo: "hello" });
  });

  // 2
  it("add happy path", () => {
    const result = dispatcher.execute("add", { a: 2, b: 5 });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ sum: 7 });
  });

  // 3
  it("add boundary values", () => {
    const result = dispatcher.execute("add", { a: 0, b: -1 });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ sum: -1 });
  });

  // 4
  it("unknown tool returns error", () => {
    const result = dispatcher.execute("missing", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });

  // 5
  it("add rejects null arguments", () => {
    const result = dispatcher.execute("add", { a: null, b: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("must be numbers");
  });

  // 6
  it("add rejects non-numeric arguments", () => {
    const result = dispatcher.execute("add", { a: "1", b: 2 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("must be numbers");
  });

  // 7
  it("utc_now returns utc key", () => {
    const result = dispatcher.execute("utc_now", {});
    expect(result.ok).toBe(true);
    expect((result.output as Record<string, unknown>).utc).toBeDefined();
  });

  // 8
  it("write_text_file happy path", () => {
    const outputPath = path.join(tmpDir, "poems", "jingyesi.txt");
    const result = dispatcher.execute("write_text_file", {
      path: outputPath,
      content: "床前明月光",
    });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(outputPath, "utf-8")).toBe("床前明月光");
    expect((result.output as Record<string, unknown>).path).toBe(
      path.resolve(outputPath),
    );
  });

  // 9
  it("write_text_file rejects empty content", () => {
    const outputPath = path.join(tmpDir, "empty.txt");
    const result = dispatcher.execute("write_text_file", {
      path: outputPath,
      content: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("non-empty string 'content'");
  });

  // 10
  it("write_text_file rejects missing path", () => {
    const result = dispatcher.execute("write_text_file", {
      content: "hello",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("non-empty string 'path'");
  });

  // 11
  it("write_text_file rejects outside allowed root", () => {
    const blockedPath = path.join(path.dirname(tmpDir), "blocked.txt");
    const result = dispatcher.execute("write_text_file", {
      path: blockedPath,
      content: "nope",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("outside allowed write roots");
  });

  // 12
  it("write_text_file rejects null arguments", () => {
    const result = dispatcher.execute("write_text_file", {
      path: null,
      content: null,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("non-empty string 'path'");
  });

  // 13 - RetryableToolError
  it("retryable error sets retryable flag", () => {
    dispatcher.registerTool("flaky", () => {
      throw new RetryableToolError("try again");
    });
    const result = dispatcher.execute("flaky", {});
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toContain("try again");
  });

  // 14 - Non-retryable error
  it("non-retryable error sets retryable false", () => {
    dispatcher.registerTool("boom", () => {
      throw new Error("fatal");
    });
    const result = dispatcher.execute("boom", {});
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("fatal");
  });

  // 15 - write_text_file no roots configured
  it("write_text_file disabled when no roots configured", () => {
    const d = new ToolDispatcher();
    const result = d.execute("write_text_file", {
      path: "/tmp/test.txt",
      content: "hello",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no write roots are configured");
  });

  // 16 - write_text_file relative path
  it("write_text_file rejects relative path", () => {
    const result = dispatcher.execute("write_text_file", {
      path: "relative/file.txt",
      content: "hello",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("absolute");
  });
});

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

describe("ToolSchemas", () => {
  let dispatcher: ToolDispatcher;

  beforeEach(() => {
    dispatcher = new ToolDispatcher();
  });

  // 17
  it("register tool with schema", () => {
    const schema = {
      type: "object",
      description: "A test tool",
      properties: { x: { type: "integer" } },
      required: ["x"],
    };
    dispatcher.registerTool("test_tool", (args) => args, schema);
    const schemas = dispatcher.getToolSchemas();
    const found = schemas.find((s) => s.name === "test_tool");
    expect(found).toBeDefined();
    expect(found!.input_schema).toEqual(schema);
  });

  // 18
  it("register tool without schema", () => {
    dispatcher.registerTool("bare", (args) => args);
    const schemas = dispatcher.getToolSchemas();
    const found = schemas.find((s) => s.name === "bare");
    expect(found).toBeUndefined();
  });

  // 19
  it("get_tool_schemas format", () => {
    const schemas = dispatcher.getToolSchemas();
    expect(Array.isArray(schemas)).toBe(true);
    for (const entry of schemas) {
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("description");
      expect(entry).toHaveProperty("input_schema");
    }
  });

  // 20
  it("builtin tools have schemas", () => {
    const expected = new Set(["echo", "add", "utc_now", "write_text_file"]);
    const schemaNames = new Set(
      dispatcher.getToolSchemas().map((s) => s.name),
    );
    for (const name of expected) {
      expect(schemaNames.has(name)).toBe(true);
    }
  });

  // 21
  it("get_tool_schemas returns correct count after registration", () => {
    const initial = dispatcher.getToolSchemas().length;
    dispatcher.registerTool("new_tool", (args) => args, {
      type: "object",
      description: "New",
      properties: {},
    });
    expect(dispatcher.getToolSchemas().length).toBe(initial + 1);
  });

  // 22
  it("register overwrites existing tool", () => {
    dispatcher.registerTool("echo", () => ({ echo: "overridden" }), {
      type: "object",
      description: "Overridden echo",
      properties: {},
    });
    const result = dispatcher.execute("echo", {});
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ echo: "overridden" });
  });

  // 23
  it("registerCodingTools registers expected tools", () => {
    registerCodingTools(dispatcher);
    const names = new Set(dispatcher.getToolSchemas().map((s) => s.name));
    expect(names.has("read_file")).toBe(true);
    expect(names.has("edit_file")).toBe(true);
    expect(names.has("write_file")).toBe(true);
    expect(names.has("bash")).toBe(true);
    expect(names.has("glob_files")).toBe(true);
    expect(names.has("grep_search")).toBe(true);
    expect(names.has("list_directory")).toBe(true);
  });
});
