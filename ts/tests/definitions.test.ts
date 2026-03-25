import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseDefinitionFile,
  loadAgentDefinitions,
  loadSkillDefinitions,
} from "../src/definitions.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "hau-def-test-"));
}

function writeFile(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("parseDefinitionFile", () => {
  it("parses complete agent frontmatter + body", () => {
    const dir = makeTmpDir();
    const p = writeFile(
      dir,
      "agent.md",
      "---\nname: test-runner\ndescription: Runs tests\n" +
        "max_steps: 10\ntrust_level: yolo\ntools: [bash, read_file]\n" +
        "---\nYou are a test runner agent.\n",
    );
    const [meta, body] = parseDefinitionFile(p);
    expect(meta["name"]).toBe("test-runner");
    expect(meta["description"]).toBe("Runs tests");
    expect(meta["max_steps"]).toBe(10);
    expect(meta["trust_level"]).toBe("yolo");
    expect(meta["tools"]).toEqual(["bash", "read_file"]);
    expect(body).toBe("You are a test runner agent.\n");
  });

  it("parses skill format with name/description + body", () => {
    const dir = makeTmpDir();
    const p = writeFile(
      dir,
      "skill.md",
      "---\nname: summarize\ndescription: Summarize text\n---\n" +
        "Please summarize the following text.\n",
    );
    const [meta, body] = parseDefinitionFile(p);
    expect(meta["name"]).toBe("summarize");
    expect(meta["description"]).toBe("Summarize text");
    expect(body).toBe("Please summarize the following text.\n");
  });

  it("returns empty metadata and full text when no frontmatter", () => {
    const dir = makeTmpDir();
    const p = writeFile(dir, "plain.md", "Just plain text.\nLine two.\n");
    const [meta, body] = parseDefinitionFile(p);
    expect(meta).toEqual({});
    expect(body).toBe("Just plain text.\nLine two.\n");
  });

  it("returns empty body when frontmatter present but no body content", () => {
    const dir = makeTmpDir();
    const p = writeFile(
      dir,
      "empty.md",
      "---\nname: empty-agent\ndescription: No body\n---\n",
    );
    const [meta, body] = parseDefinitionFile(p);
    expect(meta["name"]).toBe("empty-agent");
    expect(body).toBe("");
  });

  it("parses list values like [bash, read_file, glob_files]", () => {
    const dir = makeTmpDir();
    const p = writeFile(
      dir,
      "list.md",
      "---\ntools: [bash, read_file, glob_files]\n---\n",
    );
    const [meta] = parseDefinitionFile(p);
    expect(meta["tools"]).toEqual(["bash", "read_file", "glob_files"]);
  });

  it("parses empty list [] as empty array", () => {
    const dir = makeTmpDir();
    const p = writeFile(dir, "empty-list.md", "---\ntools: []\n---\n");
    const [meta] = parseDefinitionFile(p);
    expect(meta["tools"]).toEqual([]);
  });

  it("parses integer values", () => {
    const dir = makeTmpDir();
    const p = writeFile(dir, "int.md", "---\nmax_steps: 10\n---\n");
    const [meta] = parseDefinitionFile(p);
    expect(typeof meta["max_steps"]).toBe("number");
    expect(meta["max_steps"]).toBe(10);
  });

  it("treats file with opening --- but no closing --- as no frontmatter", () => {
    const dir = makeTmpDir();
    const p = writeFile(dir, "broken.md", "---\nname: broken\nno closing marker\n");
    const [meta, body] = parseDefinitionFile(p);
    expect(meta).toEqual({});
    expect(body).toBe("---\nname: broken\nno closing marker\n");
  });
});

describe("loadAgentDefinitions", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("loads multiple .md files sorted by filename", () => {
    const hauDir = makeTmpDir();
    const agentsDir = join(hauDir, "agents");
    mkdirSync(agentsDir);

    writeFile(
      agentsDir,
      "runner.md",
      "---\nname: test-runner\ndescription: Runs tests\ntrust_level: yolo\n---\nRun all tests.\n",
    );
    writeFile(
      agentsDir,
      "linter.md",
      "---\nname: linter\ndescription: Lint code\ntools: [bash]\n---\nLint everything.\n",
    );

    const agents = loadAgentDefinitions(hauDir);
    expect(agents).toHaveLength(2);
    const names = new Set(agents.map((a) => a.name));
    expect(names).toEqual(new Set(["test-runner", "linter"]));
  });

  it("returns empty array when agents/ directory does not exist", () => {
    const hauDir = makeTmpDir();
    const result = loadAgentDefinitions(hauDir);
    expect(result).toEqual([]);
  });

  it("skips file with invalid trust_level and warns", () => {
    const hauDir = makeTmpDir();
    const agentsDir = join(hauDir, "agents");
    mkdirSync(agentsDir);

    writeFile(
      agentsDir,
      "bad.md",
      "---\nname: bad-agent\ndescription: Bad trust\ntrust_level: dangerous\n---\n",
    );

    const agents = loadAgentDefinitions(hauDir);
    expect(agents).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain("trust_level");
  });

  it("skips file missing name field and warns", () => {
    const hauDir = makeTmpDir();
    const agentsDir = join(hauDir, "agents");
    mkdirSync(agentsDir);

    writeFile(
      agentsDir,
      "noname.md",
      "---\ndescription: No name here\n---\nBody text.\n",
    );

    const agents = loadAgentDefinitions(hauDir);
    expect(agents).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain("name");
  });

  it("skips file missing description and warns", () => {
    const hauDir = makeTmpDir();
    const agentsDir = join(hauDir, "agents");
    mkdirSync(agentsDir);

    writeFile(agentsDir, "nodesc.md", "---\nname: no-desc\n---\nBody.\n");

    const agents = loadAgentDefinitions(hauDir);
    expect(agents).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain("description");
  });

  it("skips file with non-positive max_steps and warns", () => {
    const hauDir = makeTmpDir();
    const agentsDir = join(hauDir, "agents");
    mkdirSync(agentsDir);

    writeFile(
      agentsDir,
      "bad-steps.md",
      "---\nname: bad-steps\ndescription: Bad steps\nmax_steps: -5\n---\n",
    );

    const agents = loadAgentDefinitions(hauDir);
    expect(agents).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain("max_steps");
  });
});

describe("loadSkillDefinitions", () => {
  it("loads multiple skill .md files", () => {
    const hauDir = makeTmpDir();
    const skillsDir = join(hauDir, "skills");
    mkdirSync(skillsDir);

    writeFile(
      skillsDir,
      "summarize.md",
      "---\nname: summarize\ndescription: Summarize text\n---\nSummarize it.\n",
    );
    writeFile(
      skillsDir,
      "translate.md",
      "---\nname: translate\ndescription: Translate text\n---\nTranslate it.\n",
    );

    const skills = loadSkillDefinitions(hauDir);
    expect(skills).toHaveLength(2);
    const names = new Set(skills.map((s) => s.name));
    expect(names).toEqual(new Set(["summarize", "translate"]));
  });

  it("returns empty array when skills/ directory does not exist", () => {
    const hauDir = makeTmpDir();
    const result = loadSkillDefinitions(hauDir);
    expect(result).toEqual([]);
  });
});
