# 模块 13: 日志 (logger.py → logger.ts)

## 概述

JSONL 格式的轨迹日志，每轮追加一行。

---

## TrajectoryLogger 类

### 构造函数
```typescript
constructor(logDir: string)
```
- 创建 `logDir` 目录
- 生成文件名：`trajectory-YYYYMMDD-HHMMSS-ffffff.jsonl`
- 设置 `path` 属性

### 方法

#### `append(record: TurnRecord): void`
- 序列化 TurnRecord 为 JSON 对象
- 追加为一行 JSON + 换行符
- UTF-8 编码

---

## 文件格式

每行一个 JSON 对象：
```jsonl
{"turn":1,"goal":"...","working_memory":{...},"llm_raw_output":{...},"llm_action":{...},"tool_result":{...},"observation":"..."}
{"turn":2,...}
```

---

## TS 实现注意

- 使用 `fs.appendFileSync` 或流式写入
- 时间戳格式需包含微秒（可用 `Date.now()` + 补零）
- 确保 JSON.stringify 不含换行符（单行）
