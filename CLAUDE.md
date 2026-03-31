# CLAUDE.md — HAU 项目指南

## 项目概述

**HAU（Harness for Yourself）** — 可测试的编程 agent harness，具备严格 schema 校验和可靠性护栏。
能在真实项目中读代码、改代码、跑测试。

- 入口：`harness` CLI（`ts/src/cli.ts` → `ts/dist/cli.js`）
- Node.js >= 18，TypeScript 5.7+
- 包管理用 `npm`，代码在 `ts/` 目录下

## 当前状态

**TypeScript 重写已完成，Phase 13-16 已完成。** 23 个模块、418 个测试全部通过。

功能清单：编程工具（7 个，含 ripgrep 集成）、Anthropic 原生 tool_use、**Prompt Caching（三段缓存）**、流式输出、**细粒度权限规则链**、**Plan 模式 + Task 系统**、项目上下文注入、子 Agent 生成、Skill 系统、跨会话记忆、网络重试、原子快照、评估框架。

## 项目结构

```
ts/                   # TypeScript 源码
  src/                # 源码（22 个模块）
    types.ts          # 共享类型定义
    schema.ts         # LLM 输出解析与校验
    tools.ts          # 工具路由 ToolDispatcher
    coding-tools.ts   # 7 个编程工具
    llm.ts            # BaseLLM + ScriptedLLM + DeepSeekLLM
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
    tui.ts            # TUI 交互界面
    cli.ts            # CLI 入口
    eval.ts           # EvalRunner 离线回归
    index.ts          # 公开 API 导出
  tests/              # 测试（vitest，386 tests）
  package.json        # 依赖与脚本
  tsconfig.json       # TypeScript 配置
  eslint.config.js    # ESLint 配置
docs/                 # 文档
  getting-started.md  # 快速上手指南
  architecture.md     # 架构总览
  architecture/       # 各模块详细规格（00~18）
```

## 文档索引

| 文档 | 用途 |
|------|------|
| `docs/getting-started.md` | 安装、配置、基本用法 |
| `docs/architecture.md` | 系统架构图、模块清单与职责 |
| `docs/architecture/00-overview.md` | 模块清单、技术栈映射 |
| `docs/architecture/01-types.md` ~ `16-eval.md` | 各模块功能规格（接口/方法/参数/行为） |
| `docs/architecture/17-test-plan.md` | 386 测试用例映射 |
| `docs/architecture/18-rewrite-plan.md` | 重写执行计划与依赖关系 |

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

### Claude Code Hooks

配置在 `.claude/settings.json`，自动触发质量检查：
- **PostToolUse（Edit/Write）** → `npx eslint`（即时 lint 反馈）
- **PostToolUse（Edit/Write .ts）** → `tsc --noEmit`（即时类型检查）
- **SubagentStop** → `npm run check`（subagent 结束后全套 lint + build + test）
