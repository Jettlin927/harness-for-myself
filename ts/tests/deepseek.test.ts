import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BaseLLM,
  ScriptedLLM,
  RuleBasedLLM,
  DeepSeekLLM,
  buildSystemPrompt,
} from "../src/llm.js";
import type { ToolSchema } from "../src/types.js";

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------
describe("buildSystemPrompt", () => {
  it("includes tool names in the prompt", () => {
    const prompt = buildSystemPrompt(["read_file", "bash"]);
    expect(prompt).toContain("read_file, bash");
  });

  it("shows (none) when tool list is empty", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain("(none)");
  });

  it("includes JSON format instructions when nativeToolUse is false", () => {
    const prompt = buildSystemPrompt(["echo"], { nativeToolUse: false });
    expect(prompt).toContain("tool_call");
    expect(prompt).toContain("final_response");
    expect(prompt).toContain("JSON");
  });

  it("omits JSON format instructions when nativeToolUse is true", () => {
    const prompt = buildSystemPrompt(["echo"], { nativeToolUse: true });
    expect(prompt).not.toContain("Return exactly one JSON");
    expect(prompt).toContain("Use the provided tools");
  });

  it("includes memory section when save_memory and recall_memory present", () => {
    const prompt = buildSystemPrompt(["save_memory", "recall_memory"]);
    expect(prompt).toContain("## Memory");
    expect(prompt).toContain("persistent memory");
  });

  it("includes sub-agent section when spawn_agent present", () => {
    const prompt = buildSystemPrompt(["spawn_agent"]);
    expect(prompt).toContain("## Sub-Agents");
  });

  it("includes skill section when use_skill present", () => {
    const prompt = buildSystemPrompt(["use_skill"]);
    expect(prompt).toContain("## Skills");
  });

  it("appends extra system instructions when provided", () => {
    const prompt = buildSystemPrompt(["echo"], {
      extraSystemInstructions: "Always respond in Japanese.",
    });
    expect(prompt).toContain("## Additional Instructions");
    expect(prompt).toContain("Always respond in Japanese.");
  });
});

// ---------------------------------------------------------------------------
// ScriptedLLM
// ---------------------------------------------------------------------------
describe("ScriptedLLM", () => {
  it("returns script items in order", async () => {
    const llm = new ScriptedLLM([
      { type: "tool_call", tool_name: "echo", arguments: { text: "hi" } },
      { type: "final_response", content: "done" },
    ]);
    const r1 = await llm.generate({});
    expect(r1).toEqual({ type: "tool_call", tool_name: "echo", arguments: { text: "hi" } });
    const r2 = await llm.generate({});
    expect(r2).toEqual({ type: "final_response", content: "done" });
  });

  it("returns fallback when script is exhausted", async () => {
    const llm = new ScriptedLLM([]);
    const result = await llm.generate({});
    expect(result.type).toBe("final_response");
    expect(result.content).toContain("Script exhausted");
  });
});

// ---------------------------------------------------------------------------
// RuleBasedLLM
// ---------------------------------------------------------------------------
describe("RuleBasedLLM", () => {
  it("handles add goal — first call returns tool_call", async () => {
    const llm = new RuleBasedLLM();
    const result = await llm.generate({ goal: "Please add numbers", history: [] });
    expect(result.type).toBe("tool_call");
    expect(result.tool_name).toBe("add");
  });

  it("handles add goal — second call returns final_response", async () => {
    const llm = new RuleBasedLLM();
    const result = await llm.generate({
      goal: "add numbers",
      history: [{ observation: "5" }],
    });
    expect(result.type).toBe("final_response");
    expect(result.content).toContain("5");
  });

  it("handles time goal", async () => {
    const llm = new RuleBasedLLM();
    const r1 = await llm.generate({ goal: "what time is it", history: [] });
    expect(r1.tool_name).toBe("utc_now");
    const r2 = await llm.generate({
      goal: "what time is it",
      history: [{ observation: "2024-01-01T00:00:00Z" }],
    });
    expect(r2.type).toBe("final_response");
  });

  it("returns direct answer for unknown goals", async () => {
    const llm = new RuleBasedLLM();
    const result = await llm.generate({ goal: "hello world", history: [] });
    expect(result.type).toBe("final_response");
  });
});

// ---------------------------------------------------------------------------
// DeepSeekLLM
// ---------------------------------------------------------------------------
describe("DeepSeekLLM", () => {
  // Helper to create a fake transport that returns a given content string
  function fakeTransport(content: string) {
    return async (
      _url: string,
      _options: RequestInit,
    ): Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }> => ({
      status: 200,
      ok: true,
      json: async () => ({
        choices: [{ message: { content } }],
      }),
    });
  }

  it("happy path returns final_response", async () => {
    const captured: Record<string, unknown> = {};
    const transport = async (url: string, options: RequestInit) => {
      captured.url = url;
      captured.headers = options.headers;
      const body = JSON.parse(options.body as string);
      captured.model = body.model;
      return {
        status: 200,
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"type":"final_response","content":"done"}' } }],
        }),
      };
    };

    const llm = new DeepSeekLLM({ apiKey: "secret", transport });
    const result = await llm.generate({
      goal: "finish task",
      context: { user: "jett" },
      summary_memory: "constraint: stay safe",
      history: [{ turn: 1, observation: "tool ok" }],
    });

    expect(result.type).toBe("final_response");
    expect(result.content).toBe("done");
    expect(captured.url).toBe("https://api.deepseek.com/chat/completions");
    expect(captured.model).toBe("deepseek-chat");
  });

  it("uses environment variable when available", async () => {
    const originalKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "env-secret";
    try {
      let capturedAuth = "";
      const transport = async (url: string, options: RequestInit) => {
        const headers = options.headers as Record<string, string>;
        capturedAuth = headers["Authorization"];
        return {
          status: 200,
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"type":"final_response","content":"env ok"}' } }],
          }),
        };
      };

      const llm = new DeepSeekLLM({ transport });
      const result = await llm.generate({ goal: "demo", context: {}, summary_memory: "", history: [] });
      expect(result.content).toBe("env ok");
      expect(capturedAuth).toBe("Bearer env-secret");
    } finally {
      if (originalKey !== undefined) {
        process.env.DEEPSEEK_API_KEY = originalKey;
      } else {
        delete process.env.DEEPSEEK_API_KEY;
      }
    }
  });

  it("uses .env file when available", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hau-test-"));
    const envPath = path.join(tmpDir, ".env");
    fs.writeFileSync(envPath, "DEEPSEEK_API_KEY=dotenv-secret\n");

    const originalKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const llm = new DeepSeekLLM({
        envPath,
        transport: fakeTransport('{"type":"final_response","content":"dotenv ok"}'),
      });
      const result = await llm.generate({ goal: "demo", context: {}, summary_memory: "", history: [] });
      expect(result.content).toBe("dotenv ok");
    } finally {
      if (originalKey !== undefined) {
        process.env.DEEPSEEK_API_KEY = originalKey;
      } else {
        delete process.env.DEEPSEEK_API_KEY;
      }
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("rejects empty choices list", async () => {
    const llm = new DeepSeekLLM({
      apiKey: "secret",
      transport: async () => ({
        status: 200,
        ok: true,
        json: async () => ({ choices: [] }),
      }),
    });
    await expect(
      llm.generate({ goal: "demo", context: {}, summary_memory: "", history: [] }),
    ).rejects.toThrow("choices");
  });

  it("wraps plain text response as final_response", async () => {
    const llm = new DeepSeekLLM({
      apiKey: "secret",
      transport: fakeTransport("plain answer"),
    });
    const result = await llm.generate({ goal: "demo", context: {}, summary_memory: "", history: [] });
    expect(result.type).toBe("final_response");
    expect(result.content).toBe("plain answer");
  });

  it("setToolSchemas updates tool names", () => {
    const llm = new DeepSeekLLM({ apiKey: "test" });
    llm.setToolSchemas([
      { name: "read_file", description: "...", input_schema: {} },
      { name: "bash", description: "...", input_schema: {} },
    ]);
    expect((llm as any)._toolNames).toEqual(["read_file", "bash"]);
  });

  it("build messages uses dynamic tool names", async () => {
    let capturedBody: any = null;
    const transport = async (_url: string, options: RequestInit) => {
      capturedBody = JSON.parse(options.body as string);
      return {
        status: 200,
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"type":"final_response","content":"ok"}' } }],
        }),
      };
    };

    const llm = new DeepSeekLLM({ apiKey: "test", transport });
    llm.setToolSchemas([
      { name: "read_file", description: "...", input_schema: {} },
      { name: "bash", description: "...", input_schema: {} },
    ]);
    await llm.generate({ goal: "demo", context: {}, summary_memory: "", history: [] });

    const systemContent = capturedBody.messages[0].content;
    expect(systemContent).toContain("read_file");
    expect(systemContent).toContain("bash");
    expect(systemContent).not.toContain("echo");
  });

  it("retries on transient HTTP 500 error", async () => {
    let callCount = 0;
    const transport = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          status: 500,
          ok: false,
          json: async () => ({ error: "internal error" }),
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"type":"final_response","content":"ok"}' } }],
        }),
      };
    };

    const llm = new DeepSeekLLM({ apiKey: "secret", transport });
    // Mock setTimeout to avoid waiting
    vi.useFakeTimers();
    const promise = llm.generate({ goal: "test", context: {}, summary_memory: "", history: [] });
    // Advance timers for retry delay
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.type).toBe("final_response");
    expect(result.content).toBe("ok");
    expect(callCount).toBe(2);
  });

  it("does not retry on permanent HTTP 400 error", async () => {
    const transport = async () => ({
      status: 400,
      ok: false,
      json: async () => ({ error: "bad request" }),
    });

    const llm = new DeepSeekLLM({ apiKey: "secret", transport });
    await expect(
      llm.generate({ goal: "test", context: {}, summary_memory: "", history: [] }),
    ).rejects.toThrow("HTTP 400");
  });

  it("retries on HTTP 429 rate limit error", async () => {
    let callCount = 0;
    const transport = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          status: 429,
          ok: false,
          json: async () => ({ error: "rate limited" }),
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"type":"final_response","content":"ok"}' } }],
        }),
      };
    };

    const llm = new DeepSeekLLM({ apiKey: "secret", transport });
    vi.useFakeTimers();
    const promise = llm.generate({ goal: "test", context: {}, summary_memory: "", history: [] });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.type).toBe("final_response");
    expect(callCount).toBe(2);
  });

  it("rejects empty content from response", async () => {
    const llm = new DeepSeekLLM({
      apiKey: "secret",
      transport: async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "" } }],
        }),
      }),
    });
    await expect(
      llm.generate({ goal: "demo", context: {}, summary_memory: "", history: [] }),
    ).rejects.toThrow("empty");
  });

  it("uses custom base URL", async () => {
    let capturedUrl = "";
    const transport = async (url: string) => {
      capturedUrl = url;
      return {
        status: 200,
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"type":"final_response","content":"ok"}' } }],
        }),
      };
    };

    const llm = new DeepSeekLLM({
      apiKey: "secret",
      baseUrl: "https://custom.api.com/v1/",
      transport,
    });
    await llm.generate({ goal: "demo", context: {}, summary_memory: "", history: [] });
    expect(capturedUrl).toBe("https://custom.api.com/v1/chat/completions");
  });
});
