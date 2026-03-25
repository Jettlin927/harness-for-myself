# 模块 16: 评估 (eval.py → eval.ts)

## 概述

离线回归评估框架，支持内置用例和自定义 JSON 用例。

---

## 数据类型

```typescript
interface EvalCase {
  id: string;
  goal: string;
  context?: Record<string, unknown>;     // 默认 {}
  expected_stop_reason?: string;
  expected_keywords?: string[];           // 默认 []
}

interface EvalCaseResult {
  id: string;
  passed: boolean;
  stop_reason: string;
  turns: number;
  final_response: string;
  failures: string[];                     // 空 = 通过
  duration_s: number;
}

interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;                      // 0.0-1.0
  avg_turns: number;
  avg_duration_s: number;
  results: EvalCaseResult[];
  config_version: string;                 // 默认 "unversioned"
}
```

---

## 内置用例

```typescript
const BUILTIN_CASES: EvalCase[] = [
  { id: "add_numbers", goal: "please add numbers", expected_stop_reason: "final_response", expected_keywords: ["5"] },
  { id: "get_time", goal: "what is the current time", expected_stop_reason: "final_response", expected_keywords: [] },
  { id: "direct_answer", goal: "hello world", expected_stop_reason: "final_response", expected_keywords: [] },
];
```

---

## EvalRunner 类

### 构造函数
```typescript
constructor(agent: HarnessAgent)
```

### 方法

#### `run(cases, configVersion?): EvalReport`
- 顺序执行所有用例
- 聚合 pass/fail 统计
- 计算平均 turns 和 duration

#### `_runCase(case): EvalCaseResult`
- 计时 `agent.run()`
- 校验 `expected_stop_reason` 匹配
- 校验所有 `expected_keywords` 在 final_response 中出现（大小写不敏感）
- 返回结果 + 失败原因列表

---

## 测试覆盖要点

| 场景 | 预期 |
|------|------|
| config_version 传入 | report 包含 |
| config_version 缺省 | "unversioned" |
