# 模块 8: 配置 (config.py → config.ts)

## 概述

版本化策略配置，支持 A/B 对比评估。

---

## StrategyConfig

```typescript
interface StrategyConfig {
  version: string;                    // 默认 "v1.0"
  description: string;               // 默认 ""
  max_steps: number;                  // 默认 8
  max_budget: number | null;          // 默认 null
  max_failures: number | null;        // 默认 3
  max_history_turns: number;          // 默认 8
  goal_reached_token: string | null;  // 默认 null
}
```

### 静态方法

#### `StrategyConfig.default(): StrategyConfig`
- 返回基线配置

#### `StrategyConfig.load(path: string): StrategyConfig`
- 从 JSON 文件加载
- 未知字段 → 抛出 ValueError
- 缺失字段 → 使用默认值

### 实例方法

#### `toRunConfig(): RunConfig`
- 映射字段到 RunConfig
- 忽略 `version` 和 `description`

#### `toDict(): Record<string, unknown>`
- 序列化为普通对象

---

## 配置文件格式

```json
{
  "version": "v1.0",
  "description": "Baseline strategy",
  "max_steps": 20,
  "max_budget": null,
  "max_failures": 3,
  "max_history_turns": 8,
  "goal_reached_token": null
}
```

---

## 测试覆盖要点

| 场景 | 预期 |
|------|------|
| default() | version="v1.0" |
| 完整 JSON 加载 | 所有字段正确 |
| 部分 JSON | 缺失字段用默认值 |
| 含未知字段 | 抛出 ValueError |
| toRunConfig 映射 | 字段一一对应 |
