# 模块 5: 内存管理 (memory.py → memory.ts)

## 概述

管理 LLM 每轮接收的工作记忆滚动窗口，自动压缩旧历史为摘要字符串，保留标记观察。

---

## MemoryManager 类

### 构造函数

```typescript
constructor(maxHistoryTurns: number = 8)
```

- `maxHistoryTurns`：保留在工作记忆中的最近轮次数
- `summary: string`：压缩摘要（跨轮次累积）

### 方法

#### `buildWorkingMemory(goal, context, turns): WorkingMemory`

构建每轮发送给 LLM 的工作记忆字典。

**行为：**
- 取 `turns` 最后 `maxHistoryTurns` 条
- 截断每条 observation 至 `MAX_OBSERVATION_CHARS`（2000 字符）
- 截断 tool_result 中的长内容
- 返回：

```typescript
interface WorkingMemory {
  goal: string;
  context: Record<string, unknown>;
  summary_memory: string;       // 压缩摘要
  history: HistoryEntry[];      // 最近 N 轮
}

interface HistoryEntry {
  turn: number;
  action: Record<string, unknown>;
  observation: string;
  tool_result: Record<string, unknown> | null;
}
```

#### `maybeCompress(turns, maxTotalTurns?): boolean`

当历史超过阈值时触发压缩。

**逻辑：**
- 阈值 = `maxTotalTurns ?? (maxHistoryTurns + 4)`
- `turns.length <= 阈值` → 返回 false
- 否则从旧轮次中提取标记观察，更新 `summary`，返回 true
- **不修改 turns 列表**，仅更新 `this.summary`

**摘要格式：**
```
Constraints: c1; c2; ... || Open items: t1; t2; ... || Evidence: e1; e2; ... || Recent compressed history: turn N: obs | turn N+1: obs | ...
```

#### `summarizeRun(goal, turns, stopReason): string`

跨 goal 的简洁摘要（用于 SessionManager）。

**格式：**
```
[Goal: <goal前80字符>] stop=<reason> turns=<count> constraints: <...> evidence: <...>
```
- constraints 和 evidence 各最多 3 条

### 辅助函数

#### `truncateStr(text, limit): string`
- 超出 limit 时截断并追加 `\n[observation truncated at {limit} chars]`

#### `truncateToolResult(result): Record`
- 浅拷贝 result
- 如果 `result.output.content` 是字符串 → 截断
- 如果 `result.output` 是字符串 → 截断
- 不修改原对象

#### `extractTaggedObservations(turns, prefix): string[]`
- 静态方法
- 从 observation 中提取以 prefix 开头的行（如 "constraint:"、"todo:"、"evidence:"）
- 大小写不敏感、去重

### 常量

- `MAX_OBSERVATION_CHARS = 2000`

---

## 测试覆盖要点

| 场景 | 预期 |
|------|------|
| 3 轮 + maxHistoryTurns=2 | 返回最后 2 轮 |
| 空 turns | 空 history + 空 summary |
| 边界不压缩（阈值=7，7 轮） | 返回 false |
| 超过阈值（8 轮） | 触发压缩 |
| 3000 字符 observation | 截断至 2000 |
| 短 observation | 不截断 |
| tool_result.output 字符串截断 | 截断 |
| tool_result.output.content 截断 | 嵌套截断 |
| 非 dict tool_result | 不变 |
