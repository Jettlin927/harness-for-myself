# 模块 1: 类型定义 (types.py → types.ts)

## 概述

集中定义所有核心类型，作为模块间的契约。

## 类型别名

```typescript
type ActionType = "tool_call" | "final_response";
type TrustLevel = "ask" | "auto-edit" | "yolo";
```

## 接口定义

### LLMAction

LLM 输出经 schema 校验后的结构化动作。

```typescript
interface LLMAction {
  action_type: ActionType;
  raw_output: unknown;           // 原始 LLM 输出，保留用于日志
  tool_name: string | null;      // tool_call 时非空
  arguments: Record<string, unknown>; // tool_call 时的参数，默认 {}
  content: string | null;        // final_response 时非空
}
```

**不变量：**
- `action_type === "tool_call"` → `tool_name` 非空字符串，`arguments` 为对象
- `action_type === "final_response"` → `content` 非空字符串
- `raw_output` 始终保留

### ToolExecutionResult

工具执行结果。

```typescript
interface ToolExecutionResult {
  ok: boolean;
  output: unknown;               // 成功时为工具返回值，失败时为 null
  error: string | null;          // 失败时的错误信息
  retryable: boolean;            // 是否可重试（仅 RetryableToolError 为 true）
  blocked: boolean;              // 是否被安全机制阻止
  attempts: number;              // 重试次数（首次为 1）
}
```

### TurnRecord

一轮完整记录（LLM 调用 + 工具执行 + 观察）。

```typescript
interface TurnRecord {
  turn: number;                  // 1-indexed
  goal: string;
  working_memory: Record<string, unknown>;
  llm_raw_output: unknown;
  llm_action: Record<string, unknown>;
  tool_result: Record<string, unknown> | null;
  observation: string;
}
```

### RunResult

一次完整运行的最终结果。

```typescript
interface RunResult {
  final_response: string;
  turns: TurnRecord[];
  stop_reason: string;           // "final_response" | "goal_reached" | "max_steps_reached" | "max_failures_reached" | "max_budget_reached" | "token_budget_exceeded" | "schema_error"
  log_path: string;
  snapshot_path: string | null;
  total_tokens: number;
}
```

## 异常类

```typescript
class RetryableToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableToolError";
  }
}

class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}
```
