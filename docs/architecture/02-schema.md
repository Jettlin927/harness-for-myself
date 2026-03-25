# 模块 2: Schema 校验 (schema.py → schema.ts)

## 概述

严格校验 LLM 输出格式，拒绝任何不符合规范的输出。

## 函数

### `ensureDict(raw: unknown): Record<string, unknown>`

将原始输入规范化为字典。

**逻辑：**
1. 如果 `raw` 是对象（非 null、非数组），直接返回
2. 如果 `raw` 是字符串，尝试 `JSON.parse()`
   - 解析失败 → 抛出 `SchemaError("LLM output is not valid JSON: ...")`
   - 解析成功但不是对象 → 抛出 `SchemaError("Decoded JSON must be an object.")`
   - 解析成功且是对象 → 返回
3. 其他类型 → 抛出 `SchemaError("LLM output must be dict or JSON string, got: <type>")`

### `parseLLMAction(raw: unknown): LLMAction`

主校验入口。

**校验流程：**

1. 调用 `ensureDict(raw)` 得到 `payload`
2. 检查 `payload.type`：必须是 `"tool_call"` 或 `"final_response"`
   - 否则抛出 `SchemaError("Field 'type' must be 'tool_call' or 'final_response'.")`

3. **final_response 分支：**
   - `content` 必须是非空字符串（trim 后非空）
   - 否则抛出 `SchemaError("final_response requires non-empty string 'content'.")`

4. **tool_call 分支：**
   - `tool_name` 必须是非空字符串
   - `arguments` 必须是对象（即使空对象 `{}` 也可以）
   - 否则分别抛出对应 SchemaError

## 测试用例覆盖

| 场景 | 预期 |
|------|------|
| 合法 tool_call dict | 解析成功 |
| 合法 final_response JSON 字符串 | 解析成功 |
| `null` 输入 | SchemaError |
| JSON 数组 `"[]"` | SchemaError |
| 空白 content `"   "` | SchemaError |
| 缺少 tool_name | SchemaError |
| arguments 为 null | SchemaError |
| 非法 JSON 字符串 | SchemaError |
