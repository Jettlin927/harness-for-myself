# HAU 架构总览

## 系统架构

```
┌─────────────────────────────────────────────┐
│                   CLI / TUI                  │
│              cli.ts / tui.ts                 │
├─────────────────────────────────────────────┤
│               HarnessAgent                   │
│                agent.ts                      │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐ │
│  │ Memory  │  │   Stop   │  │   Error    │ │
│  │ Manager │  │Controller│  │  Policy    │ │
│  └─────────┘  └──────────┘  └────────────┘ │
├─────────────────────────────────────────────┤
│          ToolDispatcher + 7 编程工具          │
│           tools.ts / coding-tools.ts         │
├─────────────────────────────────────────────┤
│              LLM 适配层                      │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ AnthropicLLM │  │    DeepSeekLLM     │  │
│  │(native tool) │  │  (JSON parsing)    │  │
│  └──────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────┤
│              持久化层                        │
│  ┌──────────┐ ┌─────────┐ ┌──────────────┐ │
│  │ Snapshot │ │ Session │ │ProjectMemory │ │
│  │  Store   │ │ Manager │ │              │ │
│  └──────────┘ └─────────┘ └──────────────┘ │
├─────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │  Schema  │ │  Config  │ │   Logger   │  │
│  │Validator │ │          │ │  (JSONL)   │  │
│  └──────────┘ └──────────┘ └────────────┘  │
└─────────────────────────────────────────────┘
```

## 模块清单

### 核心类型 (`types.ts`)
共享类型定义：`LLMAction`、`ToolExecutionResult`、`TurnRecord`、`RunResult`、`ToolSchema`。错误类：`SchemaError`、`RetryableToolError`。

### Schema 校验 (`schema.ts`)
所有 LLM 输出必须经过 `parseLLMAction()` 严格校验。支持 `tool_call` 和 `final_response` 两种动作类型。

### 工具系统 (`tools.ts` + `coding-tools.ts`)
- `ToolDispatcher` — 统一工具注册与路由，支持信任级别标记
- 7 个编程工具：read_file、edit_file、write_file、run_bash、glob_files、grep_search、list_directory

### LLM 适配 (`llm.ts` + `anthropic-llm.ts`)
- `BaseLLM` — 抽象基类，定义 `generate()` 接口
- `AnthropicLLM` — Anthropic Messages API，原生 `tool_use` 支持，流式输出，自动重试
- `DeepSeekLLM` — DeepSeek API，JSON 解析模式
- `ScriptedLLM` / `RuleBasedLLM` — 测试用 mock

### Agent 核心 (`agent.ts`)
`HarnessAgent` 主循环：
1. 构建 working memory → 2. 调用 LLM → 3. Schema 校验 → 4. 权限检查 → 5. 工具执行 → 6. 记录结果 → 重复

配置通过 `RunConfig` 控制：max_turns、token_budget、trust_level 等 16 个参数。

### 内存管理 (`memory.ts`)
`MemoryManager` — 构建 working memory、自动压缩（超过阈值时总结旧对话）、运行摘要生成。

### 停止控制 (`stop-controller.ts`)
`StopController` — 检查是否应停止：最大轮数、token 预算、连续失败次数、目标达成。

### 错误策略 (`error-policy.ts`)
`ErrorPolicy` — 工具失败时的重试逻辑，区分可重试错误和永久错误。

### 快照与恢复 (`snapshot.ts`)
`SnapshotStore` — 原子写入（.tmp + rename），JSON 序列化 agent 状态，支持中断恢复。

### 会话管理 (`session.ts`)
`SessionManager` — 会话 CRUD，摘要构建（最多 5 条），支持会话列表和恢复。

### 配置 (`config.ts`)
`StrategyConfig` — 从 YAML/JSON 加载策略配置，转换为 RunConfig。

### 日志 (`logger.ts`)
`TrajectoryLogger` — JSONL 格式轨迹日志，每轮追加写入。

### 项目上下文 (`context.ts`)
`loadProjectContext()` — 自动检测项目类型、加载 git 状态、读取 CONTEXT.md、发现 agent/skill 定义。

### 定义文件 (`definitions.ts`)
解析 `.hau/agents/` 和 `.hau/skills/` 下的 YAML frontmatter 定义文件。

### 子 Agent (`subagent.ts`)
`SubAgentSpawner` — 生成子 agent（递归深度限制）、skill 展开执行。

### 跨会话记忆 (`project-memory.ts`)
`ProjectMemory` — 持久化键值记忆，支持搜索、注入上下文。

### 评估框架 (`eval.ts`)
`EvalRunner` — 加载评估用例，运行 agent，校验输出，生成报告。

### CLI (`cli.ts`)
Commander.js 命令行入口：`run`、`resume`、`chat`、`session`、`eval` 子命令。

### TUI (`tui.ts`)
Chalk + Ora 交互界面：流式输出、工具调用显示、权限确认、Skill 展开。

## 详细规格

各模块的完整接口定义、参数说明和行为规格见 `docs/architecture/` 目录下的对应文件。
