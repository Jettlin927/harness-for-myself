# 模块 12: 项目记忆 (project_memory.py → project-memory.ts)

## 概述

基于文件系统的持久化跨会话记忆，每条记忆存为独立 JSON 文件。

---

## MemoryEntry

```typescript
interface MemoryEntry {
  key: string;
  content: string;
  source: string;          // 默认 ""
  created_at: string;      // ISO 8601
  tags: string[];           // 默认 []
}
```

## ProjectMemory 类

### 构造函数
```typescript
constructor(projectRoot: string)
```
- 创建 `{projectRoot}/.hau/memory/` 目录

### 方法

#### `save(key, content, options?): MemoryEntry`
- options: `{ source?: string, tags?: string[] }`
- 写入 `{memoryDir}/{key}.json`
- 覆盖同名文件（更新）
- 返回 MemoryEntry

#### `load(key): MemoryEntry | null`
- 文件不存在 → null
- JSON 损坏 → null（静默处理）

#### `search(query?, tags?): MemoryEntry[]`
- query: 内容子串匹配（大小写不敏感）
- tags: 标签交集过滤（至少一个匹配）
- 两者同时提供时为 AND 逻辑

#### `delete(key): boolean`
- 存在 → 删除返回 true
- 不存在 → false

#### `listAll(): MemoryEntry[]`
- 读取所有 .json 文件
- 按 created_at 降序排序（最新在前）
- 损坏文件静默跳过

#### `toContextString(maxEntries?): string`
- maxEntries 默认 10
- 格式：`"- key [tag1, tag2]: content"`
- 无记忆 → 空字符串

---

## 文件格式

`.hau/memory/test_command.json`:
```json
{
  "key": "test_command",
  "content": "pytest src/harness/tests/",
  "source": "session-abc123",
  "created_at": "2025-03-25T10:30:45.123456+00:00",
  "tags": ["workflow"]
}
```

---

## 测试覆盖要点

| 场景 | 预期 |
|------|------|
| save + load roundtrip | 所有字段正确 |
| load 不存在 | null |
| search by content | 子串匹配 |
| search by tags | 标签过滤 |
| search 两者组合 | AND 逻辑 |
| search 无参数 | 返回全部 |
| delete 存在 | true |
| delete 不存在 | false |
| listAll 排序 | 最新在前 |
| toContextString 格式 | `- key [tags]: content` |
| toContextString 空 | "" |
| toContextString maxEntries | 限制数量 |
| 同 key 覆盖写入 | 更新 tags |
| 目录自动创建 | 构造时创建 |
| 损坏 JSON | listAll/load 跳过 |
