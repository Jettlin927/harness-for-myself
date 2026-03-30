import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicLLM, buildSystemPrompt, isRetryable } from "../src/anthropic-llm.js";
import type { ToolSchema } from "../src/types.js";

// --- Fake response helpers ---

class FakeTextBlock {
  type = "text" as const;
  constructor(public text: string) {}
}

class FakeToolUseBlock {
  type = "tool_use" as const;
  constructor(
    public name: string,
    public input: Record<string, unknown>,
  ) {}
}

class FakeUsage {
  constructor(
    public input_tokens: number,
    public output_tokens: number,
  ) {}
}

class FakeResponse {
  constructor(
    public content: Array<FakeTextBlock | FakeToolUseBlock>,
    public usage: FakeUsage | null = null,
  ) {}
}

function createMockClient(response?: FakeResponse) {
  const defaultResponse = response ?? new FakeResponse([new FakeTextBlock("hi")]);
  return {
    messages: {
      create: vi.fn().mockResolvedValue(defaultResponse),
      stream: vi.fn(),
    },
  };
}

function createStreamMock(
  events: Array<{ type: string; delta?: { text?: string } }>,
  finalMessage: FakeResponse,
) {
  const stream = {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    },
    finalMessage: vi.fn().mockResolvedValue(finalMessage),
  };
  return stream;
}

// --- Tests ---

describe("AnthropicLLM — tool_use response parsing", () => {
  it("parses tool_use response", async () => {
    const mockClient = createMockClient(
      new FakeResponse([new FakeToolUseBlock("read_file", { path: "/tmp/test.py" })]),
    );
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;

    const result = await llm.generate({ goal: "read a file", history: [] });
    expect(result.type).toBe("tool_call");
    expect(result.tool_name).toBe("read_file");
    expect(result.arguments).toEqual({ path: "/tmp/test.py" });
  });

  it("parses text response as final_response", async () => {
    const mockClient = createMockClient(
      new FakeResponse([new FakeTextBlock("The answer is 42.")]),
    );
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;

    const result = await llm.generate({ goal: "answer", history: [] });
    expect(result.type).toBe("final_response");
    expect(result.content).toBe("The answer is 42.");
  });

  it("mixed text and tool_use prefers tool_use", async () => {
    const mockClient = createMockClient(
      new FakeResponse([
        new FakeTextBlock("Let me run that."),
        new FakeToolUseBlock("bash", { command: "ls" }),
      ]),
    );
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;

    const result = await llm.generate({ goal: "list files", history: [] });
    expect(result.type).toBe("tool_call");
    expect(result.tool_name).toBe("bash");
  });

  it("passes tool_schemas to API call", async () => {
    const schemas: ToolSchema[] = [
      {
        name: "echo",
        description: "Echo text",
        input_schema: { type: "object", properties: {} },
      },
    ];
    const mockClient = createMockClient(new FakeResponse([new FakeTextBlock("done")]));
    const llm = new AnthropicLLM({ apiKey: "test-key", toolSchemas: schemas });
    (llm as any)._client = mockClient;

    await llm.generate({ goal: "echo", history: [] });
    const callArgs = mockClient.messages.create.mock.calls[0][0];
    // Last tool gets cache_control marker
    expect(callArgs.tools).toEqual([
      { ...schemas[0], cache_control: { type: "ephemeral" } },
    ]);
  });

  it("omits tools kwarg when no schemas", async () => {
    const mockClient = createMockClient(new FakeResponse([new FakeTextBlock("hi")]));
    const llm = new AnthropicLLM({ apiKey: "test-key", toolSchemas: [] });
    (llm as any)._client = mockClient;

    await llm.generate({ goal: "greet", history: [] });
    const callArgs = mockClient.messages.create.mock.calls[0][0];
    expect(callArgs.tools).toBeUndefined();
  });
});

describe("AnthropicLLM — streaming", () => {
  it("uses stream path when onToken is set", async () => {
    const finalMsg = new FakeResponse([new FakeTextBlock("Hello world")]);
    const streamObj = createStreamMock(
      [{ type: "content_block_delta", delta: { text: "Hello" } }],
      finalMsg,
    );
    const mockClient = createMockClient();
    mockClient.messages.stream.mockReturnValue(streamObj);

    const tokens: string[] = [];
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;
    llm.onToken = (t: string) => tokens.push(t);

    const result = await llm.generate({ goal: "greet", history: [] });

    expect(mockClient.messages.stream).toHaveBeenCalledOnce();
    expect(mockClient.messages.create).not.toHaveBeenCalled();
    expect(tokens).toEqual(["Hello"]);
    expect(result.type).toBe("final_response");
    expect(result.content).toBe("Hello world");
  });

  it("uses create when onToken is not set", async () => {
    const mockClient = createMockClient(new FakeResponse([new FakeTextBlock("hi")]));
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;

    const result = await llm.generate({ goal: "greet", history: [] });

    expect(mockClient.messages.create).toHaveBeenCalledOnce();
    expect(mockClient.messages.stream).not.toHaveBeenCalled();
    expect(result.type).toBe("final_response");
  });

  it("streaming tool_use emits no text tokens", async () => {
    const finalMsg = new FakeResponse([new FakeToolUseBlock("bash", { command: "ls" })]);
    const streamObj = createStreamMock(
      [{ type: "content_block_start" }], // no text delta
      finalMsg,
    );
    const mockClient = createMockClient();
    mockClient.messages.stream.mockReturnValue(streamObj);

    const tokens: string[] = [];
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;
    llm.onToken = (t: string) => tokens.push(t);

    const result = await llm.generate({ goal: "list", history: [] });

    expect(tokens).toEqual([]);
    expect(result.type).toBe("tool_call");
    expect(result.tool_name).toBe("bash");
  });
});

describe("AnthropicLLM — setToolSchemas", () => {
  it("updates schemas used in generate calls", async () => {
    const mockClient = createMockClient(new FakeResponse([new FakeTextBlock("done")]));
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;

    expect(llm.toolSchemas).toEqual([]);

    const newSchemas: ToolSchema[] = [
      {
        name: "read_file",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: { type: "string" } } },
      },
    ];
    llm.setToolSchemas(newSchemas);
    await llm.generate({ goal: "test", history: [] });

    const callArgs = mockClient.messages.create.mock.calls[0][0];
    expect(callArgs.tools).toEqual([
      { ...newSchemas[0], cache_control: { type: "ephemeral" } },
    ]);
  });
});

describe("AnthropicLLM — usage in response", () => {
  it("returns _usage when present", async () => {
    const mockClient = createMockClient(
      new FakeResponse([new FakeTextBlock("hello")], new FakeUsage(100, 50)),
    );
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;

    const result = await llm.generate({ goal: "test", history: [] });
    expect(result._usage).toBeDefined();
    expect(result._usage!.input_tokens).toBe(100);
    expect(result._usage!.output_tokens).toBe(50);
    expect(result._usage!.total_tokens).toBe(150);
  });

  it("omits _usage when absent", async () => {
    const mockClient = createMockClient(new FakeResponse([new FakeTextBlock("hello")], null));
    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;

    const result = await llm.generate({ goal: "test", history: [] });
    expect(result._usage).toBeUndefined();
  });

  it("streaming returns usage", async () => {
    const finalMsg = new FakeResponse(
      [new FakeTextBlock("streamed")],
      new FakeUsage(200, 80),
    );
    const streamObj = createStreamMock([], finalMsg);
    const mockClient = createMockClient();
    mockClient.messages.stream.mockReturnValue(streamObj);

    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;
    llm.onToken = () => {};

    const result = await llm.generate({ goal: "test", history: [] });
    expect(result._usage).toBeDefined();
    expect(result._usage!.total_tokens).toBe(280);
  });
});

describe("AnthropicLLM — _buildMessages", () => {
  it("empty history produces single user message", () => {
    const wm = { goal: "do something", context: {}, summary_memory: "", history: [] };
    const msgs = AnthropicLLM._buildMessages(wm);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    // First message content is now a block array with cache_control
    const text = (msgs[0].content as any[])[0].text;
    expect(text).toContain("Goal: do something");
  });

  it("includes summary in first message", () => {
    const wm = {
      goal: "test",
      context: { file: "a.py" },
      summary_memory: "Previously read file a.py",
      history: [],
    };
    const msgs = AnthropicLLM._buildMessages(wm);
    const text = (msgs[0].content as any[])[0].text;
    expect(text).toContain("Summary: Previously read file a.py");
    expect(text).toContain("Context:");
  });

  it("tool_call history produces tool_use and tool_result blocks", () => {
    const wm = {
      goal: "read file",
      context: {},
      summary_memory: "",
      history: [
        {
          turn: 1,
          action: {
            action_type: "tool_call",
            tool_name: "read_file",
            arguments: { path: "/tmp/test.py" },
          },
          observation: "tool=read_file; ok=True; output=content",
          tool_result: { ok: true, output: "content", error: null },
        },
      ],
    };
    const msgs = AnthropicLLM._buildMessages(wm);

    // First msg: user with goal
    expect(msgs[0].role).toBe("user");
    // Second msg: assistant with native tool_use block
    expect(msgs[1].role).toBe("assistant");
    expect(Array.isArray(msgs[1].content)).toBe(true);
    const toolBlock = (msgs[1].content as any[])[1];
    expect(toolBlock.type).toBe("tool_use");
    expect(toolBlock.name).toBe("read_file");
    expect(toolBlock.id).toBe("toolu_history_1");
    // Third msg: user with native tool_result block
    expect(msgs[2].role).toBe("user");
    expect(Array.isArray(msgs[2].content)).toBe(true);
    expect((msgs[2].content as any[])[0].type).toBe("tool_result");
    expect((msgs[2].content as any[])[0].tool_use_id).toBe("toolu_history_1");
    // Verify alternating roles
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].role).not.toBe(msgs[i - 1].role);
    }
  });

  it("final_response history", () => {
    const wm = {
      goal: "test",
      context: {},
      summary_memory: "",
      history: [
        {
          turn: 1,
          action: { action_type: "final_response", content: "I finished." },
          observation: "",
          tool_result: null,
        },
      ],
    };
    const msgs = AnthropicLLM._buildMessages(wm);
    // user, assistant (final_response), user (continuation)
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].content).toBe("[Step 1] I finished.");
    expect(msgs[2].role).toBe("user");
    expect(msgs[2].content).toContain("Continue");
  });

  it("schema_feedback appended to last user message", () => {
    const wm = {
      goal: "test",
      context: {},
      summary_memory: "",
      history: [
        {
          turn: 1,
          action: { action_type: "final_response", content: "done" },
          observation: "",
          tool_result: null,
        },
      ],
      schema_feedback: "Your output was invalid JSON",
    };
    const msgs = AnthropicLLM._buildMessages(wm);
    const lastMsg = msgs[msgs.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toContain("Your output was invalid JSON");
  });

  it("consecutive final_responses alternate roles (Bug A)", () => {
    const wm = {
      goal: "test goal",
      context: {},
      summary_memory: "",
      history: [
        {
          turn: 1,
          action: { action_type: "final_response", content: "First response" },
          observation: "First response",
          tool_result: null,
        },
        {
          turn: 2,
          action: { action_type: "final_response", content: "Second response" },
          observation: "Second response",
          tool_result: null,
        },
      ],
    };
    const msgs = AnthropicLLM._buildMessages(wm);
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].role).not.toBe(msgs[i - 1].role);
    }
  });

  it("empty history with schema_feedback merges into single user msg (Bug B)", () => {
    const wm = {
      goal: "test goal",
      context: {},
      summary_memory: "",
      history: [],
      schema_feedback: {
        last_error: "Invalid output format",
        required_types: ["tool_call", "final_response"],
      },
    };
    const msgs = AnthropicLLM._buildMessages(wm);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    const text = (msgs[0].content as any[])[0].text;
    expect(text).toContain("Schema feedback");
    expect(text).toContain("Invalid output format");
  });

  it("tool_result uses structured JSON data (Bug C)", () => {
    const wm = {
      goal: "read file",
      context: {},
      summary_memory: "",
      history: [
        {
          turn: 1,
          action: {
            action_type: "tool_call",
            tool_name: "read_file",
            arguments: { path: "/tmp/test.py" },
          },
          observation: "tool=read_file; ok=True; output={'content': 'hello'}; error=None",
          tool_result: {
            ok: true,
            output: { content: "hello" },
            error: null,
            retryable: false,
            blocked: false,
            attempts: 1,
          },
        },
      ],
    };
    const msgs = AnthropicLLM._buildMessages(wm);
    // Find the user message with tool_result block (skip first msg which has cache_control text blocks)
    const toolResultMsgs = msgs.filter(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as any[]).some((b: any) => b.type === "tool_result"),
    );
    expect(toolResultMsgs.length).toBeGreaterThan(0);
    const block = (toolResultMsgs[0].content as any[]).find((b: any) => b.type === "tool_result");
    expect(block.type).toBe("tool_result");
    const content = block.content as string;
    // Should be valid JSON
    const parsed = JSON.parse(content);
    expect(parsed.ok).toBe(true);
    expect(parsed.output.content).toBe("hello");
  });
});

describe("AnthropicLLM — turn number injection", () => {
  it("tool_call has [Step N] prefix", () => {
    const wm = {
      goal: "test",
      context: {},
      summary_memory: "",
      history: [
        {
          turn: 3,
          action: {
            action_type: "tool_call",
            tool_name: "read_file",
            arguments: { path: "/tmp/a.py" },
          },
          observation: "ok",
          tool_result: { ok: true, output: "content", error: null },
        },
      ],
    };
    const msgs = AnthropicLLM._buildMessages(wm);
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThan(0);
    const content = assistantMsgs[0].content as any[];
    expect(Array.isArray(content)).toBe(true);
    const textBlock = content[0];
    expect(textBlock.type).toBe("text");
    expect(textBlock.text).toBe("[Step 3]");
  });

  it("final_response has [Step N] prefix", () => {
    const wm = {
      goal: "test",
      context: {},
      summary_memory: "",
      history: [
        {
          turn: 5,
          action: { action_type: "final_response", content: "All done." },
          observation: "",
          tool_result: null,
        },
      ],
    };
    const msgs = AnthropicLLM._buildMessages(wm);
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThan(0);
    expect((assistantMsgs[0].content as string).startsWith("[Step 5]")).toBe(true);
  });
});

describe("AnthropicLLM — network error retry", () => {
  it("retries on connection error and succeeds", async () => {
    const connError = new Error("connection lost");
    Object.defineProperty(connError.constructor, "name", { value: "APIConnectionError" });
    // Use a named class so constructor.name works
    class APIConnectionError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "APIConnectionError";
      }
    }
    const err = new APIConnectionError("connection lost");

    const mockClient = createMockClient();
    mockClient.messages.create
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(new FakeResponse([new FakeTextBlock("recovered")]));

    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;

    const result = await llm.generate({ goal: "test", history: [] });
    expect(result.type).toBe("final_response");
    expect(result.content).toBe("recovered");
    expect(mockClient.messages.create).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors (401)", async () => {
    class APIStatusError extends Error {
      status_code = 401;
      constructor(msg: string) {
        super(msg);
        this.name = "APIStatusError";
      }
    }
    const err = new APIStatusError("unauthorized");

    const mockClient = createMockClient();
    mockClient.messages.create.mockRejectedValue(err);

    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;

    await expect(llm.generate({ goal: "test", history: [] })).rejects.toThrow("unauthorized");
    expect(mockClient.messages.create).toHaveBeenCalledTimes(1);
  });

  it("retries on RateLimitError", async () => {
    class RateLimitError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "RateLimitError";
      }
    }
    const err = new RateLimitError("too many requests");

    const mockClient = createMockClient();
    mockClient.messages.create
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(new FakeResponse([new FakeTextBlock("ok")]));

    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;

    const result = await llm.generate({ goal: "test", history: [] });
    expect(result.type).toBe("final_response");
    expect(result.content).toBe("ok");
  });

  it("retries on 500 server error", async () => {
    class APIStatusError extends Error {
      status_code = 500;
      constructor(msg: string) {
        super(msg);
        this.name = "APIStatusError";
      }
    }
    const err = new APIStatusError("internal server error");

    const mockClient = createMockClient();
    mockClient.messages.create
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(new FakeResponse([new FakeTextBlock("recovered")]));

    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;

    const result = await llm.generate({ goal: "test", history: [] });
    expect(result.type).toBe("final_response");
    expect(result.content).toBe("recovered");
  });

  it("retries on APITimeoutError", async () => {
    class APITimeoutError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = "APITimeoutError";
      }
    }
    const err = new APITimeoutError("timeout");

    const mockClient = createMockClient();
    mockClient.messages.create
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(new FakeResponse([new FakeTextBlock("done")]));

    const llm = new AnthropicLLM({ apiKey: "test-key" });
    (llm as any)._client = mockClient;

    const result = await llm.generate({ goal: "test", history: [] });
    expect(result.type).toBe("final_response");
  });
});

describe("AnthropicLLM — API key resolution", () => {
  it("uses explicit apiKey", () => {
    const llm = new AnthropicLLM({ apiKey: "explicit-key" });
    expect(llm.apiKey).toBe("explicit-key");
  });

  it("falls back to ANTHROPIC_API_KEY env var", () => {
    const orig = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.ANTHROPIC_API_KEY = "env-key";
      const llm = new AnthropicLLM({});
      expect(llm.apiKey).toBe("env-key");
    } finally {
      if (orig !== undefined) {
        process.env.ANTHROPIC_API_KEY = orig;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("throws when no key found", () => {
    const orig = process.env.ANTHROPIC_API_KEY;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      expect(() => new AnthropicLLM({})).toThrow("API key not found");
    } finally {
      if (orig !== undefined) {
        process.env.ANTHROPIC_API_KEY = orig;
      }
    }
  });
});

describe("AnthropicLLM — _parseResponse edge cases", () => {
  it("throws on empty content blocks", () => {
    const response = new FakeResponse([]);
    expect(() => AnthropicLLM._parseResponse(response)).toThrow("no usable content");
  });
});

describe("isRetryable", () => {
  it("APIConnectionError is retryable", () => {
    class APIConnectionError extends Error {
      constructor() {
        super("conn");
        this.name = "APIConnectionError";
      }
    }
    expect(isRetryable(new APIConnectionError())).toBe(true);
  });

  it("APITimeoutError is retryable", () => {
    class APITimeoutError extends Error {
      constructor() {
        super("timeout");
        this.name = "APITimeoutError";
      }
    }
    expect(isRetryable(new APITimeoutError())).toBe(true);
  });

  it("RateLimitError is retryable", () => {
    class RateLimitError extends Error {
      constructor() {
        super("rate");
        this.name = "RateLimitError";
      }
    }
    expect(isRetryable(new RateLimitError())).toBe(true);
  });

  it("APIStatusError with 500 is retryable", () => {
    class APIStatusError extends Error {
      status_code = 500;
      constructor() {
        super("server");
        this.name = "APIStatusError";
      }
    }
    expect(isRetryable(new APIStatusError())).toBe(true);
  });

  it("APIStatusError with 401 is NOT retryable", () => {
    class APIStatusError extends Error {
      status_code = 401;
      constructor() {
        super("auth");
        this.name = "APIStatusError";
      }
    }
    expect(isRetryable(new APIStatusError())).toBe(false);
  });

  it("generic Error is NOT retryable", () => {
    expect(isRetryable(new Error("something"))).toBe(false);
  });
});

describe("buildSystemPrompt", () => {
  it("includes tool names", () => {
    const prompt = buildSystemPrompt(["read_file", "bash"]);
    expect(prompt).toContain("read_file");
    expect(prompt).toContain("bash");
  });

  it("native tool use omits JSON format instructions", () => {
    const prompt = buildSystemPrompt(["echo"], { nativeToolUse: true });
    expect(prompt).not.toContain("Return exactly one JSON object");
    expect(prompt).toContain("Use the provided tools");
  });

  it("non-native includes JSON format instructions", () => {
    const prompt = buildSystemPrompt(["echo"], { nativeToolUse: false });
    expect(prompt).toContain("Return exactly one JSON object");
  });

  it("includes extra instructions when provided", () => {
    const prompt = buildSystemPrompt(["echo"], {
      extraSystemInstructions: "Always be concise.",
    });
    expect(prompt).toContain("Always be concise.");
  });
});
