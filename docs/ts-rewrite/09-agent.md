# 模块 9: Agent 核心循环 (agent.py + stop_controller.py + error_policy.py)

## 概述

主循环编排器，协调 LLM、工具、内存、快照和可靠性系统。

---

## RunConfig

```typescript
interface RunConfig {
  max_steps: number;                     // 默认 20
  log_dir: string;                       // 默认 "logs"
  max_history_turns: number;             // 默认 20
  schema_retry_limit: number;            // 默认 1（共 2 次 LLM 调用）
  max_budget: number | null;             // 默认 null
  max_failures: number | null;           // 默认 3
  tool_retry_limit: number;              // 默认 0
  snapshot_dir: string | null;           // 默认 null（回退到 log_dir）
  dangerous_tools: string[];             // 默认 []
  goal_reached_token: string | null;     // 默认 null
  allowed_write_roots: string[];         // 默认 []
  project_root: string;                  // 默认 ""
  allow_bash: boolean;                   // 默认 true
  max_tokens_budget: number | null;      // 默认 null
  trust_level: TrustLevel;              // 默认 "ask"
  agent_depth: number;                   // 默认 0
}
```

---

## StopController

### 构造函数
```typescript
constructor(options?: {
  maxBudget?: number | null;
  maxFailures?: number | null;
  goalReachedToken?: string | null;
})
```

### 方法

#### `checkBeforeTurn(state: StopState): string | null`
- `budget_used >= maxBudget` → `"max_budget_reached"`

#### `checkAfterFailure(state: StopState): string | null`
- `failure_count >= maxFailures` → `"max_failures_reached"`

#### `checkGoalReached(content: string): boolean`
- `goalReachedToken` 是 content 的子串 → true

```typescript
interface StopState {
  budget_used: number;
  failure_count: number;
}
```

---

## ErrorPolicy

### 构造函数
```typescript
constructor(toolRetryLimit: number = 0)
```

### 方法

#### `shouldRetryTool(result: ToolExecutionResult, attempt: number): boolean`
- `!result.ok && result.retryable && attempt <= toolRetryLimit`

---

## HarnessAgent 类

### 构造函数
```typescript
constructor(llm: BaseLLM, config?: RunConfig)
```

**初始化：**
1. 创建 ToolDispatcher
2. 如果 `project_root` 非空：注册编程工具
3. 如果 `project_root` 非空且 `agent_depth < 3`：
   - 加载 .hau/agents/ 和 .hau/skills/ 定义
   - 创建 SubAgentSpawner，注册 spawn_agent 工具
   - 有 skill 时注册 use_skill 工具
4. 如果 LLM 有 `setToolSchemas`：传入工具 schema
5. 创建 MemoryManager、ErrorPolicy、SnapshotStore、StopController

### run 方法

```typescript
async run(
  goal: string,
  context?: Record<string, unknown> | null,
  options?: {
    resumeFrom?: string;
    onTurn?: (record: TurnRecord) => void;
    onApprove?: (toolName: string, description: string, args: Record<string, unknown>) => boolean;
    onToken?: (token: string) => void;
    onCompress?: () => void;
  }
): Promise<RunResult>
```

**主循环流程：**

```
for turn in 1..maxSteps:
  1. checkBeforeTurn(state)        → 预算耗尽则停止
  2. buildWorkingMemory()          → 构建 LLM 输入
  3. generateActionWithSchemaRetry → LLM 生成 + schema 校验 + 重试
  4. 追踪 token 用量
  5. 检查 token 预算
  6. budget_used += (schema_errors + 1)

  如果 schema 失败：记录错误轮次 → break
  如果 final_response：checkGoalReached → return RunResult
  如果 tool_call：
    7. executeToolCall()            → 审批 + 危险检查 + 重试循环
    8. budget_used += attempts
    9. 失败则 failure_count++
    10. 记录轮次 + 回调
    11. maybeCompress()
    12. saveSnapshot()
    13. checkAfterFailure()         → 失败过多则停止
```

### resume 方法
```typescript
async resume(snapshotPath: string): Promise<RunResult>
```
- 便捷方法：`run("", null, { resumeFrom: snapshotPath })`

### 内部方法

#### `_generateActionWithSchemaRetry(workingMemory): ActionResult`
- 循环 `schemaRetryLimit + 1` 次
- 首次用 workingMemory，失败后注入 schema_feedback
- 返回 `{ ok, action, llm_raw_output, schema_errors, error }`

#### `_executeToolCall(toolName, arguments, signatures, onApprove?): ToolExecutionResult`

1. **审批检查**：`_needsApproval(toolName)` → 调用 onApprove 回调
2. **危险工具检查**：指纹去重，重复调用 → blocked
3. **重试循环**：`shouldRetryTool()` 决定是否重试
4. **缓存危险指纹**：成功后追加

#### `_needsApproval(toolName): boolean`
- 敏感工具：`bash, edit_file, write_text_file, write_file, save_memory, spawn_agent`
- yolo → 全部 false
- auto-edit → 仅 bash 需要
- ask → 敏感工具全部需要

#### `_describeToolCall(toolName, arguments): string`
- bash → command 字符串
- edit_file → `"path: old_text前50字符"`
- write_file / write_text_file → path
- spawn_agent → goal
- 其他 → `JSON.stringify(arguments)`

---

## 测试覆盖要点

| 场景 | 预期 |
|------|------|
| tool_call → final_response | 正常完成 |
| 直接 final_response | 单轮完成 |
| schema 错误 + 重试恢复 | retry_count 记录 |
| goal_reached_token 匹配 | stop_reason=goal_reached |
| RetryableToolError 重试成功 | attempts > 1 |
| max_failures 达到 | 停止 |
| max_budget 达到 | 停止 |
| snapshot + resume | 断点续跑 |
| 重复危险工具调用 | blocked |
| token 预算超限 | 停止 |
| token 预算 null | 不限制 |
| 25 轮长对话 + 压缩 | 完成 + 触发压缩 |
| 标记观察保留 | constraint/todo/evidence 存活 |
| 未知工具 | 记录错误、继续 |
| max_steps 到达 | fallback response |
| context=null | 正常处理 |
| 权限拒绝 | 工具 blocked |
| 无 onApprove + ask 模式 | 敏感工具 blocked |
