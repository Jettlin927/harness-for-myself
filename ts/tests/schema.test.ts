import { describe, it, expect } from "vitest";
import { parseLLMAction, ensureDict } from "../src/schema.js";
import { SchemaError } from "../src/types.js";

describe("ensureDict", () => {
  it("returns dict unchanged", () => {
    const obj = { a: 1 };
    expect(ensureDict(obj)).toEqual({ a: 1 });
  });

  it("parses valid JSON string to dict", () => {
    const result = ensureDict('{"a": 1}');
    expect(result).toEqual({ a: 1 });
  });

  it("rejects invalid JSON string", () => {
    expect(() => ensureDict("{bad json}")).toThrow(SchemaError);
    expect(() => ensureDict("{bad json}")).toThrow("not valid JSON");
  });

  it("rejects JSON array", () => {
    expect(() => ensureDict("[]")).toThrow(SchemaError);
    expect(() => ensureDict("[]")).toThrow("must be an object");
  });

  it("rejects null", () => {
    expect(() => ensureDict(null)).toThrow(SchemaError);
    expect(() => ensureDict(null)).toThrow("got: null");
  });

  it("rejects number", () => {
    expect(() => ensureDict(42)).toThrow(SchemaError);
    expect(() => ensureDict(42)).toThrow("got: number");
  });
});

describe("parseLLMAction", () => {
  it("parses tool_call from dict", () => {
    const raw = {
      type: "tool_call",
      tool_name: "read_file",
      arguments: { path: "/tmp/a.py" },
    };
    const action = parseLLMAction(raw);
    expect(action.action_type).toBe("tool_call");
    expect(action.tool_name).toBe("read_file");
    expect(action.arguments).toEqual({ path: "/tmp/a.py" });
    expect(action.content).toBeNull();
    expect(action.raw_output).toBe(raw);
  });

  it("parses final_response from JSON string", () => {
    const raw = JSON.stringify({ type: "final_response", content: "done" });
    const action = parseLLMAction(raw);
    expect(action.action_type).toBe("final_response");
    expect(action.content).toBe("done");
    expect(action.tool_name).toBeNull();
  });

  it("rejects null input", () => {
    expect(() => parseLLMAction(null)).toThrow(SchemaError);
  });

  it("rejects non-object JSON (array)", () => {
    expect(() => parseLLMAction("[]")).toThrow(SchemaError);
  });

  it("rejects empty final_response content", () => {
    expect(() =>
      parseLLMAction({ type: "final_response", content: "" }),
    ).toThrow(SchemaError);
    expect(() =>
      parseLLMAction({ type: "final_response", content: "" }),
    ).toThrow("non-empty string 'content'");
  });

  it("rejects whitespace-only final_response content", () => {
    expect(() =>
      parseLLMAction({ type: "final_response", content: "   " }),
    ).toThrow(SchemaError);
  });

  it("rejects missing tool_name", () => {
    expect(() =>
      parseLLMAction({ type: "tool_call", arguments: {} }),
    ).toThrow(SchemaError);
    expect(() =>
      parseLLMAction({ type: "tool_call", arguments: {} }),
    ).toThrow("non-empty string 'tool_name'");
  });

  it("rejects empty tool_name", () => {
    expect(() =>
      parseLLMAction({ type: "tool_call", tool_name: "", arguments: {} }),
    ).toThrow(SchemaError);
  });

  it("rejects non-dict arguments", () => {
    expect(() =>
      parseLLMAction({ type: "tool_call", tool_name: "echo", arguments: null }),
    ).toThrow(SchemaError);
    expect(() =>
      parseLLMAction({ type: "tool_call", tool_name: "echo", arguments: null }),
    ).toThrow("object 'arguments'");
  });

  it("rejects array arguments", () => {
    expect(() =>
      parseLLMAction({ type: "tool_call", tool_name: "echo", arguments: [] }),
    ).toThrow(SchemaError);
  });

  it("rejects invalid type field", () => {
    expect(() => parseLLMAction({ type: "unknown" })).toThrow(SchemaError);
    expect(() => parseLLMAction({ type: "unknown" })).toThrow(
      "'tool_call' or 'final_response'",
    );
  });

  it("rejects missing type field", () => {
    expect(() => parseLLMAction({ content: "hello" })).toThrow(SchemaError);
  });

  it("rejects invalid JSON string", () => {
    expect(() => parseLLMAction("{not json}")).toThrow(SchemaError);
  });

  it("accepts tool_call with empty arguments dict", () => {
    const action = parseLLMAction({
      type: "tool_call",
      tool_name: "utc_now",
      arguments: {},
    });
    expect(action.action_type).toBe("tool_call");
    expect(action.tool_name).toBe("utc_now");
    expect(action.arguments).toEqual({});
  });

  it("preserves raw_output for logging", () => {
    const raw = { type: "final_response", content: "answer" };
    const action = parseLLMAction(raw);
    expect(action.raw_output).toBe(raw);
  });
});
