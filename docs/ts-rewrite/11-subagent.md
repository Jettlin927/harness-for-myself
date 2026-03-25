# 模块 11: 子 Agent (subagent.py → subagent.ts)

## 概述

子 Agent 生成工厂，支持 spawn_agent 和 use_skill 两个工具。

---

## Trust 层级解析

```typescript
const TRUST_ORDER: Record<TrustLevel, number> = {
  "ask": 0,
  "auto-edit": 1,
  "yolo": 2
};

function resolveTrust(parent: TrustLevel, child: TrustLevel | null): TrustLevel
```

- child 为 null → 继承 parent
- child 优先级 > parent → 降级为 parent（子 agent 权限不能超过父）
- child 优先级 <= parent → 使用 child

---

## SubAgentSpawner 类

### 构造函数

```typescript
constructor(
  parentConfig: RunConfig,
  parentLlm: BaseLLM,
  agentDefinitions: AgentDefinition[],
  projectContext?: Record<string, unknown>
)
```

### 方法

#### `setApproveCallback(onApprove): void`
- 设置审批回调，转发给子 agent

#### `__call__(arguments): SpawnResult`（作为工具注册）

参数：
- `goal: string`（必填，非空）
- `agent?: string`（可选，agent 定义名）
- `max_steps?: number`（可选，覆盖步数上限）

流程：
1. 校验 goal 非空
2. 查找 agent 定义（名称不存在则报错）
3. 构建子 RunConfig
4. 创建子 HarnessAgent
5. 执行 `child.run(goal, projectContext, { onApprove })`
6. 返回 `{ final_response, stop_reason, turns }`

```typescript
interface SpawnResult {
  final_response: string;
  stop_reason: string;
  turns: number;
}
```

#### `_buildChildConfig(definition?, arguments): RunConfig`
- trust_level: `resolveTrust(parent, child定义)`
- max_steps: 定义值 > 参数值 > 父值（优先级递增）
- agent_depth: parent + 1
- 其他字段全部继承 parent

#### `_createChildAgent(config, definition?): HarnessAgent`
- 创建 agent 实例
- 如果定义有 tools 白名单 → 过滤子 agent 的工具集

---

## createUseSkillCallable 工厂函数

```typescript
function createUseSkillCallable(
  skillDefinitions: SkillDefinition[]
): (arguments: Record<string, unknown>) => SkillResult
```

参数：`{ name: string }`
返回：`{ skill: string, instructions: string }`
未知 skill → ValueError，列出可用名称

---

## 深度限制

- `agent_depth` 在每次 spawn 时 +1
- `agent_depth >= 3` 时不注册 spawn_agent 工具（防止无限递归）

---

## 测试覆盖要点

| 场景 | 预期 |
|------|------|
| ask + yolo child | trust 降级为 ask |
| yolo + auto-edit child | 使用 auto-edit |
| child trust=null | 继承 parent |
| 指定 agent 名 spawn | 正常运行 |
| 不指定 agent 名 | 直接 spawn |
| 未知 agent 名 | ValueError |
| 空 goal | ValueError |
| tools 白名单 | 子 agent 仅有白名单工具 |
| depth=3 | 不注册 spawn_agent |
| depth=2 | 注册 spawn_agent |
| use_skill 正常 | 返回 skill 指令 |
| use_skill 未知名 | ValueError |
| use_skill 空名 | ValueError |
