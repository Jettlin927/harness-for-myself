# HAU Roadmap — 从 Agent Harness 到实用编程助手

> Phase 0-12（TypeScript 重写）已完成。本 Roadmap 聚焦下一阶段：缩小与 Claude Code 的体验差距。

## 当前位置

**已有**：22 模块 · 386 测试 · 7 编程工具 · Anthropic 原生 tool_use · **Prompt Caching** · 流式输出 · 三级权限 · 子 Agent · Eval 框架

**核心差距**（按影响排序）：
1. ~~上下文管理粗糙~~ → Phase 13 已完成 prompt caching + summary 上限
2. ~~工具性能弱~~ → Phase 14 已完成 ripgrep 集成 + bash 升级 + 文件工具增强
3. ~~权限模型粗~~ → Phase 15 已完成细粒度 PermissionRule 规则链
4. ~~交互体验缺失~~ → Phase 16 已完成 Plan 模式 + Task 系统
5. ~~多 Agent 能力弱~~ → Phase 18 已完成 Agent 类型系统
6. ~~生态集成空白~~ → Phase 19-20 已完成 web_fetch + MCP 基础 + Git 安全护栏

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

## Phase 18: 多 Agent 增强 ✅ 已完成

**目标：** 支持专用 agent 类型，自动限制工具集。

**实际交付：**

### 18a: Agent 类型系统
- `types.ts` — 新增 `AgentType`（general-purpose / explore / plan）
- `definitions.ts` — AgentDefinition 新增 `type` 字段，从 frontmatter 解析
- `subagent.ts` — 根据 agent type 自动设置 mode（explore/plan → 只读，general-purpose → 完整）
- `agent.ts` — spawn_agent schema 新增 `type` 参数
- 432 测试全部通过（新增 4 个 agent type 测试）

### 18b: 降级为 Future Work
- 后台执行（`run_in_background`）— 需 agent 主循环改为异步
- Git Worktree 隔离 — 需新模块 + 大量测试

---

## Phase 19: 网络能力 + MCP 基础 ✅ 已完成

**目标：** Agent 能访问网络资源，MCP 基础框架就绪。

**实际交付：**
- `coding-tools.ts` — 新增 `web_fetch` 工具（Node 18+ 原生 fetch，30s 超时，100KB 默认限制）
- `tools.ts` — ToolDispatcher.execute 支持 async 工具（Promise 返回值）
- `mcp.ts` — MCP 基础类型（McpServerConfig / McpTool / McpClient 占位），完整协议实现为 future work
- `coding-tools.ts` — 新增 `isDangerousCommand()` 工具函数 + `DANGEROUS_COMMAND_PATTERNS`
- 442 测试全部通过（新增 10 个测试）

---

## Phase 20: Git 安全护栏 ✅ 已完成

**目标：** 危险 git/rm 命令自动拦截。

**实际交付：**
- `agent.ts` — `_checkPermission` 增加危险命令安全网：
  - `git push --force` / `git reset --hard` / `git clean -f` / `rm -rf` 等强制 "ask"
  - 即使在 yolo 模式下也会触发确认
  - 显式 allow 规则可覆盖（用户知道自己在做什么）
- 442 测试全部通过

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
└── Phase 18: 多 Agent 增强                 ✅ 已完成 (2026-03-31)

Q4 2026 (10-12月)
├── Phase 19: 网络 + MCP                    ✅ 已完成 (2026-03-31)
└── Phase 20: Git 安全护栏                  ✅ 已完成 (2026-03-31)
```

## 设计原则

1. **每个 Phase 独立可交付** — 完成一个就能用一个，不搞大爆炸
2. **测试先行延续** — 每个新模块/功能先写测试
3. **向后兼容** — 已有的 386 测试不能 break
4. **实用主义** — 不追求 100% 复刻 Claude Code，优先解决真实痛点
