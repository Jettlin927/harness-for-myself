# CLAUDE.md — HAU 项目指南

## 项目概述

**HAU（Harness for Yourself）** — 可测试的编程 agent harness，具备严格 schema 校验和可靠性护栏。
能在真实项目中读代码、改代码、跑测试。

- 入口：`harness` CLI（`src/harness/cli.py`）
- Python >= 3.12，唯一运行时依赖：`rich`
- 包管理和运行一律用 `uv`

## 当前状态

**Python 版本功能完成（Phase 1-9b-3），正在规划 TypeScript 重写。**

已实现：编程工具（7 个）、Anthropic 原生 tool_use、流式输出、三级权限、项目上下文注入、子 Agent 生成、Skill 系统、跨会话记忆、网络重试、原子快照。221+ 测试用例全部通过。

## 项目结构

```
src/harness/          # Python 核心代码（现有实现）
  agent.py            # 主循环 HarnessAgent + RunConfig
  schema.py           # LLM 输出解析与校验
  tools.py            # 工具路由 ToolDispatcher
  llm.py              # BaseLLM + RuleBasedLLM / ScriptedLLM / DeepSeekLLM
  anthropic_llm.py    # AnthropicLLM 适配器（原生 tool_use）
  types.py            # 共享类型定义
  coding_tools.py     # 7 个编程工具
  memory.py           # 工作记忆与压缩
  context.py          # 项目上下文加载器
  session.py          # 会话管理
  config.py           # StrategyConfig 版本化配置
  eval.py             # EvalRunner 离线回归
  tui.py              # Rich TUI 交互
  cli.py              # CLI 入口
  logger.py           # JSONL 轨迹日志
  stop_controller.py  # 停止条件控制
  error_policy.py     # 错误分流与重试
  snapshot.py         # 状态快照与恢复
  definitions.py      # Agent/Skill 定义文件解析
  subagent.py         # 子 Agent 生成
  project_memory.py   # 跨会话记忆
tests/                # 测试（unittest，221+ 用例）
configs/              # 策略配置文件
docs/                 # 文档
  ts-rewrite/         # ★ TypeScript 重写规格与计划
scripts/              # 运行脚本
```

## 关键文档索引

### TypeScript 重写（当前工作重点）

| 文档 | 用途 |
|------|------|
| `docs/ts-rewrite/00-overview.md` | 重写总览、模块清单、技术栈映射 |
| `docs/ts-rewrite/01-types.md` ~ `16-eval.md` | 各模块功能规格（类/方法/参数/行为） |
| `docs/ts-rewrite/17-test-plan.md` | 221+ 测试用例 Python → TS 1:1 映射 |
| `docs/ts-rewrite/18-rewrite-plan.md` | ★ 13 Phase 执行计划与依赖关系 |

### 历史文档（Python 版本）

| 文档 | 用途 |
|------|------|
| `docs/harness-foundation.md` | 架构总览、核心循环流程图 |
| `docs/evolution-roadmap.md` | Phase 1-4 演进计划 |
| `docs/phase5-9-evolution-assessment.md` | Phase 5-9 评估 |
| `docs/github-readiness-and-distribution.md` | 发布与分发准备 |
| `docs/deepseek-entrypoint.md` | DeepSeek API 接入 |

## 开发规范

### 常用命令（Python 版本）

```bash
uv run python -m pytest          # 跑测试
make check                       # lint + smoke + test
make fullcheck                   # lint + typecheck + smoke + test
make fmt                         # Ruff 格式化
make lint                        # Ruff lint
make typecheck                   # Pyright 类型检查
harness chat                     # 交互式 TUI
harness eval                     # 回归评估
```

### 代码约定

- commit 消息用中文
- LLM 输出必须经过 `schema.py` 严格校验，不信任原始输出
- 工具通过 `ToolDispatcher.register_tool()` 注册，保持统一路由
- 可重试错误用 `RetryableToolError` 显式声明
- 新模块必须有对应测试文件
- agent 级测试用 `ScriptedLLM` 驱动，避免依赖真实 API
- 每个 Phase 完成后须全部测试通过

### Claude Code Hooks

配置在 `.claude/settings.json`，自动触发质量检查：
- **PostToolUse（Edit/Write）** → `make lint`（即时 lint 反馈）
- **SubagentStop** → `make check`（subagent 结束后全套 lint + test）
