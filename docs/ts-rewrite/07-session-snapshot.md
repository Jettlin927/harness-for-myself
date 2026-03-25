# 模块 7: 会话与快照 (session.py + snapshot.py → session.ts + snapshot.ts)

## 概述

会话管理跨 run 状态持久化；快照管理每轮状态原子写入，支持断点续跑。

---

## SessionState

```typescript
interface SessionState {
  session_id: string;                      // UUID
  created_at: string;                      // ISO 8601
  goals_completed: GoalRecord[];
  accumulated_summary: string;             // 跨 goal 压缩摘要
  last_snapshot_path: string | null;
}

interface GoalRecord {
  goal: string;
  stop_reason: string;
  turns: number;
  timestamp: string;                       // ISO 8601
}
```

## SessionManager 类

### 构造函数
```typescript
constructor(sessionDir?: string)  // 默认 ~/.harness/sessions/
```
- 自动创建目录

### 方法

#### `loadOrCreate(sessionId?): SessionState`
- 有 sessionId 且文件存在 → 加载
- 否则创建新 session（UUID + 当前时间戳）

#### `latest(): SessionState | null`
- 按文件修改时间排序，返回最新，空目录返回 null

#### `listSessions(): SessionState[]`
- 所有 .json 文件，按修改时间降序

#### `update(state, goal, stopReason, turns, snapshotPath?): SessionState`
- 追加 GoalRecord（含当前时间戳）
- 刷新 `accumulated_summary`（最近 5 条 goal 摘要）
- 更新 `last_snapshot_path`
- **原地修改** state 并返回

#### `save(state): string`
- 写入 `{sessionDir}/{sessionId}.json`
- JSON 格式，indent=2

#### `delete(sessionId): boolean`
- 存在则删除返回 true，否则 false

### 内部方法

#### `_buildSummary(goals): string`
- 取最近 `MAX_SUMMARY_ENTRIES`（5）条
- 格式：`[Past goal {i}: <goal前80字符>] stop=<reason> turns=<count>`

### 常量
- `DEFAULT_SESSION_DIR = ~/.harness/sessions/`
- `MAX_SUMMARY_ENTRIES = 5`

---

## SnapshotStore 类

### 构造函数
```typescript
constructor(snapshotDir: string)
```
- 确保目录存在

### 方法

#### `save(state): string`
- 生成时间戳文件名：`snapshot-YYYYMMDD-HHMMSS-ffffff.json`
- **原子写入**：先写 `.tmp` 文件，再 `fs.renameSync` 到目标路径
- 序列化 `state.turns` 中的 TurnRecord 为普通对象
- 返回文件路径

#### `load(path): SnapshotState`
- 文件不存在 → 抛出 ValueError
- JSON 解析失败 → 抛出 ValueError "corrupted (invalid JSON)"
- 非对象 → 抛出 ValueError
- 反序列化 turns 数组中的每个对象为 TurnRecord
- 确保 `dangerous_tool_signatures` 为数组
- TurnRecord 构造失败 → 抛出 ValueError "invalid turn data"

```typescript
interface SnapshotState {
  goal: string;
  context: Record<string, unknown>;
  turns: TurnRecord[];
  summary: string;
  failure_count: number;
  budget_used: number;
  dangerous_tool_signatures: string[];
}
```

---

## 文件格式

### Session JSON
```json
{
  "session_id": "uuid",
  "created_at": "2025-03-25T...",
  "goals_completed": [
    { "goal": "...", "stop_reason": "goal_reached", "turns": 12, "timestamp": "..." }
  ],
  "accumulated_summary": "...",
  "last_snapshot_path": "/path/to/snapshot.json"
}
```

### Snapshot JSON
```json
{
  "goal": "...",
  "context": {},
  "turns": [ { "turn": 1, "goal": "...", ... } ],
  "summary": "...",
  "failure_count": 0,
  "budget_used": 2,
  "dangerous_tool_signatures": []
}
```

---

## 测试覆盖要点

### Session (18 cases)
- 新建/加载/不存在 ID 行为
- latest 空目录/多会话
- update 追加 goal + summary + snapshot_path
- summary 条目上限（5）
- save 创建文件 + roundtrip 验证
- delete 存在/不存在
- list 多会话排序

### Snapshot (4 cases)
- save 原子性（无 .tmp 残留）
- load 损坏 JSON 报错
- load 不存在文件报错
- roundtrip 完整性（goal, context, turns, summary, counters, signatures）
