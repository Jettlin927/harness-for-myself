import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import {
  MAX_CONTEXT_LINES,
  loadContextMd,
  loadGitState,
  detectProjectType,
  makefileHasTarget,
  loadProjectContext,
} from "../src/context.js";

// Helper to create a temp directory
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hau-context-test-"));
}

// Helper to clean up
function rmDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Helper to init a git repo in a directory
function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "hello");
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
}

// --- loadContextMd ---

describe("loadContextMd", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { rmDir(tmp); });

  it("returns null when no .hau dir", () => {
    expect(loadContextMd(tmp)).toBeNull();
  });

  it("reads CONTEXT.md content", () => {
    const hauDir = path.join(tmp, ".hau");
    fs.mkdirSync(hauDir);
    const content = "# My Project\n\nSome context here.\n";
    fs.writeFileSync(path.join(hauDir, "CONTEXT.md"), content);

    expect(loadContextMd(tmp)).toBe(content);
  });

  it("truncates long CONTEXT.md", () => {
    const hauDir = path.join(tmp, ".hau");
    fs.mkdirSync(hauDir);

    const total = MAX_CONTEXT_LINES + 100;
    const lines = Array.from({ length: total }, (_, i) => `line ${i}`);
    fs.writeFileSync(path.join(hauDir, "CONTEXT.md"), lines.join("\n"));

    const result = loadContextMd(tmp);
    expect(result).not.toBeNull();
    expect(result!).toContain(
      `[truncated: showing first ${MAX_CONTEXT_LINES} of ${total} lines]`,
    );
    // Exactly MAX_CONTEXT_LINES of content + 1 truncation notice
    const resultLines = result!.split("\n");
    expect(resultLines.length).toBe(MAX_CONTEXT_LINES + 1);
  });

  it("returns exact content when exactly MAX_CONTEXT_LINES", () => {
    const hauDir = path.join(tmp, ".hau");
    fs.mkdirSync(hauDir);

    const lines = Array.from({ length: MAX_CONTEXT_LINES }, (_, i) => `line ${i}`);
    const content = lines.join("\n");
    fs.writeFileSync(path.join(hauDir, "CONTEXT.md"), content);

    const result = loadContextMd(tmp);
    expect(result).toBe(content);
  });

  it("returns null when CONTEXT.md does not exist but .hau does", () => {
    fs.mkdirSync(path.join(tmp, ".hau"));
    expect(loadContextMd(tmp)).toBeNull();
  });
});

// --- detectProjectType ---

describe("detectProjectType", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { rmDir(tmp); });

  it("detects Python + uv project", () => {
    fs.writeFileSync(path.join(tmp, "pyproject.toml"), "");
    fs.writeFileSync(path.join(tmp, "uv.lock"), "");

    const result = detectProjectType(tmp);
    expect(result.languages).toContain("python");
    expect(result.package_manager).toBe("uv");
    expect(result.test_command).toBe("uv run pytest");
    expect(result.build_file).toBe("pyproject.toml");
  });

  it("detects Python without uv", () => {
    fs.writeFileSync(path.join(tmp, "pyproject.toml"), "");

    const result = detectProjectType(tmp);
    expect(result.package_manager).toBe("pip");
    expect(result.test_command).toBe("pytest");
  });

  it("detects Node project (npm)", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");

    const result = detectProjectType(tmp);
    expect(result.languages).toContain("javascript");
    expect(result.package_manager).toBe("npm");
  });

  it("detects Node + yarn", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    fs.writeFileSync(path.join(tmp, "yarn.lock"), "");

    const result = detectProjectType(tmp);
    expect(result.package_manager).toBe("yarn");
  });

  it("detects Node + pnpm", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");

    const result = detectProjectType(tmp);
    expect(result.package_manager).toBe("pnpm");
  });

  it("detects Node test command with pnpm", () => {
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      '{"scripts": {"test": "vitest"}}',
    );
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");

    const result = detectProjectType(tmp);
    expect(result.test_command).toBe("pnpm test");
  });

  it("detects Node test command with npm", () => {
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      '{"scripts": {"test": "jest"}}',
    );

    const result = detectProjectType(tmp);
    expect(result.test_command).toBe("npm test");
  });

  it("detects Rust project", () => {
    fs.writeFileSync(path.join(tmp, "Cargo.toml"), "");

    const result = detectProjectType(tmp);
    expect(result.languages).toContain("rust");
    expect(result.package_manager).toBe("cargo");
    expect(result.test_command).toBe("cargo test");
    expect(result.lint_command).toBe("cargo clippy");
  });

  it("detects Go project", () => {
    fs.writeFileSync(path.join(tmp, "go.mod"), "");

    const result = detectProjectType(tmp);
    expect(result.languages).toContain("go");
    expect(result.test_command).toBe("go test ./...");
  });

  it("returns defaults for empty directory", () => {
    const result = detectProjectType(tmp);
    expect(result.languages).toEqual([]);
    expect(result.package_manager).toBe("none");
    expect(result.build_file).toBe("");
    expect(result.test_command).toBe("");
    expect(result.lint_command).toBe("");
    expect(result.format_command).toBe("");
  });

  it("detects Makefile", () => {
    fs.writeFileSync(path.join(tmp, "Makefile"), "all:\n\techo hello\n");

    const result = detectProjectType(tmp);
    expect(result.has_makefile).toBe(true);
  });

  it("detects ruff lint/format for Python project", () => {
    fs.writeFileSync(
      path.join(tmp, "pyproject.toml"),
      "[project]\nname = 'foo'\n\n[tool.ruff]\nline-length = 100\n",
    );

    const result = detectProjectType(tmp);
    expect(result.lint_command).toBe("ruff check .");
    expect(result.format_command).toBe("ruff format --check .");
  });

  it("no lint command when ruff not configured", () => {
    fs.writeFileSync(
      path.join(tmp, "pyproject.toml"),
      "[project]\nname = 'foo'\n",
    );

    const result = detectProjectType(tmp);
    expect(result.lint_command).toBe("");
    expect(result.format_command).toBe("");
  });

  it("Makefile with test target overrides test_command", () => {
    fs.writeFileSync(path.join(tmp, "pyproject.toml"), "");
    fs.writeFileSync(path.join(tmp, "uv.lock"), "");
    fs.writeFileSync(
      path.join(tmp, "Makefile"),
      ".PHONY: test\ntest:\n\tpytest\n",
    );

    const result = detectProjectType(tmp);
    expect(result.test_command).toBe("make test");
  });

  it("detects eslint in package.json", () => {
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      '{"devDependencies": {"eslint": "^8.0.0"}}',
    );

    const result = detectProjectType(tmp);
    expect(result.lint_command).toBe("npx eslint .");
  });

  it("detects eslint config file", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    fs.writeFileSync(path.join(tmp, ".eslintrc.json"), "{}");

    const result = detectProjectType(tmp);
    expect(result.lint_command).toBe("npx eslint .");
  });

  it("detects prettier in package.json", () => {
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      '{"devDependencies": {"prettier": "^3.0.0"}}',
    );

    const result = detectProjectType(tmp);
    expect(result.format_command).toBe("npx prettier --check .");
  });

  it("detects prettier config file", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    fs.writeFileSync(path.join(tmp, ".prettierrc"), "{}");

    const result = detectProjectType(tmp);
    expect(result.format_command).toBe("npx prettier --check .");
  });

  it("detects multiple languages (python + node)", () => {
    fs.writeFileSync(path.join(tmp, "pyproject.toml"), "");
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");

    const result = detectProjectType(tmp);
    expect(result.languages).toContain("python");
    expect(result.languages).toContain("javascript");
  });

  it("python build_file takes priority over package.json", () => {
    fs.writeFileSync(path.join(tmp, "pyproject.toml"), "");
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");

    const result = detectProjectType(tmp);
    expect(result.build_file).toBe("pyproject.toml");
  });
});

// --- makefileHasTarget ---

describe("makefileHasTarget", () => {
  it("finds target at start of line", () => {
    expect(makefileHasTarget("test:\n\tpytest\n", "test")).toBe(true);
  });

  it("finds target with dependencies", () => {
    expect(makefileHasTarget("test: deps\n\tpytest\n", "test")).toBe(true);
  });

  it("returns false when target absent", () => {
    expect(makefileHasTarget("build:\n\tgcc\n", "test")).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(makefileHasTarget("", "test")).toBe(false);
  });

  it("does not match partial target name", () => {
    expect(makefileHasTarget("testing:\n\techo\n", "test")).toBe(false);
  });
});

// --- loadGitState ---

describe("loadGitState", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { rmDir(tmp); });

  it("returns null for non-git directory", () => {
    expect(loadGitState(tmp)).toBeNull();
  });

  it("returns git state for a repo", () => {
    initGitRepo(tmp);

    const result = loadGitState(tmp);
    expect(result).not.toBeNull();
    expect(["main", "master"]).toContain(result!.branch);
    expect(result!.recent_commits).toContain("init");
  });

  it("returns empty status for clean repo", () => {
    initGitRepo(tmp);

    const result = loadGitState(tmp);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("");
  });

  it("shows modified files in status", () => {
    initGitRepo(tmp);
    fs.writeFileSync(path.join(tmp, "README.md"), "changed");

    const result = loadGitState(tmp);
    expect(result).not.toBeNull();
    expect(result!.status).toContain("README.md");
  });
});

// --- loadProjectContext (integration) ---

describe("loadProjectContext", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { rmDir(tmp); });

  it("returns full context for a project", () => {
    initGitRepo(tmp);

    // Set up project files
    fs.writeFileSync(path.join(tmp, "pyproject.toml"), "");
    fs.writeFileSync(path.join(tmp, "uv.lock"), "");
    fs.writeFileSync(path.join(tmp, "Makefile"), "");

    // Set up context
    const hauDir = path.join(tmp, ".hau");
    fs.mkdirSync(hauDir);
    fs.writeFileSync(path.join(hauDir, "CONTEXT.md"), "# Context\n");

    const ctx = loadProjectContext(tmp);

    expect(ctx.project_root).toBe(fs.realpathSync(tmp));
    expect(ctx.context_md).toBe("# Context\n");
    expect(ctx.git).not.toBeNull();
    expect(ctx.project_type.languages).toContain("python");
    expect(ctx.project_type.package_manager).toBe("uv");
    expect(ctx.project_type.has_makefile).toBe(true);
  });

  it("handles empty project directory", () => {
    const ctx = loadProjectContext(tmp);

    expect(ctx.project_root).toBe(fs.realpathSync(tmp));
    expect(ctx.context_md).toBeNull();
    expect(ctx.git).toBeNull();
    expect(ctx.project_type.languages).toEqual([]);
    expect(ctx.project_type.package_manager).toBe("none");
    expect(ctx.available_agents).toEqual([]);
    expect(ctx.available_skills).toEqual([]);
  });

  it("returns null project_memory when no memory dir", () => {
    const ctx = loadProjectContext(tmp);
    expect(ctx.project_memory).toBeNull();
  });
});

// --- Agent / Skill discovery ---

describe("agent and skill discovery", () => {
  let tmp: string;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { rmDir(tmp); });

  function makeAgentMd(agentsDir: string, filename: string, name: string, desc: string): void {
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, filename),
      `---\nname: ${name}\ndescription: ${desc}\n---\nBody here.\n`,
    );
  }

  function makeSkillMd(skillsDir: string, filename: string, name: string, desc: string): void {
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, filename),
      `---\nname: ${name}\ndescription: ${desc}\n---\nSkill body.\n`,
    );
  }

  it("discovers agent definitions", () => {
    const hauDir = path.join(tmp, ".hau");
    makeAgentMd(path.join(hauDir, "agents"), "test-runner.md", "test-runner", "Run tests");

    const ctx = loadProjectContext(tmp);

    expect(ctx.available_agents.length).toBe(1);
    expect(ctx.available_agents[0].name).toBe("test-runner");
    expect(ctx.available_agents[0].description).toBe("Run tests");
  });

  it("discovers skill definitions", () => {
    const hauDir = path.join(tmp, ".hau");
    makeSkillMd(path.join(hauDir, "skills"), "review.md", "review", "Code review helper");

    const ctx = loadProjectContext(tmp);

    expect(ctx.available_skills.length).toBe(1);
    expect(ctx.available_skills[0].name).toBe("review");
    expect(ctx.available_skills[0].description).toBe("Code review helper");
  });

  it("returns empty arrays when no .hau dir", () => {
    const ctx = loadProjectContext(tmp);

    expect(ctx.available_agents).toEqual([]);
    expect(ctx.available_skills).toEqual([]);
  });

  it("discovers multiple agents", () => {
    const hauDir = path.join(tmp, ".hau");
    const agentsDir = path.join(hauDir, "agents");
    makeAgentMd(agentsDir, "a.md", "agent-a", "First agent");
    makeAgentMd(agentsDir, "b.md", "agent-b", "Second agent");

    const ctx = loadProjectContext(tmp);

    expect(ctx.available_agents.length).toBe(2);
    const names = ctx.available_agents.map((a) => a.name).sort();
    expect(names).toEqual(["agent-a", "agent-b"]);
  });

  it("ignores non-md files in agents dir", () => {
    const hauDir = path.join(tmp, ".hau");
    const agentsDir = path.join(hauDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "notes.txt"), "not an agent");
    makeAgentMd(agentsDir, "real.md", "real", "Real agent");

    const ctx = loadProjectContext(tmp);

    expect(ctx.available_agents.length).toBe(1);
    expect(ctx.available_agents[0].name).toBe("real");
  });
});
