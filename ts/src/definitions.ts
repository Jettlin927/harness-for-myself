/**
 * Definition file parsing for .hau/agents/ and .hau/skills/ directories.
 *
 * Parses YAML frontmatter + Markdown body from .md files and validates
 * them into AgentDefinition or SkillDefinition objects.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type { AgentType, TrustLevel } from "./types.js";

// --- Interfaces ---

export interface AgentDefinition {
  name: string;
  description: string;
  type: AgentType;
  max_steps: number | null;
  trust_level: TrustLevel | null;
  tools: string[] | null;
  system_instructions: string;
}

export interface SkillDefinition {
  name: string;
  description: string;
  body: string;
}

// --- Value Parsing ---

function parseValue(raw: string): string | number | string[] {
  // List: [item1, item2, ...]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1);
    if (!inner.trim()) {
      return [];
    }
    return inner.split(",").map((item) => item.trim());
  }

  // Integer
  const num = parseInt(raw, 10);
  if (!isNaN(num) && String(num) === raw) {
    return num;
  }

  return raw;
}

// --- Frontmatter Parsing ---

/**
 * Parse a .md file with --- frontmatter.
 * Returns [metadata, body].
 *
 * Rules:
 * 1. File starts with `---`, second `---` ends frontmatter.
 * 2. Each frontmatter line is `key: value`.
 * 3. If no leading `---`, entire file is body, frontmatter is empty dict.
 * 4. Opening `---` but no closing `---` → entire file is body.
 * 5. First empty line after closing `---` is stripped.
 */
export function parseDefinitionFile(
  path: string,
): [Record<string, string | number | string[]>, string] {
  const text = readFileSync(path, "utf-8");
  const lines = text.split("\n");

  // Check if file starts with ---
  if (!lines.length || lines[0].trim() !== "---") {
    return [{}, text];
  }

  // Find the closing ---
  let endIdx: number | null = null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }

  if (endIdx === null) {
    // No closing ---, treat entire file as body
    return [{}, text];
  }

  // Parse frontmatter lines
  const metadata: Record<string, string | number | string[]> = {};
  for (let i = 1; i < endIdx; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const colonPos = line.indexOf(":");
    if (colonPos < 0) continue;
    const key = line.slice(0, colonPos).trim();
    const rawValue = line.slice(colonPos + 1).trim();
    metadata[key] = parseValue(rawValue);
  }

  // Body is everything after the closing ---
  let body = lines.slice(endIdx + 1).join("\n");
  // Strip one leading newline if present (common after ---)
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }

  return [metadata, body];
}

// --- Validation ---

const VALID_TRUST_LEVELS = new Set<string>(["ask", "auto-edit", "yolo"]);
const VALID_AGENT_TYPES = new Set<string>(["general-purpose", "explore", "plan"]);

function validateAgent(
  meta: Record<string, string | number | string[]>,
  body: string,
  filepath: string,
): AgentDefinition | null {
  const name = meta["name"];
  if (!name || typeof name !== "string") {
    console.warn(`definitions: skipping ${filepath}: missing or empty 'name'`);
    return null;
  }

  const description = meta["description"];
  if (!description || typeof description !== "string") {
    console.warn(`definitions: skipping ${filepath}: missing or empty 'description'`);
    return null;
  }

  let trustLevel: TrustLevel | null = null;
  const rawTrust = meta["trust_level"];
  if (rawTrust !== undefined) {
    const trustStr = String(rawTrust);
    if (!VALID_TRUST_LEVELS.has(trustStr)) {
      console.warn(
        `definitions: skipping ${filepath}: invalid trust_level '${trustStr}'`,
      );
      return null;
    }
    trustLevel = trustStr as TrustLevel;
  }

  let maxSteps: number | null = null;
  const rawSteps = meta["max_steps"];
  if (rawSteps !== undefined) {
    if (typeof rawSteps !== "number" || rawSteps <= 0) {
      console.warn(
        `definitions: skipping ${filepath}: max_steps must be a positive integer`,
      );
      return null;
    }
    maxSteps = rawSteps;
  }

  let tools: string[] | null = null;
  const rawTools = meta["tools"];
  if (rawTools !== undefined) {
    if (!Array.isArray(rawTools)) {
      console.warn(`definitions: skipping ${filepath}: tools must be a list`);
      return null;
    }
    tools = rawTools;
  }

  let agentType: AgentType = "general-purpose";
  const rawType = meta["type"];
  if (rawType !== undefined) {
    const typeStr = String(rawType);
    if (!VALID_AGENT_TYPES.has(typeStr)) {
      console.warn(
        `definitions: skipping ${filepath}: invalid type '${typeStr}'`,
      );
      return null;
    }
    agentType = typeStr as AgentType;
  }

  return {
    name,
    description,
    type: agentType,
    max_steps: maxSteps,
    trust_level: trustLevel,
    tools,
    system_instructions: body,
  };
}

function validateSkill(
  meta: Record<string, string | number | string[]>,
  body: string,
  filepath: string,
): SkillDefinition | null {
  const name = meta["name"];
  if (!name || typeof name !== "string") {
    console.warn(`definitions: skipping ${filepath}: missing or empty 'name'`);
    return null;
  }

  const description = meta["description"];
  if (!description || typeof description !== "string") {
    console.warn(`definitions: skipping ${filepath}: missing or empty 'description'`);
    return null;
  }

  return { name, description, body };
}

// --- Loaders ---

function listMdFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Load all .md files from hauDir/agents/. Returns empty list if dir missing.
 */
export function loadAgentDefinitions(hauDir: string): AgentDefinition[] {
  const agentsDir = join(hauDir, "agents");
  const files = listMdFiles(agentsDir);
  const results: AgentDefinition[] = [];

  for (const filepath of files) {
    const [meta, body] = parseDefinitionFile(filepath);
    const agent = validateAgent(meta, body, filepath);
    if (agent !== null) {
      results.push(agent);
    }
  }

  return results;
}

/**
 * Load all .md files from hauDir/skills/. Returns empty list if dir missing.
 */
export function loadSkillDefinitions(hauDir: string): SkillDefinition[] {
  const skillsDir = join(hauDir, "skills");
  const files = listMdFiles(skillsDir);
  const results: SkillDefinition[] = [];

  for (const filepath of files) {
    const [meta, body] = parseDefinitionFile(filepath);
    const skill = validateSkill(meta, body, filepath);
    if (skill !== null) {
      results.push(skill);
    }
  }

  return results;
}
