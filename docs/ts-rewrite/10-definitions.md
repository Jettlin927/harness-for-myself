# 模块 10: 定义文件解析 (definitions.py → definitions.ts)

## 概述

解析 `.hau/agents/*.md` 和 `.hau/skills/*.md` 中的 YAML frontmatter + Markdown body。

---

## AgentDefinition

```typescript
interface AgentDefinition {
  name: string;                      // 模式: /^[a-z0-9-]+$/
  description: string;
  max_steps: number | null;          // null = 继承父 agent
  trust_level: TrustLevel | null;    // null = 继承父 agent
  tools: string[] | null;            // null = 所有工具
  system_instructions: string;       // Markdown body
}
```

## SkillDefinition

```typescript
interface SkillDefinition {
  name: string;
  description: string;
  body: string;                      // Markdown body / 指令模板
}
```

---

## 函数

### `parseDefinitionFile(path): [metadata, body]`

解析含 YAML frontmatter 的 .md 文件。

**规则：**
1. 首行 `---` 开始 frontmatter
2. 再遇 `---` 结束
3. 无 `---` → `({}, 全文)`
4. 有开头无结尾 → `({}, 全文)`
5. 结尾 `---` 后首个空行自动去除

**值解析 `parseValue()`：**
- `[a, b, c]` → `string[]`（按逗号分割，trim 每项）
- `[]` → `[]`
- 尝试 parseInt → `number`
- 其他 → `string`

### `loadAgentDefinitions(hauDir): AgentDefinition[]`
- 读取 `{hauDir}/agents/*.md`，按文件名排序
- 逐个解析 + 校验，无效跳过（warn）
- 目录不存在 → `[]`

### `loadSkillDefinitions(hauDir): SkillDefinition[]`
- 读取 `{hauDir}/skills/*.md`，按文件名排序
- 逐个解析 + 校验，无效跳过（warn）
- 目录不存在 → `[]`

### 校验规则

**Agent：**
- name 必填、非空、匹配 `[a-z0-9-]+`
- description 必填、非空
- trust_level（可选）：必须在 `{"ask", "auto-edit", "yolo"}` 中
- max_steps（可选）：正整数
- tools（可选）：数组

**Skill：**
- name 必填、非空
- description 必填、非空

---

## 文件格式示例

```markdown
---
name: test-runner
description: Runs tests and reports results
max_steps: 50
trust_level: auto-edit
tools: [bash, read_file, write_file]
---

Run the test suite and report any failures.
```

---

## 测试覆盖要点

| 场景 | 预期 |
|------|------|
| 完整 frontmatter | 所有字段解析 |
| Skill 格式 | name + description + body |
| 无 frontmatter | 空 metadata，全文为 body |
| 空 body | body = "" |
| 列表值 `[a, b]` | 解析为数组 |
| 整数值 `10` | 解析为 number |
| 多文件加载 | 按文件名排序 |
| 目录不存在 | 返回 [] |
| 无效 trust_level | 跳过 + 警告 |
| 缺少 name | 跳过 + 警告 |
