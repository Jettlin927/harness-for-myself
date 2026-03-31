# HAU Roadmap — 从 Agent Harness 到实用编程助手

> Phase 0-12（TypeScript 重写）已完成。本 Roadmap 聚焦下一阶段：缩小与 Claude Code 的体验差距。

## 当前位置

**已有**：22 模块 · 386 测试 · 7 编程工具 · Anthropic 原生 tool_use · **Prompt Caching** · 流式输出 · 三级权限 · 子 Agent · Eval 框架

**核心差距**（按影响排序）：
1. ~~上下文管理粗糙~~ → Phase 13 已完成 prompt caching + summary 上限
2. ~~工具性能弱~~ → Phase 14 已完成 ripgrep 集成 + bash 升级 + 文件工具增强
3. ~~权限模型粗~~ → Phase 15 已完成细粒度 PermissionRule 规则链
4. ~~交互体验缺失~~ → Phase 16 已完成 Plan 模式 + Task 系统
5. 多 Agent 能力弱 → 无并行、无隔离、无专用 agent 类型
6. 生态集成空白 → 无 MCP、无 Git/GitHub 深度集成

---

## Phase 13: Prompt Caching + 智能上下文压缩 ✅ 已完成

**目标：** 大幅降低 token 成本，支撑长对话。

**实际交付：**
- `anthropic-llm.ts` — 三处 `cache_control: { type: "ephemeral" }` 标记：
  - system prompt（content block 数组格式）
  - tool definitions（最后一个 tool 上标记）
  - 首条 user message（goal + context + summary）
- `anthropic-llm.ts` — `_parseResponse()` 解析 `cache_creation_input_tokens` / `cache_read_input_tokens`
- `memory.ts` — 新增 `MAX_SUMMARY_CHARS = 4000`，summary 超限自动截断
- `types.ts` — 新增 `TokenUsage` 接口（含缓存字段），`RunResult` 增加 `cache_read_tokens` / `cache_create_tokens`
- `agent.ts` — 主循环累计缓存 token 统计
- 386 测试全部通过，含适配后的缓存相关断言

---

## Phase 14: 工具层升级 ✅ 已完成

**目标：** 大项目可用，工具性能对齐主流水平。

**实际交付：**

### 14a: run_bash 升级
- 新增 `cwd` 参数（指定工作目录）
- 超时默认从 30s 提升到 120s，上限 600s
- stdout/stderr 输出超过 50000 字符自动截断

### 14b: grep_search 换 ripgrep
- 优先调用 `rg` 子进程，不可用时自动 fallback 到 JS 实现
- 新增 `output_mode` 参数（content / files_with_matches / count）
- 新增 `type` 参数（文件类型过滤，如 'js', 'py'，需 rg）

### 14c: 文件工具增强
- `edit_file` 新增 `replace_all` 参数，支持全局替换
- `write_file` 允许覆盖已有文件（与 Claude Code Write 行为一致）

**测试：** 394 测试全部通过（新增 8 个测试）

---

## Phase 15: 细粒度权限模型 ✅ 已完成

**目标：** 在 ask 和 yolo 之间找到实用的中间地带。

**实际交付：**
- `types.ts` — 新增 `PermissionRule` 接口（tool + pattern 前缀 + allow/deny/ask）
- `agent.ts` — RunConfig 新增 `permission_rules` 字段，`_checkPermission()` 按规则链匹配
  - 规则按数组顺序评估，第一个匹配胜出
  - bash 工具匹配 command 前缀，文件工具匹配 path 前缀
  - 无规则匹配时 fallback 到 trust_level
  - `_needsApproval()` 保留为兼容方法
- `subagent.ts` — 子 Agent 继承父 Agent 的 permission_rules
- 402 测试全部通过（新增 8 个权限规则测试）

---

## Phase 16: Plan 模式 + Task 系统 ✅ 已完成

**目标：** 复杂任务先对齐再执行，过程可追踪。

**实际交付：**

### 16a: Plan 模式
- `types.ts` — 新增 `AgentMode`（`execute` | `plan`）
- `agent.ts` — Plan 模式限制为只读工具（read_file/glob/grep/list_directory/echo/list_tasks）
- TUI — `/plan <goal>` 命令：plan 模式探索 → 展示计划 → 确认后 execute 模式执行

### 16b: Task 系统
- `tasks.ts`（新模块）— TaskManager：create / update / get / list / clear
- 3 个工具注册到 ToolDispatcher：create_task / update_task / list_tasks
- TUI — `/tasks` 命令显示任务列表（带状态图标）
- 418 测试全部通过（新增 16 个测试）

---

## Phase 17: Hook 系统 ✅ 已完成

**目标：** 用户可在工具执行前后注入自定义逻辑。

**实际交付：**
- `hooks.ts`（新模块）— HookManager：getHooks / runHooks
- 4 个 hook 事件：PreToolUse / PostToolUse / SessionStart / SessionEnd
- matcher 支持 pipe 分隔的工具名匹配（如 "edit_file|write_file"）
- Hook 通过环境变量传递上下文（HAU_TOOL_NAME / HAU_TOOL_ARGS / HAU_TOOL_OK / HAU_TOOL_OUTPUT）
- agent.ts 集成：_executeToolCall 中触发 Pre/PostToolUse hooks
- context.ts：从 .hau/hooks.json 加载 hook 定义
- 428 测试全部通过（新增 10 个 hook 测试）

---

## Phase 18: 多 Agent 增强

**目标：** 支持并行 agent、隔离执行、专用 agent 类型。

**产出：**

### 18a: Agent 类型系统
- `definitions.ts` — agent 定义支持 `type` 字段：
  - `general-purpose` — 完整工具集
  - `explore` — 只读工具（Glob/Grep/Read），用于代码探索
  - `plan` — 只读 + 规划输出，不执行
- `subagent.ts` — 根据 type 自动限制可用工具集

### 18b: 后台执行 + Git Worktree 隔离
- `subagent.ts` — 支持 `run_in_background`（fire-and-forget，完成后通知）
- `src/worktree.ts`（新模块）— Git worktree 管理：
  - 为子 agent 创建临时 worktree
  - Agent 完成后：有改动则保留分支，无改动则清理
- 并行 agent 各自在独立 worktree 中执行

**验收：**
- Explore agent 无法调用 write/bash 工具
- 后台 agent 正常执行并回调通知
- Worktree 创建/清理正常

**预估工作量：** 大

---

## Phase 19: 网络能力 + MCP

**目标：** Agent 能访问网络资源，支持外部工具扩展。

**产出：**

### 19a: 内置网络工具
- `coding-tools.ts` — 新增：
  - `web_fetch` — HTTP GET，返回文本/HTML（带大小限制）
  - `web_search` — 搜索引擎查询（通过 API）

### 19b: MCP 客户端
- `src/mcp.ts`（新模块）— Model Context Protocol 客户端：
  - 连接 MCP server（stdio / HTTP）
  - 将 MCP tool 注册到 ToolDispatcher
  - 支持 MCP resource 作为上下文注入
- 配置在 `.hau/settings.json` 的 `mcpServers` 字段

**验收：**
- web_fetch 能抓取网页并返回内容
- 至少一个 MCP server（如 filesystem）正常连接并可调用
- MCP 工具在 TUI 中正常显示

**预估工作量：** 大

---

## Phase 20: Git/GitHub 深度集成

**目标：** Agent 理解 Git 上下文，能操作 PR/Issue。

**产出：**
- `context.ts` — 增强 git 上下文：
  - 当前 branch、diff stat、recent commits 自动注入
  - 检测 merge conflict 状态
- `coding-tools.ts` — git 相关工具增强：
  - `run_bash` 对 git 命令的安全护栏（拦截 force push、reset --hard 等）
- Agent 系统提示中注入 git 最佳实践（commit 规范、PR 创建流程）

**验收：**
- Agent 能自动感知当前 git 状态
- 危险 git 操作被拦截并提示用户确认
- 通过 `gh` CLI 创建 PR 的端到端流程

**预估工作量：** 中等

---

## 优先级与里程碑

```
Q2 2026 (4-6月)
├── Phase 13: Prompt Caching + 上下文压缩  ✅ 已完成 (2026-03-31)
├── Phase 14: 工具层升级                    ✅ 已完成 (2026-03-31)
└── Phase 15: 细粒度权限                    ✅ 已完成 (2026-03-31)

Q3 2026 (7-9月)
├── Phase 16: Plan + Task                   ✅ 已完成 (2026-03-31)
├── Phase 17: Hook 系统                     ✅ 已完成 (2026-03-31)
└── Phase 18: 多 Agent 增强                 ← 并行能力

Q4 2026 (10-12月)
├── Phase 19: 网络 + MCP                    ← 生态集成
└── Phase 20: Git/GitHub 深度集成           ← 开发者工作流
```

## 设计原则

1. **每个 Phase 独立可交付** — 完成一个就能用一个，不搞大爆炸
2. **测试先行延续** — 每个新模块/功能先写测试
3. **向后兼容** — 已有的 386 测试不能 break
4. **实用主义** — 不追求 100% 复刻 Claude Code，优先解决真实痛点
