/**
 * Persistent cross-session memory for the agent harness.
 *
 * Stores key-value memory entries in `.hau/memory/` as individual JSON files,
 * allowing the agent to retain and retrieve knowledge across different sessions.
 */

import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

// --- Interfaces ---

export interface MemoryEntry {
  key: string;
  content: string;
  source: string;
  created_at: string;
  tags: string[];
}

export interface SaveOptions {
  source?: string;
  tags?: string[];
}

export interface SearchOptions {
  query?: string;
  tags?: string[];
}

// --- ProjectMemory Class ---

/**
 * Persistent cross-session memory stored in `.hau/memory/`.
 *
 * Each memory entry is saved as a separate JSON file named `{key}.json`
 * under the memory directory.
 */
export class ProjectMemory {
  readonly memoryDir: string;

  constructor(projectRoot: string) {
    this.memoryDir = join(projectRoot, ".hau", "memory");
    mkdirSync(this.memoryDir, { recursive: true });
  }

  /**
   * Save or update a memory entry.
   */
  save(key: string, content: string, options?: SaveOptions): MemoryEntry {
    const entry: MemoryEntry = {
      key,
      content,
      source: options?.source ?? "",
      created_at: new Date().toISOString(),
      tags: options?.tags ?? [],
    };
    const path = this._path(key);
    writeFileSync(path, JSON.stringify(entry, null, 2), "utf-8");
    return entry;
  }

  /**
   * Load a memory entry by key.
   * Returns null if not found or if the JSON is corrupted.
   */
  load(key: string): MemoryEntry | null {
    const path = this._path(key);
    if (!existsSync(path)) {
      return null;
    }
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"));
      return data as MemoryEntry;
    } catch {
      return null;
    }
  }

  /**
   * Search memories by substring in content or by tags.
   *
   * - query: substring match against content (case-insensitive)
   * - tags: at least one matching tag required
   * - Both provided: AND logic
   */
  search(options?: SearchOptions): MemoryEntry[] {
    const query = options?.query ?? "";
    const tags = options?.tags;
    const all = this.listAll();
    const results: MemoryEntry[] = [];

    for (const entry of all) {
      if (query && !entry.content.toLowerCase().includes(query.toLowerCase())) {
        continue;
      }
      if (tags && tags.length > 0) {
        const entryTagSet = new Set(entry.tags);
        const hasOverlap = tags.some((t) => entryTagSet.has(t));
        if (!hasOverlap) continue;
      }
      results.push(entry);
    }

    return results;
  }

  /**
   * Delete a memory entry.
   * Returns true if it existed and was deleted, false otherwise.
   */
  delete(key: string): boolean {
    const path = this._path(key);
    if (existsSync(path)) {
      unlinkSync(path);
      return true;
    }
    return false;
  }

  /**
   * List all memory entries sorted by creation time (newest first).
   * Corrupted JSON files are silently skipped.
   */
  listAll(): MemoryEntry[] {
    if (!existsSync(this.memoryDir)) {
      return [];
    }
    const entries: MemoryEntry[] = [];
    const files = readdirSync(this.memoryDir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(this.memoryDir, file), "utf-8"));
        entries.push(data as MemoryEntry);
      } catch {
        continue;
      }
    }

    // Sort newest first
    entries.sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
    return entries;
  }

  /**
   * Format memories as a string for injection into working memory context.
   */
  toContextString(maxEntries = 10): string {
    const entries = this.listAll().slice(0, maxEntries);
    if (!entries.length) {
      return "";
    }
    const lines: string[] = [];
    for (const entry of entries) {
      const tagsStr = entry.tags.length ? ` [${entry.tags.join(", ")}]` : "";
      lines.push(`- ${entry.key}${tagsStr}: ${entry.content}`);
    }
    return lines.join("\n");
  }

  private _path(key: string): string {
    return join(this.memoryDir, `${key}.json`);
  }
}
