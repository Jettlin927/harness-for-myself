/**
 * ToolDispatcher — tool registration, routing, and execution engine.
 * Built-in tools: echo, add, utc_now, write_text_file.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  RetryableToolError,
  type ToolExecutionResult,
  type ToolSchema,
  toolError,
  toolSuccess,
} from "./types.js";
import {
  readFile,
  editFile,
  writeFile as writeFileTool,
  runBash,
  globFiles,
  grepSearch,
  listDirectory,
} from "./coding-tools.js";
import type { TaskStatus } from "./types.js";
import { TaskManager } from "./tasks.js";

export { RetryableToolError };

type ToolFn = (args: Record<string, unknown>) => unknown;

export class ToolDispatcher {
  private _tools: Map<string, ToolFn> = new Map();
  private _schemas: Map<string, Record<string, unknown>> = new Map();
  allowedWriteRoots: string[];

  constructor(options?: { allowedWriteRoots?: string[] }) {
    this.allowedWriteRoots = (options?.allowedWriteRoots ?? []).map((r) =>
      path.resolve(r),
    );

    this.registerTool("echo", ToolDispatcher._echo, {
      type: "object",
      description: "Echo back the given text",
      properties: {
        text: { type: "string", description: "Text to echo" },
      },
      required: ["text"],
    });

    this.registerTool("add", ToolDispatcher._add, {
      type: "object",
      description: "Add two numbers together",
      properties: {
        a: { type: "number", description: "First number" },
        b: { type: "number", description: "Second number" },
      },
      required: ["a", "b"],
    });

    this.registerTool("utc_now", ToolDispatcher._utcNow, {
      type: "object",
      description: "Return the current UTC time",
      properties: {},
    });

    this.registerTool(
      "write_text_file",
      (args) => this._writeTextFile(args),
      {
        type: "object",
        description: "Write text content to a file",
        properties: {
          path: { type: "string", description: "Absolute file path" },
          content: { type: "string", description: "Text content to write" },
        },
        required: ["path", "content"],
      },
    );
  }

  registerTool(
    name: string,
    tool: ToolFn,
    schema?: Record<string, unknown>,
  ): void {
    this._tools.set(name, tool);
    if (schema !== undefined) {
      this._schemas.set(name, schema);
    }
  }

  getToolSchemas(): ToolSchema[] {
    const result: ToolSchema[] = [];
    for (const [name, schema] of this._schemas) {
      result.push({
        name,
        description: (schema.description as string) ?? "",
        input_schema: schema,
      });
    }
    return result;
  }

  execute(
    toolName: string,
    args: Record<string, unknown>,
  ): ToolExecutionResult {
    const tool = this._tools.get(toolName);
    if (!tool) {
      return toolError(`Unknown tool: ${toolName}`);
    }

    try {
      const output = tool(args);
      return toolSuccess(output);
    } catch (err) {
      if (err instanceof RetryableToolError) {
        return toolError(err.message, { retryable: true });
      }
      return toolError(err instanceof Error ? err.message : String(err));
    }
  }

  // --- Built-in tools ---

  private static _echo(args: Record<string, unknown>): unknown {
    return { echo: (args.text as string) ?? "" };
  }

  private static _add(args: Record<string, unknown>): unknown {
    const a = args.a;
    const b = args.b;
    if (typeof a !== "number" || typeof b !== "number") {
      throw new Error("Arguments 'a' and 'b' must be numbers.");
    }
    return { sum: a + b };
  }

  private static _utcNow(_args: Record<string, unknown>): unknown {
    return { utc: new Date().toISOString() };
  }

  private _writeTextFile(args: Record<string, unknown>): unknown {
    const rawPath = args.path;
    const content = args.content;

    if (typeof rawPath !== "string" || !rawPath.trim()) {
      throw new Error(
        "write_text_file requires non-empty string 'path'.",
      );
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(
        "write_text_file requires non-empty string 'content'.",
      );
    }
    if (this.allowedWriteRoots.length === 0) {
      throw new Error(
        "write_text_file is disabled because no write roots are configured.",
      );
    }
    if (!path.isAbsolute(rawPath)) {
      throw new Error("write_text_file requires an absolute 'path'.");
    }

    const resolvedTarget = path.resolve(rawPath);
    if (!this._isWithinAllowedRoots(resolvedTarget)) {
      throw new Error(
        "write_text_file target is outside allowed write roots.",
      );
    }

    const dir = path.dirname(resolvedTarget);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolvedTarget, content, "utf-8");

    return {
      path: resolvedTarget,
      bytes_written: Buffer.byteLength(content, "utf-8"),
    };
  }

  private _isWithinAllowedRoots(targetPath: string): boolean {
    for (const root of this.allowedWriteRoots) {
      if (targetPath === root || targetPath.startsWith(root + path.sep)) {
        return true;
      }
    }
    return false;
  }
}

// --- Register coding tools ---

export function registerCodingTools(
  dispatcher: ToolDispatcher,
  options?: {
    allowBash?: boolean;
    projectRoot?: string;
  },
): void {
  dispatcher.registerTool("read_file", readFile, {
    type: "object",
    description: "Read file contents with line numbers",
    properties: {
      path: { type: "string", description: "Absolute file path" },
      offset: {
        type: "integer",
        description: "Starting line number (default 1)",
      },
      limit: {
        type: "integer",
        description: "Max lines to read (default 200)",
      },
    },
    required: ["path"],
  });

  dispatcher.registerTool("edit_file", editFile, {
    type: "object",
    description: "Replace exact text in a file",
    properties: {
      path: { type: "string", description: "Absolute file path" },
      old_text: {
        type: "string",
        description: "Text to find (must match exactly once unless replace_all is true)",
      },
      new_text: {
        type: "string",
        description: "Replacement text",
      },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences (default false)",
      },
    },
    required: ["path", "old_text", "new_text"],
  });

  dispatcher.registerTool("write_file", writeFileTool, {
    type: "object",
    description:
      "Write content to a file. Creates parent directories if needed. Overwrites existing files.",
    properties: {
      path: {
        type: "string",
        description: "Absolute file path",
      },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
  });

  dispatcher.registerTool("glob_files", globFiles, {
    type: "object",
    description: "Search for files matching a glob pattern",
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern (e.g. '**/*.py')",
      },
      root: {
        type: "string",
        description: "Absolute path to the root directory",
      },
      limit: {
        type: "integer",
        description: "Max results to return (default 100)",
      },
    },
    required: ["pattern", "root"],
  });

  dispatcher.registerTool("grep_search", grepSearch, {
    type: "object",
    description:
      "Search file contents with regex. Uses ripgrep when available, falls back to JS implementation.",
    properties: {
      pattern: {
        type: "string",
        description: "Regex pattern to search for",
      },
      root: {
        type: "string",
        description: "Absolute path to search root",
      },
      include: {
        type: "string",
        description: "Glob filter for filenames (e.g. '*.py')",
      },
      type: {
        type: "string",
        description: "File type filter (e.g. 'js', 'py') — requires ripgrep",
      },
      limit: {
        type: "integer",
        description: "Max matches to return (default 50)",
      },
      context_lines: {
        type: "integer",
        description: "Lines of context around each match (default 0)",
      },
      output_mode: {
        type: "string",
        enum: ["content", "files_with_matches", "count"],
        description: "Output mode (default 'content')",
      },
    },
    required: ["pattern", "root"],
  });

  dispatcher.registerTool("list_directory", listDirectory, {
    type: "object",
    description: "List directory contents with type annotations",
    properties: {
      path: {
        type: "string",
        description: "Absolute path to the directory",
      },
    },
    required: ["path"],
  });

  if (options?.allowBash !== false) {
    dispatcher.registerTool("bash", runBash, {
      type: "object",
      description: "Run a shell command",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute",
        },
        timeout: {
          type: "integer",
          description: "Timeout in seconds (default 120, max 600)",
        },
        cwd: {
          type: "string",
          description: "Working directory for the command",
        },
      },
      required: ["command"],
    });
  }

  // --- Task management tools ---

  const taskMgr = new TaskManager();

  dispatcher.registerTool(
    "create_task",
    (args) => taskMgr.create((args.description as string) ?? ""),
    {
      type: "object",
      description: "Create a new task to track progress",
      properties: {
        description: {
          type: "string",
          description: "What needs to be done",
        },
      },
      required: ["description"],
    },
  );

  dispatcher.registerTool(
    "update_task",
    (args) =>
      taskMgr.update(
        (args.id as string) ?? "",
        ((args.status as string) ?? "") as TaskStatus,
      ),
    {
      type: "object",
      description: "Update a task's status",
      properties: {
        id: { type: "string", description: "Task ID" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "failed"],
          description: "New status",
        },
      },
      required: ["id", "status"],
    },
  );

  dispatcher.registerTool("list_tasks", () => taskMgr.list(), {
    type: "object",
    description: "List all tasks and their statuses",
    properties: {},
  });
}
