/**
 * Coding tools — read_file, edit_file, write_file, run_bash,
 * glob_files, grep_search, list_directory.
 */

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as nodePath from "node:path";

import { createTwoFilesPatch } from "diff";
import { globSync } from "glob";

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export function readFile(args: Record<string, unknown>): unknown {
  const filePath = args.path;
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("read_file requires a non-empty string 'path'.");
  }
  if (!nodePath.isAbsolute(filePath)) {
    throw new Error("read_file requires an absolute 'path'.");
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  let text: string;
  try {
    const buf = fs.readFileSync(filePath);
    // Check for non-UTF-8 by looking for replacement chars or null bytes
    text = buf.toString("utf-8");
    // If the file has bytes that can't round-trip through UTF-8, it's binary
    const roundTrip = Buffer.from(text, "utf-8");
    if (!buf.equals(roundTrip)) {
      throw new Error(`File is not valid UTF-8: ${filePath}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("not valid UTF-8")) {
      throw err;
    }
    throw new Error(`File is not valid UTF-8: ${filePath}`);
  }

  const lines = text.split("\n");
  // Remove trailing empty element from split if file ends with newline
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const totalLines = lines.length;

  const offset = (args.offset as number) ?? 1;
  const limit = (args.limit as number) ?? 200;

  const start = offset - 1; // 1-based to 0-based
  const end = start + limit;
  const selected = lines.slice(start, end);

  // Format with line numbers (cat -n style): 5-char right-aligned + tab
  const numbered = selected.map((line, idx) => {
    const lineNum = offset + idx;
    return `${String(lineNum).padStart(6)}\t${line}`;
  });
  let content = numbered.join("\n");

  const truncated = totalLines > start + limit;
  if (truncated) {
    const lastShown = offset + selected.length - 1;
    content += `\n[truncated: showing lines ${offset}-${lastShown} of ${totalLines}]`;
  }

  return { content, lines: totalLines, truncated };
}

// ---------------------------------------------------------------------------
// edit_file
// ---------------------------------------------------------------------------

export function editFile(args: Record<string, unknown>): unknown {
  const filePath = args.path;
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("edit_file requires a non-empty string 'path'.");
  }
  if (!nodePath.isAbsolute(filePath)) {
    throw new Error("edit_file requires an absolute 'path'.");
  }

  const oldText = args.old_text;
  const newText = args.new_text;
  if (typeof oldText !== "string") {
    throw new Error("edit_file requires a string 'old_text'.");
  }
  if (typeof newText !== "string") {
    throw new Error("edit_file requires a string 'new_text'.");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");

  // Count occurrences
  let count = 0;
  let searchPos = 0;
  while (true) {
    const idx = content.indexOf(oldText, searchPos);
    if (idx === -1) break;
    count++;
    searchPos = idx + oldText.length;
  }

  if (count === 0) {
    throw new Error("old_text not found in file");
  }
  if (count > 1) {
    throw new Error(
      `Found ${count} matches for old_text, provide more context to make it unique`,
    );
  }

  const newContent = content.replace(oldText, newText);

  // Generate unified diff
  const fileName = nodePath.basename(filePath);
  const diff = createTwoFilesPatch(
    `a/${fileName}`,
    `b/${fileName}`,
    content,
    newContent,
    "",
    "",
  );

  fs.writeFileSync(filePath, newContent, "utf-8");

  return { path: filePath, replacements: 1, diff };
}

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------

export function writeFile(args: Record<string, unknown>): unknown {
  const filePath = args.path;
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("write_file requires a non-empty string 'path'.");
  }
  if (!nodePath.isAbsolute(filePath)) {
    throw new Error("write_file requires an absolute 'path'.");
  }

  const content = args.content;
  if (typeof content !== "string") {
    throw new Error("write_file requires a string 'content'.");
  }

  if (fs.existsSync(filePath)) {
    throw new Error(
      `File already exists: ${filePath} — use edit_file to modify existing files.`,
    );
  }

  const dir = nodePath.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");

  return {
    path: nodePath.resolve(filePath),
    bytes_written: Buffer.byteLength(content, "utf-8"),
  };
}

// ---------------------------------------------------------------------------
// run_bash
// ---------------------------------------------------------------------------

export function runBash(args: Record<string, unknown>): unknown {
  const command = args.command;
  if (typeof command !== "string" || !command.trim()) {
    throw new Error("run_bash requires a non-empty string 'command'.");
  }

  const timeout = ((args.timeout as number) ?? 30) * 1000; // seconds to ms

  try {
    const result = childProcess.spawnSync("sh", ["-c", command], {
      timeout,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      return {
        stdout: "",
        stderr: `Command timed out after ${(args.timeout as number) ?? 30}s: ${command}`,
        returncode: -1,
      };
    }

    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      returncode: result.status ?? -1,
    };
  } catch {
    return {
      stdout: "",
      stderr: `Command timed out after ${(args.timeout as number) ?? 30}s: ${command}`,
      returncode: -1,
    };
  }
}

// ---------------------------------------------------------------------------
// glob_files
// ---------------------------------------------------------------------------

export function globFiles(args: Record<string, unknown>): unknown {
  const pattern = args.pattern;
  if (typeof pattern !== "string" || !pattern.trim()) {
    throw new Error("glob_files requires a non-empty string 'pattern'.");
  }

  const root = args.root;
  if (typeof root !== "string" || !root.trim()) {
    throw new Error("glob_files requires a non-empty string 'root'.");
  }
  if (!nodePath.isAbsolute(root)) {
    throw new Error("glob_files requires an absolute 'root'.");
  }
  if (!fs.existsSync(root)) {
    throw new Error(`Root directory not found: ${root}`);
  }
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    throw new Error(`Root is not a directory: ${root}`);
  }

  const limit = (args.limit as number) ?? 100;

  const matches = globSync(pattern, { cwd: root, absolute: true }).sort();
  const total = matches.length;
  const truncated = total > limit;

  return {
    matches: matches.slice(0, limit),
    total,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// grep_search
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__"]);

export function grepSearch(args: Record<string, unknown>): unknown {
  const pattern = args.pattern;
  if (typeof pattern !== "string" || !pattern.trim()) {
    throw new Error("grep_search requires a non-empty string 'pattern'.");
  }

  const root = args.root;
  if (typeof root !== "string" || !root.trim()) {
    throw new Error("grep_search requires a non-empty string 'root'.");
  }
  if (!nodePath.isAbsolute(root)) {
    throw new Error("grep_search requires an absolute 'root'.");
  }
  if (!fs.existsSync(root)) {
    throw new Error(`Root directory not found: ${root}`);
  }

  const include = args.include as string | undefined;
  const limit = (args.limit as number) ?? 50;
  const contextLines = (args.context_lines as number) ?? 0;

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (err) {
    throw new Error(
      `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const matches: Array<{ path: string; line: number; content: string }> = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // permission error
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (matches.length >= limit) return;

      const fullPath = nodePath.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        if (include && !matchGlob(entry.name, include)) {
          continue;
        }
        searchFile(fullPath);
      }
    }
  }

  function matchGlob(fileName: string, globPattern: string): boolean {
    // Simple glob matching for include filter
    if (globPattern.startsWith("*.")) {
      const ext = globPattern.slice(1); // e.g. ".py"
      return fileName.endsWith(ext);
    }
    return fileName === globPattern;
  }

  function searchFile(filePath: string): void {
    let text: string;
    try {
      text = fs.readFileSync(filePath, "utf-8");
    } catch {
      return; // binary or permission error
    }

    // Skip files with null bytes (binary files)
    if (text.includes("\0")) return;

    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= limit) return;
      if (regex.test(lines[i])) {
        let content: string;
        if (contextLines > 0) {
          const start = Math.max(0, i - contextLines);
          const end = Math.min(lines.length, i + contextLines + 1);
          content = lines.slice(start, end).join("\n");
        } else {
          content = lines[i];
        }
        matches.push({ path: filePath, line: i + 1, content });
      }
    }
  }

  walk(root);
  const total = matches.length;
  const truncated = total >= limit;

  return {
    matches: matches.slice(0, limit),
    total,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// list_directory
// ---------------------------------------------------------------------------

export function listDirectory(args: Record<string, unknown>): unknown {
  const dirPath = args.path;
  if (typeof dirPath !== "string" || !dirPath.trim()) {
    throw new Error("list_directory requires a non-empty string 'path'.");
  }
  if (!nodePath.isAbsolute(dirPath)) {
    throw new Error("list_directory requires an absolute 'path'.");
  }
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    entries: entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "directory" : "file",
    })),
  };
}
