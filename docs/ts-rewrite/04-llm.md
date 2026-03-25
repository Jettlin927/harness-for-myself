# 模块 4: LLM 基类与适配器 (llm.py + anthropic_llm.py → llm.ts + anthropic-llm.ts)

## 概述

LLM 抽象层，支持多后端（Anthropic、DeepSeek、规则引擎、脚本驱动测试桩）。

---

## BaseLLM 抽象类

```typescript
abstract class BaseLLM {
  onToken?: (token: string) => void;
  abstract generate(workingMemory: Record<string, unknown>): Promise<Record<string, unknown>>;
  setToolSchemas?(schemas: ToolSchema[]): void;
}
```

---

## buildSystemPrompt 函数

```typescript
function buildSystemPrompt(
  toolNames: string[],
  options?: {
    nativeToolUse?: boolean;           // Anthropic 时为 true
    extraSystemInstructions?: string;  // 附加指令
  }
): string
```

**生成的 prompt 结构：**

1. **角色定义**：编程 agent，自主完成任务
2. **输出格式**：
   - `nativeToolUse=true` → 简洁指引（SDK 处理格式）
   - `nativeToolUse=false` → 明确 JSON 格式规范
3. **可用工具列表**
4. **工作流策略**：Discover → Understand → Modify → Verify
5. **最小变更原则**
6. **错误恢复策略**
7. **上下文标记**：`constraint:`、`todo:`、`evidence:`
8. **安全边界**：禁止破坏性命令
9. **条件段落**（按工具名判断是否包含）：
   - `save_memory`/`recall_memory` 在工具列表 → 记忆说明
   - `spawn_agent` 在工具列表 → 子 Agent 说明
   - `use_skill` 在工具列表 → Skill 说明
10. **附加指令**（如有）

---

## ScriptedLLM（测试桩）

```typescript
class ScriptedLLM extends BaseLLM {
  constructor(script: Record<string, unknown>[]);
  generate(workingMemory): Promise<Record<string, unknown>>;
}
```

- 按顺序返回 `script[index]`，耗尽后返回 fallback `final_response`
- 忽略 workingMemory 参数
- 用于单元测试的确定性驱动

---

## RuleBasedLLM（规则引擎）

```typescript
class RuleBasedLLM extends BaseLLM {
  generate(workingMemory): Promise<Record<string, unknown>>;
}
```

- 按 goal 关键词匹配（大小写不敏感）：
  - "add"/"sum" → 第一轮调用 add 工具，第二轮 final_response
  - "time" → 第一轮调用 utc_now，第二轮 final_response
  - 其他 → 直接 final_response

---

## DeepSeekLLM

```typescript
class DeepSeekLLM extends BaseLLM {
  constructor(options?: {
    apiKey?: string;
    model?: string;        // 默认 "deepseek-chat"
    baseUrl?: string;      // 默认 "https://api.deepseek.com"
    envPath?: string;
    transport?: Function;  // 可注入，用于测试
  });
}
```

**API Key 解析顺序：**
1. 构造函数参数
2. 环境变量 `DEEPSEEK_API_KEY`
3. `.env` 文件读取
4. 交互式提示输入 → 写入 `.env`

**请求格式：** `POST {baseUrl}/chat/completions`
- temperature: 0.1
- messages: `[system, user]` 格式

**响应解析：**
- JSON 对象 → 直接返回
- 非 JSON 文本 → 包装为 `{ type: "final_response", content: text }`

**重试逻辑：** 最多 2 次重试（共 3 次尝试）
- HTTP 429、5xx → 可重试
- HTTP 4xx（非 429）→ 不可重试
- 含 "request failed" → 可重试
- 退避：2^attempt 秒（1s, 2s）

---

## AnthropicLLM

```typescript
class AnthropicLLM extends BaseLLM {
  constructor(options?: {
    apiKey?: string;
    model?: string;        // 默认 "claude-sonnet-4-20250514"
    toolSchemas?: ToolSchema[];
  });
  extraInstructions: string;  // 默认空字符串
}
```

**API Key 解析顺序：**
1. 构造函数参数
2. 环境变量 `ANTHROPIC_API_KEY`
3. `.env` 文件读取
4. 未找到 → 抛出 ValueError（不提示输入）

**请求参数：**
- `model`, `system` (prompt), `messages`, `max_tokens: 4096`
- 有 tool_schemas 时附加 `tools` 参数

**消息构建 `_buildMessages()`：**

关键约束：Anthropic API 要求严格的 **role 交替**（user → assistant → user → ...）

1. **首条 user 消息**：Goal + Context + Summary + (空历史时的 schema_feedback)
2. **历史 tool_call 轮次**：
   - assistant: `[{ type: "text", text: "[Step N]" }, { type: "tool_use", id, name, input }]`
   - user: `[{ type: "tool_result", tool_use_id, content: JSON字符串 }]`
3. **历史 final_response 轮次**：
   - 如果上一条也是 assistant → 插入桥接 user 消息 "Acknowledged. Continue."
   - assistant: `"[Step N] content"`
4. **末尾续接**：如果最后是 assistant，追加 user "Continue with the next step."

**响应解析 `_parseResponse()`：**
- 遍历 content blocks
- `tool_use` block → 解析为 tool_call（优先级最高）
- `text` block → 解析为 final_response
- 提取 `_usage: { input_tokens, output_tokens, total_tokens }`

**流式输出：**
- `onToken` 回调存在时使用 `messages.stream()` 而非 `.create()`
- 监听 `content_block_delta` 事件，提取 text delta

**重试逻辑：** 与 DeepSeek 相同（2 次重试，指数退避）
- `APIConnectionError`、`APITimeoutError` → 可重试
- `RateLimitError` → 可重试
- `APIStatusError` 且 status >= 500 → 可重试

---

## 测试覆盖要点

### DeepSeek (15 cases)
- API key 多来源解析
- 响应解析（JSON + 纯文本）
- 动态工具名注入
- 重试逻辑（暂时性 vs 永久性错误）

### Anthropic (29 cases)
- tool_use / text / 混合 block 解析
- tool_schemas 传递
- 流式 token 收集
- 多轮消息格式（role 交替、桥接消息）
- Turn 编号注入 `[Step N]`
- schema_feedback 注入
- usage token 追踪
- 网络重试
- SDK 缺失时 ImportError
