# CLAUDE.md — HAU 项目指南

## 项目概述

**HAU（Harness for Yourself）** — 可测试的单 agent harness，具备严格 schema 校验和可靠性护栏。
目标是逐步演进为一个能在真实项目中读代码、改代码、跑测试的编程 agent。

- 入口：`harness` CLI（`src/harness/cli.py`）
- Python >= 3.12，唯一运行时依赖：`rich`
- 包管理和运行一律用 `uv`

## 当前进展

### 已完成

| 阶段 | 状态 | 详情文档 |
|------|------|---------|
| Step 1: Run Loop MVP | ✅ | `docs/step1-execution-log.md` |
| Step 2: Reliability Layer | ✅ | `docs/step2-reliability-layer.md` |
| Step 3: Ops & Evolution | ✅ | `docs/harness-3-step-plan.md`（底部进展记录） |
| Phase 1: 编程工具 | ✅ | `docs/evolution-roadmap.md` → Phase 1 |
| Phase 2: 原生 Tool Use | ✅ | `docs/evolution-roadmap.md` → Phase 2 |
| Phase 3: 流式输出 + 权限系统 | ✅ | `docs/evolution-roadmap.md` → Phase 3 |
| Phase 4: 项目感知 | ✅ | `docs/evolution-roadmap.md` → Phase 4 |

Phase 1-4 全部完成。当前具备：编程工具（read_file/edit_file/write_file/bash）、搜索导航工具（glob_files/grep_search/list_directory）、Anthropic 原生 tool_use、流式 token 输出、ask/auto-edit/yolo 三级权限、项目上下文注入。

### P0 修复（已完成）

- **搜索/导航工具** — glob_files、grep_search、list_directory，agent 可自主发现和导航代码
- **write_file 工具** — 支持创建新文件（拒绝覆盖已有文件，引导用 edit_file）
- **多轮对话稳定性** — 修复 _build_messages 中连续同 role 消息、空历史 + schema_feedback、tool_result 序列化格式

### 下一步（按优先级）

1. **补充测试覆盖** — 流式输出、权限系统、项目上下文的集成测试
2. **文档与分发** — 详见 `docs/github-readiness-and-distribution.md`

## 项目结构

```
src/harness/          # 核心代码
  agent.py            # 主循环 HarnessAgent + RunConfig
  schema.py           # LLM 输出解析与校验
  tools.py            # 工具路由 ToolDispatcher
  llm.py              # BaseLLM + RuleBasedLLM / ScriptedLLM / DeepSeekLLM
  anthropic_llm.py    # AnthropicLLM 适配器（原生 tool_use）
  types.py            # 共享类型定义（LLMAction, RunResult 等）
  coding_tools.py     # 编程工具（read_file, edit_file, write_file, run_bash, glob_files, grep_search, list_directory）
  memory.py           # 工作记忆与压缩
  context.py          # 项目上下文加载器（.hau/CONTEXT.md + git + 项目类型检测）
  session.py          # 会话管理 SessionManager
  config.py           # StrategyConfig 版本化配置
  eval.py             # EvalRunner 离线回归
  tui.py              # Rich TUI 交互
  cli.py              # CLI 入口
  logger.py           # JSONL 轨迹日志
  stop_controller.py  # 停止条件控制
  error_policy.py     # 错误分流与重试
  snapshot.py         # 状态快照与恢复
tests/                # 测试（unittest）
configs/              # 策略配置文件
docs/                 # 架构文档与执行记录
scripts/              # 运行脚本
```

## 关键文档索引

| 文档 | 用途 |
|------|------|
| `docs/harness-foundation.md` | 架构总览、核心循环流程图 |
| `docs/harness-3-step-plan.md` | Step 1-3 计划与验收标准 |
| `docs/evolution-roadmap.md` | Phase 1-4 演进计划（编程工具→Tool Use→流式→项目感知） |
| `docs/uv-local-setup.md` | 本地环境搭建与常用命令 |
| `docs/deepseek-entrypoint.md` | DeepSeek API 接入说明 |
| `docs/phase1-closure-notes.md` | Phase 1（原 Step 1）收尾笔记 |
| `docs/github-readiness-and-distribution.md` | GitHub 发布与分发准备 |

## 开发规范

### 常用命令

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

### 代码风格

- **格式化/Lint：** Ruff（配置见 `pyproject.toml` `[tool.ruff]`）
  - 行宽 100，target Python 3.12
  - 启用规则：`E`（pycodestyle）、`F`（pyflakes）、`I`（isort）
- **类型注解：** 使用 `from __future__ import annotations`，类型定义集中在 `src/harness/types.py`
- **数据类：** 用 `@dataclass`，不用 Pydantic
- **Import 风格：** 标准库 → 第三方 → 本地，由 Ruff isort 自动排序

### 代码约定

- commit 消息用中文
- LLM 输出必须经过 `schema.py` 严格校验，不信任原始输出
- 工具通过 `ToolDispatcher.register_tool()` 注册，保持统一路由
- 可重试错误用 `RetryableToolError` 显式声明
- 新模块必须有对应测试文件

### 测试

- **框架：** `unittest`（非 pytest 风格），通过 `uv run python -m pytest` 或 `make test` 运行
- **驱动方式：** agent 级测试用 `ScriptedLLM` 驱动，避免依赖真实 API
- **覆盖要求：** 每个 Phase/Step 完成后须 `make check`（lint + smoke + test）全部通过
- **测试分层：**
  - `tests/test_smoke.py` — 基础冒烟测试（Step 1 交付）
  - `tests/test_reliability.py` — 可靠性层回归（Step 2 交付）
  - `tests/test_coding_tools.py` — 编程工具单元测试（Phase 1）
  - `tests/test_anthropic_llm.py` — Anthropic 适配器测试（Phase 2）
  - 其余按模块一一对应：`test_agent.py`、`test_schema.py`、`test_tools.py`、`test_memory.py`、`test_session.py`、`test_config.py`、`test_deepseek.py`
- **测试标准（来自 `docs/phase1-closure-notes.md`）：** 覆盖 happy path、空/非法输入、边界行为、错误处理
- **回归评估：** `harness eval`（`src/harness/eval.py`）支持内置用例集和自定义 JSON 用例，产出 pass_rate/耗时/失败详情报告

### 类型检查

- **工具：** Pyright（`pyrightconfig.json`），basic 模式
- **运行：** `make typecheck` 或 `make fullcheck`
- 核心类型定义在 `src/harness/types.py`：`LLMAction`、`ToolExecutionResult`、`TurnRecord`、`RunResult`
- 公开 API 见 `src/harness/__init__.py` 的 `__all__`
- 注：存量代码有少量类型错误待修（未阻塞 `make check`）

### Claude Code Hooks

配置在 `.claude/settings.json`，自动触发质量检查：
- **PostToolUse（Edit/Write）** → `make lint`（即时 lint 反馈）
- **SubagentStop** → `make check`（subagent 结束后全套 lint + test）
