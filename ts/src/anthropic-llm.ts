/**
 * AnthropicLLM — Anthropic Messages API adapter with native tool_use support.
 */

import type { ToolSchema } from "./types.js";
import { BaseLLM, buildSystemPrompt } from "./llm.js";
import * as fs from "node:fs";
import * as path from "node:path";

// Re-export buildSystemPrompt for backward compatibility with tests
export { buildSystemPrompt };

// --- Retry helper ---

export function isRetryable(err: Error): boolean {
  const name = err.name;
  if (name === "APIConnectionError" || name === "APITimeoutError") return true;
  if (name === "RateLimitError") return true;
  if (name === "APIStatusError" && "status_code" in err) {
    return (err as any).status_code >= 500;
  }
  return false;
}

// --- Message type ---

interface Message {
  role: "user" | "assistant";
  content: string | any[];
}

// --- AnthropicLLM ---

export class AnthropicLLM extends BaseLLM {
  apiKey: string;
  model: string;
  toolSchemas: ToolSchema[];
  extraInstructions: string;
  declare onToken?: (token: string) => void;
  private _client: any;

  constructor(options?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    toolSchemas?: ToolSchema[];
  }) {
    super();
    this.model = options?.model ?? "claude-sonnet-4-20250514";
    this.toolSchemas = options?.toolSchemas ?? [];
    this.extraInstructions = "";
    this.apiKey = AnthropicLLM._resolveApiKey(options?.apiKey);

    // Dynamically import Anthropic SDK
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Anthropic = require("@anthropic-ai/sdk").default;
      const clientOpts: Record<string, unknown> = { apiKey: this.apiKey };
      if (options?.baseUrl) {
        clientOpts.baseURL = options.baseUrl;
      }
      this._client = new Anthropic(clientOpts);
    } catch {
      throw new Error(
        "The '@anthropic-ai/sdk' package is required. Install it with: npm install @anthropic-ai/sdk",
      );
    }
  }

  setToolSchemas(schemas: ToolSchema[]): void {
    this.toolSchemas = schemas;
  }

  async generate(workingMemory: Record<string, unknown>): Promise<Record<string, unknown>> {
    const toolNames = this.toolSchemas.map((s) => s.name);
    const systemPrompt = buildSystemPrompt(toolNames, {
      nativeToolUse: true,
      extraSystemInstructions: this.extraInstructions,
    });
    const messages = AnthropicLLM._buildMessages(workingMemory);

    const kwargs: Record<string, unknown> = {
      model: this.model,
      system: systemPrompt,
      messages,
      max_tokens: 4096,
    };
    if (this.toolSchemas.length > 0) {
      kwargs.tools = this.toolSchemas;
    }

    if (this.onToken) {
      return this._callWithRetry(() => this._generateStreaming(kwargs));
    }

    return this._callWithRetry(async () => {
      const response = await this._client.messages.create(kwargs);
      return AnthropicLLM._parseResponse(response);
    });
  }

  private async _callWithRetry(fn: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        if (isRetryable(err) && attempt < maxRetries) {
          const wait = 2 ** attempt;
          process.stderr.write(
            `\x1b[2m⟳ API 请求失败，${wait}s 后重试... (${err})\x1b[0m\n`,
          );
          await new Promise((resolve) => setTimeout(resolve, wait * 1000));
          continue;
        }
        throw new Error(`LLM API call failed: ${err.message ?? err}`, { cause: err });
      }
    }
    // unreachable
    throw new Error("Unexpected retry loop exit");
  }

  private async _generateStreaming(kwargs: Record<string, unknown>): Promise<Record<string, unknown>> {
    const stream = this._client.messages.stream(kwargs);
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta?.text &&
        this.onToken
      ) {
        this.onToken(event.delta.text);
      }
    }
    const finalMessage = await stream.finalMessage();
    return AnthropicLLM._parseResponse(finalMessage);
  }

  static _buildMessages(workingMemory: Record<string, unknown>): Message[] {
    const history = (workingMemory.history ?? []) as Array<Record<string, any>>;
    const schemaFeedback = workingMemory.schema_feedback;

    // Build the initial user message with goal + context + summary
    const firstParts: string[] = [];
    if (workingMemory.goal) {
      firstParts.push(`Goal: ${workingMemory.goal}`);
    }
    if (workingMemory.context) {
      firstParts.push(`Context: ${JSON.stringify(workingMemory.context)}`);
    }
    if (workingMemory.summary_memory) {
      firstParts.push(`Summary: ${workingMemory.summary_memory}`);
    }

    // Bug B fix: merge schema_feedback into initial message when history is empty
    if (history.length === 0 && schemaFeedback) {
      firstParts.push(`Schema feedback: ${JSON.stringify(schemaFeedback)}`);
    }

    const firstMsg =
      firstParts.length > 0
        ? firstParts.join("\n")
        : JSON.stringify(workingMemory, null, 2);

    const messages: Message[] = [{ role: "user", content: firstMsg }];

    for (const turn of history) {
      const action = turn.action ?? {};
      const actionType = action.action_type;
      const turnNum = turn.turn ?? 0;

      if (actionType === "tool_call") {
        const toolUseId = `toolu_history_${turnNum}`;
        // Native Anthropic tool_use block in assistant message
        const assistantContent = [
          { type: "text", text: `[Step ${turnNum}]` },
          {
            type: "tool_use",
            id: toolUseId,
            name: action.tool_name ?? "unknown",
            input: action.arguments ?? {},
          },
        ];
        messages.push({ role: "assistant", content: assistantContent });

        // Native tool_result block in user message
        // Bug C fix: use structured JSON for tool result content
        const toolResultData = turn.tool_result;
        let resultContent: string;
        if (toolResultData && typeof toolResultData === "object") {
          resultContent = JSON.stringify(toolResultData);
        } else {
          resultContent = String(turn.observation ?? "");
        }

        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              content: resultContent,
            },
          ],
        });
      } else if (actionType === "final_response") {
        // Bug A fix: insert bridging user message if last message is also assistant
        if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
          messages.push({ role: "user", content: "Acknowledged. Continue." });
        }
        messages.push({
          role: "assistant",
          content: `[Step ${turnNum}] ${action.content ?? ""}`,
        });
      }
    }

    // If history was non-empty and last message is assistant, add continuation prompt
    if (history.length > 0 && messages[messages.length - 1].role === "assistant") {
      let continuation = "Continue with the next step.";
      if (schemaFeedback) {
        continuation =
          `Schema feedback: ${JSON.stringify(schemaFeedback)}\n` + "Please try again.";
      }
      messages.push({ role: "user", content: continuation });
    }

    return messages;
  }

  static _parseResponse(response: any): Record<string, unknown> {
    let result: Record<string, unknown> = {};
    let textContent: string | null = null;

    for (const block of response.content) {
      if (block.type === "tool_use") {
        result = {
          type: "tool_call",
          tool_name: block.name,
          arguments: block.input,
        };
        break; // tool_use takes priority
      }
      if (block.type === "text") {
        textContent = block.text;
      }
    }

    if (Object.keys(result).length === 0 && textContent !== null) {
      result = { type: "final_response", content: textContent };
    } else if (Object.keys(result).length === 0) {
      throw new Error("Anthropic response contained no usable content blocks.");
    }

    // Extract usage information
    if (response.usage) {
      result._usage = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      };
    }

    return result;
  }

  private static _resolveApiKey(explicitKey?: string): string {
    const key = explicitKey || (process.env.ANTHROPIC_API_KEY ?? "").trim();
    if (key) return key;

    // Try .env file
    const envPath = path.resolve(__dirname, "../../.env");
    try {
      const envContent = fs.readFileSync(envPath, "utf-8");
      for (const line of envContent.split("\n")) {
        const stripped = line.trim();
        if (!stripped || stripped.startsWith("#") || !stripped.includes("=")) continue;
        const [name, ...rest] = stripped.split("=");
        if (name.trim() === "ANTHROPIC_API_KEY") {
          return rest.join("=").trim().replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      // .env file doesn't exist, continue
    }

    throw new Error(
      "Anthropic API key not found. Set ANTHROPIC_API_KEY environment variable or pass apiKey explicitly.",
    );
  }
}
