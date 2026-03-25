# HAU TypeScript 重写——总览

## 目标

将 HAU（Python + uv）重写为 TypeScript（Node.js + npm），保持功能完全对齐，便于通过 npm/npx 分发。

## 模块清单

| # | 模块 | Python 文件 | TS 对应 | 规格文档 |
|---|------|------------|---------|---------|
| 1 | 类型定义 | `types.py` | `src/types.ts` | `01-types.md` |
| 2 | Schema 校验 | `schema.py` | `src/schema.ts` | `02-schema.md` |
| 3 | 工具系统 | `tools.py` + `coding_tools.py` | `src/tools.ts` + `src/coding-tools.ts` | `03-tools.md` |
| 4 | LLM 基类与适配器 | `llm.py` + `anthropic_llm.py` | `src/llm.ts` + `src/anthropic-llm.ts` | `04-llm.md` |
| 5 | 内存管理 | `memory.py` | `src/memory.ts` | `05-memory.md` |
| 6 | 项目上下文 | `context.py` | `src/context.ts` | `06-context.md` |
| 7 | 会话与快照 | `session.py` + `snapshot.py` | `src/session.ts` + `src/snapshot.ts` | `07-session-snapshot.md` |
| 8 | 配置 | `config.py` | `src/config.ts` | `08-config.md` |
| 9 | Agent 核心循环 | `agent.py` + `stop_controller.py` + `error_policy.py` | `src/agent.ts` + `src/stop-controller.ts` + `src/error-policy.ts` | `09-agent.md` |
| 10 | 定义文件解析 | `definitions.py` | `src/definitions.ts` | `10-definitions.md` |
| 11 | 子 Agent | `subagent.py` | `src/subagent.ts` | `11-subagent.md` |
| 12 | 项目记忆 | `project_memory.py` | `src/project-memory.ts` | `12-project-memory.md` |
| 13 | 日志 | `logger.py` | `src/logger.ts` | `13-logger.md` |
| 14 | CLI | `cli.py` | `src/cli.ts` | `14-cli.md` |
| 15 | TUI | `tui.py` | `src/tui.ts` | `15-tui.md` |
| 16 | 评估 | `eval.py` | `src/eval.ts` | `16-eval.md` |

## 技术栈映射

| Python | TypeScript |
|--------|-----------|
| `dataclass` | `interface` / `class` |
| `unittest` | `vitest` |
| `rich` | `ink` / `chalk` + `ora` |
| `argparse` | `commander` |
| `subprocess` | `child_process` / `execa` |
| `pathlib.Path` | `node:path` + `node:fs` |
| `re` | `RegExp` (原生) |
| `json` | `JSON` (原生) |
| `anthropic` SDK | `@anthropic-ai/sdk` |
| `uv` | `npm` / `pnpm` |

## 测试对照

Python 侧共 18 个测试文件、221+ 测试用例。TS 重写须 1:1 覆盖所有测试场景，详见 `17-test-plan.md`。
