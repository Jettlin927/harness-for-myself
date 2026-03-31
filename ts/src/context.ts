/**
 * Project context loader for HAU.
 *
 * Scans the project root for configuration files, git state, and user-defined
 * context to inject into the agent's working memory.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { HookDefinition } from "./types.js";

// ---------------------------------------------------------------------------
// TODO: merge 时替换为 import from "./definitions.js"
// 以下是临时类型和 stub 函数，用于 agent/skill 发现功能。
// 另一个 agent 正在并行开发 definitions.ts，合并后替换。
// ---------------------------------------------------------------------------

interface AgentDefinition {
  name: string;
  description: string;
}

interface SkillDefinition {
  name: string;
  description: string;
}

function loadAgentDefinitions(hauDir: string): AgentDefinition[] {
  const agentsDir = path.join(hauDir, "agents");
  if (!fs.existsSync(agentsDir) || !fs.statSync(agentsDir).isDirectory()) {
    return [];
  }
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  const results: AgentDefinition[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(agentsDir, file), "utf-8");
    const parsed = parseFrontmatter(content);
    if (parsed && parsed.name) {
      results.push({ name: parsed.name, description: parsed.description ?? "" });
    }
  }
  return results;
}

function loadSkillDefinitions(hauDir: string): SkillDefinition[] {
  const skillsDir = path.join(hauDir, "skills");
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
    return [];
  }
  const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md"));
  const results: SkillDefinition[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(skillsDir, file), "utf-8");
    const parsed = parseFrontmatter(content);
    if (parsed && parsed.name) {
      results.push({ name: parsed.name, description: parsed.description ?? "" });
    }
  }
  return results;
}

/** Minimal YAML frontmatter parser — extracts key: value pairs between --- delimiters. */
function parseFrontmatter(text: string): Record<string, string> | null {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      result[key] = value;
    }
  }
  return result;
}

// TODO: merge 时替换为 import from "./project_memory.js"
// ProjectMemory 在另一个 agent 开发，此处临时 stub。

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_CONTEXT_LINES = 500;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface GitState {
  branch: string;
  status: string;
  recent_commits: string;
}

export interface ProjectType {
  languages: string[];
  package_manager: string;
  test_command: string;
  lint_command: string;
  format_command: string;
  build_file: string;
  has_makefile?: boolean;
}

export interface AgentSummary {
  name: string;
  description: string;
}

export interface SkillSummary {
  name: string;
  description: string;
}

export interface ProjectContext {
  project_root: string;
  context_md: string | null;
  git: GitState | null;
  project_type: ProjectType;
  project_memory: string | null;
  available_agents: AgentSummary[];
  available_skills: SkillSummary[];
  hooks: HookDefinition[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load project context from the given root directory.
 */
export function loadProjectContext(root: string): ProjectContext {
  const resolvedRoot = fs.realpathSync(root);

  const hauDir = path.join(root, ".hau");

  const agents = loadAgentDefinitions(hauDir);
  const skills = loadSkillDefinitions(hauDir);

  return {
    project_root: resolvedRoot,
    context_md: loadContextMd(root),
    git: loadGitState(root),
    project_type: detectProjectType(root),
    project_memory: loadProjectMemory(root),
    available_agents: agents.map((a) => ({ name: a.name, description: a.description })),
    available_skills: skills.map((s) => ({ name: s.name, description: s.description })),
    hooks: loadHooksConfig(hauDir),
  };
}

/**
 * Read .hau/CONTEXT.md, truncating to MAX_CONTEXT_LINES lines.
 * Returns null if the file does not exist.
 */
export function loadContextMd(root: string): string | null {
  const contextFile = path.join(root, ".hau", "CONTEXT.md");
  if (!fs.existsSync(contextFile) || !fs.statSync(contextFile).isFile()) {
    return null;
  }

  const text = fs.readFileSync(contextFile, "utf-8");
  const lines = text.split("\n");
  const total = lines.length;

  if (total <= MAX_CONTEXT_LINES) {
    return text;
  }

  const truncated = lines.slice(0, MAX_CONTEXT_LINES).join("\n");
  return truncated + `\n[truncated: showing first ${MAX_CONTEXT_LINES} of ${total} lines]`;
}

/**
 * Run a git command in the given root directory and return stdout, or "" on failure.
 */
function runGit(root: string, ...args: string[]): string {
  try {
    const result = execSync(["git", ...args].join(" "), {
      cwd: root,
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });
    return result.trim();
  } catch {
    return "";
  }
}

/**
 * Return branch / status / recent_commits, or null if not a git repo.
 */
export function loadGitState(root: string): GitState | null {
  const check = runGit(root, "rev-parse", "--is-inside-work-tree");
  if (check !== "true") {
    return null;
  }

  return {
    branch: runGit(root, "rev-parse", "--abbrev-ref", "HEAD"),
    status: runGit(root, "status", "--short"),
    recent_commits: runGit(root, "log", "--oneline", "-5"),
  };
}

/**
 * Detect project type by checking for well-known config files.
 */
export function detectProjectType(root: string): ProjectType {
  const languages: string[] = [];
  let package_manager = "none";
  let test_command = "";
  let lint_command = "";
  let format_command = "";
  let build_file = "";
  let has_makefile: boolean | undefined;

  // Read file contents for deeper inspection
  const pyprojectPath = path.join(root, "pyproject.toml");
  const hasPyproject = fs.existsSync(pyprojectPath) && fs.statSync(pyprojectPath).isFile();
  let pyprojectText = "";
  if (hasPyproject) {
    pyprojectText = fs.readFileSync(pyprojectPath, "utf-8");
  }

  const packageJsonPath = path.join(root, "package.json");
  const hasPackageJson = fs.existsSync(packageJsonPath) && fs.statSync(packageJsonPath).isFile();
  let packageJsonText = "";
  if (hasPackageJson) {
    packageJsonText = fs.readFileSync(packageJsonPath, "utf-8");
  }

  // Python
  if (hasPyproject) {
    languages.push("python");
    build_file = "pyproject.toml";
    if (fs.existsSync(path.join(root, "uv.lock"))) {
      package_manager = "uv";
      test_command = "uv run pytest";
    } else {
      package_manager = "pip";
      test_command = "pytest";
    }

    // Lint / format commands from pyproject.toml
    if (pyprojectText.includes("[tool.ruff]")) {
      lint_command = "ruff check .";
      format_command = "ruff format --check .";
    }
  }

  // JavaScript / TypeScript
  if (hasPackageJson) {
    languages.push("javascript", "typescript");
    if (!build_file) {
      build_file = "package.json";
    }
    if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) {
      package_manager = "pnpm";
    } else if (fs.existsSync(path.join(root, "yarn.lock"))) {
      package_manager = "yarn";
    } else {
      package_manager = "npm";
    }

    if (!test_command) {
      if (packageJsonText.includes('"test"')) {
        if (package_manager === "pnpm") {
          test_command = "pnpm test";
        } else {
          test_command = "npm test";
        }
      }
    }

    if (!lint_command) {
      const eslintConfigs = [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml"];
      const hasEslintConfig = eslintConfigs.some((f) => fs.existsSync(path.join(root, f)));
      if (hasEslintConfig || packageJsonText.includes('"eslint"')) {
        lint_command = "npx eslint .";
      }
    }

    if (!format_command) {
      const prettierConfigs = [".prettierrc", ".prettierrc.js", ".prettierrc.json", ".prettierrc.yml"];
      const hasPrettierConfig = prettierConfigs.some((f) => fs.existsSync(path.join(root, f)));
      if (hasPrettierConfig || packageJsonText.includes('"prettier"')) {
        format_command = "npx prettier --check .";
      }
    }
  }

  // Rust
  if (fs.existsSync(path.join(root, "Cargo.toml"))) {
    languages.push("rust");
    if (!build_file) {
      build_file = "Cargo.toml";
    }
    package_manager = "cargo";
    if (!test_command) {
      test_command = "cargo test";
    }
    if (!lint_command) {
      lint_command = "cargo clippy";
    }
  }

  // Go
  if (fs.existsSync(path.join(root, "go.mod"))) {
    languages.push("go");
    if (!build_file) {
      build_file = "go.mod";
    }
    if (!test_command) {
      test_command = "go test ./...";
    }
  }

  // Makefile — check for test target and potentially override test_command
  const makefilePath = path.join(root, "Makefile");
  if (fs.existsSync(makefilePath) && fs.statSync(makefilePath).isFile()) {
    has_makefile = true;
    const makefileText = fs.readFileSync(makefilePath, "utf-8");
    if (makefileHasTarget(makefileText, "test")) {
      test_command = "make test";
    }
  }

  const result: ProjectType = {
    languages,
    package_manager,
    test_command,
    lint_command,
    format_command,
    build_file,
  };
  if (has_makefile !== undefined) {
    result.has_makefile = has_makefile;
  }
  return result;
}

/**
 * Check whether a Makefile contains a given target (e.g. 'test:').
 */
export function makefileHasTarget(text: string, target: string): boolean {
  for (const line of text.split("\n")) {
    const stripped = line.trimStart();
    if (stripped.startsWith(`${target}:`)) {
      return true;
    }
  }
  return false;
}

/**
 * Load project memory string (stub — returns null until project_memory.ts is implemented).
 */
function loadProjectMemory(_root: string): string | null {
  // TODO: real implementation in project_memory.ts
  return null;
}

/**
 * Load hook definitions from .hau/hooks.json.
 * Returns empty array if file does not exist or is invalid.
 */
function loadHooksConfig(hauDir: string): HookDefinition[] {
  try {
    const content = fs.readFileSync(path.join(hauDir, "hooks.json"), "utf-8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed as HookDefinition[];
  } catch {
    return [];
  }
}
