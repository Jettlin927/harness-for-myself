# 模块 6: 项目上下文 (context.py → context.ts)

## 概述

自动发现项目类型、git 状态、.hau/CONTEXT.md、agent/skill 定义，注入 agent 工作记忆。

---

## 主函数

### `loadProjectContext(root: string): ProjectContext`

```typescript
interface ProjectContext {
  project_root: string;
  context_md: string | null;         // .hau/CONTEXT.md 内容（截断至 500 行）
  git: GitState | null;
  project_type: ProjectType;
  project_memory: string | null;     // 跨会话记忆字符串
  available_agents: AgentSummary[];   // { name, description }
  available_skills: SkillSummary[];   // { name, description }
}
```

---

## 子函数

### `loadContextMd(root): string | null`
- 读取 `.hau/CONTEXT.md`，不存在返回 null
- 超过 `MAX_CONTEXT_LINES`（500）时截断并追加标记

### `loadGitState(root): GitState | null`
- 先检查 `git rev-parse --is-inside-work-tree`，非 git 仓库返回 null
- 返回：

```typescript
interface GitState {
  branch: string;
  status: string;          // git status --short
  recent_commits: string;  // git log --oneline -5
}
```

- git 命令超时 5s，失败静默返回空字符串

### `detectProjectType(root): ProjectType`

```typescript
interface ProjectType {
  languages: string[];
  package_manager: string;    // "none" | "uv" | "pip" | "npm" | "yarn" | "pnpm" | "cargo"
  test_command: string;
  lint_command: string;
  format_command: string;
  build_file: string;
  has_makefile?: boolean;
}
```

**检测规则（按优先级）：**

| 文件 | 语言 | 包管理器 | 测试命令 |
|------|------|---------|---------|
| `pyproject.toml` | python | uv（如有 uv.lock）/pip | `uv run pytest` / `pytest` |
| `package.json` | javascript, typescript | pnpm/yarn/npm | `pnpm test` / `npm test` |
| `Cargo.toml` | rust | cargo | `cargo test` |
| `go.mod` | go | — | `go test ./...` |

**附加检测：**
- pyproject.toml 含 `[tool.ruff]` → lint: `ruff check .`, format: `ruff format --check .`
- Cargo.toml → lint: `cargo clippy`
- package.json 含 eslint → lint: `npx eslint .`
- package.json 含 prettier → format: `npx prettier --check .`
- Makefile 含 `test:` 目标 → 覆盖 test_command 为 `make test`

### `makefileHasTarget(text, target): boolean`
- 检查是否有以 `{target}:` 开头的行

---

## 常量

- `MAX_CONTEXT_LINES = 500`

---

## 测试覆盖要点

| 场景 | 预期 |
|------|------|
| 无 .hau 目录 | context_md = null |
| 读取 CONTEXT.md | 返回内容 |
| 超长 CONTEXT.md | 截断 + 标记 |
| Python + uv 项目 | language=python, pm=uv |
| Python 无 uv | pm=pip |
| Node 项目 | language=javascript |
| Node + yarn | pm=yarn |
| Rust 项目 | language=rust, pm=cargo |
| Go 项目 | language=go |
| 空目录 | languages=[], pm=none |
| Makefile + test 目标 | has_makefile=true, test=make test |
| pyproject.toml + ruff | lint=ruff check |
| Cargo.toml | lint=cargo clippy |
| 非 git 目录 | git=null |
| git 仓库 | branch + commits |
| .hau/agents/*.md 存在 | available_agents 填充 |
| .hau/skills/*.md 存在 | available_skills 填充 |
