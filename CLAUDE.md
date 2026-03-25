# CLAUDE.md — HAU 项目指南

## 项目概述

**HAU（Harness for Yourself）** — 可测试的编程 agent harness，具备严格 schema 校验和可靠性护栏。
能在真实项目中读代码、改代码、跑测试。

- 入口：`harness` CLI（`ts/src/cli.ts` → `ts/dist/cli.js`）
- Node.js >= 18，TypeScript 5.7+
- 包管理用 `npm`，代码在 `ts/` 目录下

## 当前状态

**TypeScript 重写进行中。** Python 版本功能已冻结，新开发在 `ts/` 目录进行。

功能清单：编程工具（7 个）、Anthropic 原生 tool_use、流式输出、三级权限、项目上下文注入、子 Agent 生成、Skill 系统、跨会话记忆、网络重试、原子快照。

## 项目结构

```
ts/                   # ★ TypeScript 重写（活跃开发）
  src/                # 源码
    types.ts          # 共享类型定义
    schema.ts         # LLM 输出解析与校验
    tools.ts          # 工具路由 ToolDispatcher
    coding-tools.ts   # 7 个编程工具
    llm.ts            # BaseLLM + ScriptedLLM
    anthropic-llm.ts  # AnthropicLLM 适配器
    memory.ts         # 工作记忆与压缩
    context.ts        # 项目上下文加载器
    session.ts        # 会话管理
    snapshot.ts       # 状态快照与恢复
    config.ts         # 版本化配置
    agent.ts          # 主循环 HarnessAgent
    stop-controller.ts # 停止条件控制
    error-policy.ts   # 错误分流与重试
    definitions.ts    # Agent/Skill 定义文件解析
    subagent.ts       # 子 Agent 生成
    project-memory.ts # 跨会话记忆
    logger.ts         # JSONL 轨迹日志
    tui.ts            # Ink TUI 交互
    cli.ts            # CLI 入口
    eval.ts           # EvalRunner 离线回归
  tests/              # 测试（vitest）
  package.json        # 依赖与脚本
  tsconfig.json       # TypeScript 配置
  eslint.config.js    # ESLint 配置
src/harness/          # Python 原版（已冻结，仅供参考）
docs/                 # 文档
  ts-rewrite/         # TypeScript 重写规格与计划
configs/              # 策略配置文件
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

### 常用命令

```bash
# 在 ts/ 目录下执行
npm run lint                     # ESLint 检查
npm run format                   # Prettier 格式检查
npm run format:fix               # Prettier 自动格式化
npm run build                    # tsc 编译
npm run test                     # vitest 跑测试
npm run check                    # lint + build + test 全套
```

### 代码约定

- commit 消息用中文
- LLM 输出必须经过 `schema.ts` 严格校验，不信任原始输出
- 工具通过 `ToolDispatcher.registerTool()` 注册，保持统一路由
- 可重试错误用 `RetryableToolError` 显式声明
- 新模块必须有对应测试文件
- agent 级测试用 `ScriptedLLM` 驱动，避免依赖真实 API
- 每个 Phase 完成后须全部测试通过

### Claude Code Hooks

配置在 `.claude/settings.json`，自动触发质量检查：
- **PostToolUse（Edit/Write）** → `npx eslint`（即时 lint 反馈）
- **SubagentStop** → `npm run check`（subagent 结束后全套 lint + build + test）
