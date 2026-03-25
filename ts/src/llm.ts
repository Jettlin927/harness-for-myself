/**
 * LLM base class and adapters.
 * Provides BaseLLM, ScriptedLLM, RuleBasedLLM, DeepSeekLLM, and buildSystemPrompt.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolSchema } from "./types.js";

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

export function buildSystemPrompt(
  toolNames: string[],
  options?: {
    nativeToolUse?: boolean;
    extraSystemInstructions?: string;
  },
): string {
  const nativeToolUse = options?.nativeToolUse ?? false;
  const extraSystemInstructions = options?.extraSystemInstructions ?? "";

  const toolsDesc = toolNames.length > 0 ? toolNames.join(", ") : "(none)";

  let outputSection: string;
  if (nativeToolUse) {
    outputSection =
      "## Output Format\n" +
      "Use the provided tools to accomplish the task. When you have completed the " +
      "task or need to communicate with the user, respond with a text message.\n\n";
  } else {
    outputSection =
      "## Output Format\n" +
      "Return exactly one JSON object per turn. Use one of these two shapes:\n" +
      '- Tool call: {"type":"tool_call","tool_name":"<tool>","arguments":{...}}\n' +
      '- Final answer: {"type":"final_response","content":"<answer>"}\n' +
      "Do not wrap JSON in markdown fences or add any text outside the JSON object.\n\n";
  }

  let prompt =
    "You are a coding agent. Your goal is to autonomously complete programming tasks " +
    "given by the user. You operate inside a tool-using harness that validates your " +
    "output, executes tools, and feeds results back to you.\n\n" +
    outputSection +
    `## Available Tools\n${toolsDesc}\n\n` +
    "## Workflow Strategy\n" +
    "Follow this order when working on code:\n" +
    "1. **Discover** — Use grep_search or glob_files to locate relevant files and " +
    "symbols. Use list_directory to understand project layout.\n" +
    "2. **Understand** — Use read_file to examine the code you found. Read enough " +
    "context to be confident about the change.\n" +
    "3. **Modify** — Use edit_file for surgical changes to existing files. Use " +
    "write_file only to create new files. Prefer small, focused edits.\n" +
    "4. **Verify** — Use bash to run tests, linters, or type checkers to confirm " +
    "your change works. Always verify before declaring success.\n\n" +
    "## Minimal Change Principle\n" +
    "Only modify what is necessary to complete the task. Do not refactor unrelated " +
    "code, rename variables for style, or reorganize imports unless the task " +
    "explicitly requires it.\n\n" +
    "## Error Recovery\n" +
    "When a tool call fails:\n" +
    "- Read the error message carefully and diagnose the root cause.\n" +
    "- Do NOT retry the exact same call. Change your approach: try a different " +
    "search pattern, fix the path, adjust the arguments, or gather more context " +
    "first.\n" +
    "- If you are stuck after 2-3 attempts, explain what you tried and why it " +
    "failed in a final_response.\n\n" +
    "## Context Markers\n" +
    "When you discover important information, prefix it with a marker so it " +
    "survives memory compression:\n" +
    "- `constraint:` for constraints or invariants you must respect.\n" +
    "- `todo:` for pending work items.\n" +
    "- `evidence:` for key findings (e.g., root cause of a bug).\n\n" +
    "## Safety Boundaries\n" +
    "Never execute destructive shell commands such as `rm -rf /`, " +
    "`git push --force`, `git reset --hard`, or anything that deletes data " +
    "or force-pushes to a remote. If the task seems to require a dangerous " +
    "operation, ask the user for confirmation in a final_response instead.";

  if (toolNames.includes("save_memory") && toolNames.includes("recall_memory")) {
    prompt +=
      "\n\n## Memory\n" +
      "You have persistent memory across sessions. Use save_memory to store important " +
      "discoveries (project conventions, test commands, architecture decisions). Use " +
      "recall_memory to retrieve previously saved knowledge.";
  }

  if (toolNames.includes("spawn_agent")) {
    prompt +=
      "\n\n## Sub-Agents\n" +
      "Use spawn_agent to delegate sub-tasks to specialized child agents. " +
      "The child runs to completion and returns a summary. " +
      "Check the context for available agent definitions.";
  }

  if (toolNames.includes("use_skill")) {
    prompt +=
      "\n\n## Skills\n" +
      "Use use_skill to look up reusable prompt templates for common tasks. " +
      "Check the context for available skills.";
  }

  if (extraSystemInstructions) {
    prompt += `\n\n## Additional Instructions\n${extraSystemInstructions}`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// BaseLLM
// ---------------------------------------------------------------------------

export abstract class BaseLLM {
  onToken?: (token: string) => void;

  abstract generate(workingMemory: Record<string, unknown>): Promise<Record<string, unknown>>;

  setToolSchemas?(schemas: ToolSchema[]): void;
}

// ---------------------------------------------------------------------------
// ScriptedLLM
// ---------------------------------------------------------------------------

export class ScriptedLLM extends BaseLLM {
  private _script: Record<string, unknown>[];
  private _index = 0;

  constructor(script: Record<string, unknown>[]) {
    super();
    this._script = script;
  }

  async generate(_workingMemory: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this._index >= this._script.length) {
      return {
        type: "final_response",
        content: "Script exhausted. Stopping safely.",
      };
    }
    const action = this._script[this._index];
    this._index += 1;
    return action;
  }
}

// ---------------------------------------------------------------------------
// RuleBasedLLM
// ---------------------------------------------------------------------------

export class RuleBasedLLM extends BaseLLM {
  async generate(workingMemory: Record<string, unknown>): Promise<Record<string, unknown>> {
    const goal = String(workingMemory.goal ?? "").toLowerCase();
    const history = (workingMemory.history as Record<string, unknown>[]) ?? [];

    if (goal.includes("add") || goal.includes("sum")) {
      if (history.length === 0) {
        return {
          type: "tool_call",
          tool_name: "add",
          arguments: { a: 2, b: 3 },
        };
      }
      const lastObs = String(history[history.length - 1].observation ?? "");
      return {
        type: "final_response",
        content: `Done. Computation result: ${lastObs}`,
      };
    }

    if (goal.includes("time")) {
      if (history.length === 0) {
        return {
          type: "tool_call",
          tool_name: "utc_now",
          arguments: {},
        };
      }
      return {
        type: "final_response",
        content: `Current UTC time observed: ${history[history.length - 1].observation}`,
      };
    }

    return {
      type: "final_response",
      content: "No tool needed. Here is the direct answer.",
    };
  }
}

// ---------------------------------------------------------------------------
// DeepSeekLLM
// ---------------------------------------------------------------------------

/** Transport function signature: (url, requestInit) => response-like object */
export type TransportFn = (
  url: string,
  options: RequestInit,
) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>;

export class DeepSeekLLM extends BaseLLM {
  apiKey: string | undefined;
  model: string;
  baseUrl: string;
  envPath: string;
  private _transport: TransportFn;
  private _toolNames: string[] = [];

  constructor(options?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    envPath?: string;
    transport?: TransportFn;
  }) {
    super();
    this.apiKey = options?.apiKey;
    this.model = options?.model ?? "deepseek-chat";
    this.baseUrl = (options?.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
    this.envPath = options?.envPath ?? this._defaultEnvPath();
    this._transport = options?.transport ?? this._defaultTransport;
  }

  setToolSchemas(schemas: ToolSchema[]): void {
    this._toolNames = schemas.map((s) => s.name);
  }

  async generate(workingMemory: Record<string, unknown>): Promise<Record<string, unknown>> {
    const apiKey = this._resolveApiKey();
    const payload = {
      model: this.model,
      messages: this._buildMessages(workingMemory),
      temperature: 0.1,
    };

    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this._transport(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorMsg = `DeepSeek API returned HTTP ${response.status}`;
          if (this._isRetryableError(errorMsg) && attempt < maxRetries) {
            const wait = 2 ** attempt * 1000;
            await this._sleep(wait);
            continue;
          }
          throw new Error(errorMsg);
        }

        const data = (await response.json()) as Record<string, unknown>;
        return this._parseResponse(data);
      } catch (err) {
        if (err instanceof Error) {
          const msg = err.message;
          if (this._isRetryableError(msg) && attempt < maxRetries) {
            const wait = 2 ** attempt * 1000;
            await this._sleep(wait);
            continue;
          }
        }
        throw err;
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error("DeepSeek API: max retries exhausted");
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private _isRetryableError(errorMsg: string): boolean {
    const match = errorMsg.match(/HTTP (\d{3})/);
    if (match) {
      const code = parseInt(match[1], 10);
      return code === 429 || code >= 500;
    }
    if (errorMsg.toLowerCase().includes("request failed")) {
      return true;
    }
    return false;
  }

  private _resolveApiKey(): string {
    let apiKey = this.apiKey || process.env.DEEPSEEK_API_KEY?.trim() || "";
    if (!apiKey) {
      apiKey = this._readEnvFileValue("DEEPSEEK_API_KEY");
    }
    if (apiKey) {
      this.apiKey = apiKey;
      return apiKey;
    }

    // In the TS version, we throw instead of prompting interactively
    // (interactive prompt would require readline which complicates testing)
    throw new Error(
      "DeepSeek API key is required. Set DEEPSEEK_API_KEY environment variable or provide it in .env file.",
    );
  }

  private _defaultEnvPath(): string {
    // Project root .env — 3 levels up from src/llm.ts
    return path.resolve(__dirname, "..", "..", ".env");
  }

  private _readEnvFileValue(key: string): string {
    try {
      if (!fs.existsSync(this.envPath)) {
        return "";
      }
      const content = fs.readFileSync(this.envPath, "utf-8");
      for (const line of content.split("\n")) {
        const stripped = line.trim();
        if (!stripped || stripped.startsWith("#") || !stripped.includes("=")) {
          continue;
        }
        const eqIndex = stripped.indexOf("=");
        const name = stripped.slice(0, eqIndex).trim();
        if (name === key) {
          let value = stripped.slice(eqIndex + 1).trim();
          // Strip surrounding quotes
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          return value;
        }
      }
    } catch {
      // File read error — treat as missing
    }
    return "";
  }

  private _buildMessages(
    workingMemory: Record<string, unknown>,
  ): Array<{ role: string; content: string }> {
    const toolNames =
      this._toolNames.length > 0
        ? this._toolNames
        : ["echo", "add", "utc_now", "write_text_file"];
    const systemPrompt = buildSystemPrompt(toolNames);
    const userPrompt = JSON.stringify(workingMemory, null, 2);
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
  }

  private _parseResponse(response: Record<string, unknown>): Record<string, unknown> {
    const choices = response.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error("DeepSeek response did not include any choices.");
    }

    const message = (choices[0] as Record<string, unknown>).message as
      | Record<string, unknown>
      | undefined;
    const content = message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("DeepSeek response content was empty.");
    }

    try {
      const parsed = JSON.parse(content);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("DeepSeek response JSON must decode to an object.");
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      if (err instanceof SyntaxError) {
        return {
          type: "final_response",
          content: content.trim(),
        };
      }
      throw err;
    }
  }

  private async _defaultTransport(
    url: string,
    options: RequestInit,
  ): Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }> {
    const response = await fetch(url, options);
    return {
      status: response.status,
      ok: response.ok,
      json: () => response.json(),
    };
  }
}
