# 演进计划：Minimal Agent Harness → 编程 Agent 工具

## Context

**现状：** 项目有完整的 agent loop（memory→llm→tool→observe→next turn）、schema 校验、错误处理、快照恢复、会话持久化、Rich TUI。架构扩展点清晰（`ToolDispatcher.register_tool()`、`BaseLLM` 子类、`RunConfig` 字段扩展）。

**核心差距：** 工具是玩具级的（echo/add/utc_now）；LLM 交互是"JSON-in-content"模式而非原生 tool_use；没有流式输出；没有权限控制。

**目标：** 变成一个能在真实项目中读代码、改代码、跑测试的编程 agent。

---

## Phase 1：编程工具（让 agent 能操作代码） ✅ 已完成

### 边界
- **输入：** 当前只有 echo/add/utc_now/write_text_file 四个玩具工具
- **输出：** agent 能读文件、改文件、跑 shell 命令
- **不做：** glob/grep/list_directory（bash 可以替代，Phase 1 不增加非必要工具）

### 最小必要工具集（3 个）

| 工具 | 必要性论证 | 砍掉的替代方案 |
|------|-----------|---------------|
| `read_file(path, offset?, limit?)` | **必须。** 不能读文件就不能编程。 | 无替代 |
| `edit_file(path, old_text, new_text)` | **必须。** 精确替换是安全编辑的基础，整文件覆写风险太高。 | write_file 可以但不安全 |
| `bash(command, timeout?)` | **必须。** 跑测试、git、安装依赖都需要 shell。同时覆盖了 glob/grep/ls 的需求。 | 无替代 |

**自问：能再精简吗？**
- glob 和 grep 作为独立工具？→ **砍。** `bash("find . -name '*.py'")`、`bash("grep -rn pattern .")` 够用。等发现 bash 方式有明显局限再加。
- list_directory？→ **砍。** `bash("ls -la path")` 完全等价。
- write_file？→ **保留现有 write_text_file 不动。** edit_file 覆盖多数场景，新建文件用 write_text_file。

### 隐患
1. **bash 是万能后门。** 能执行任意命令，Phase 3 的权限系统之前是巨大安全风险。→ **缓解：** Phase 1 先在 TUI 中加一个简单的 y/n 确认（不是完整权限系统，只是基础保护）。
2. **read_file 大文件撑爆上下文。** → **缓解：** 强制 limit 参数默认值（如 200 行），超出截断并提示。
3. **edit_file old_text 不唯一。** → **缓解：** 匹配到多处时报错，要求提供更多上下文。

### 改动范围
- **新建** `src/harness/coding_tools.py` — read_file、edit_file、bash 三个函数
- **扩展** `src/harness/tools.py` — 加 `register_coding_tools(dispatcher, config)` 辅助函数
- **扩展** `src/harness/agent.py` — RunConfig 加 `project_root: str` 和 `allow_bash: bool`
- **扩展** `src/harness/tui.py` — bash/edit 执行前简单 y/n 确认
- **修改** `src/harness/llm.py` — DeepSeekLLM._build_messages 的 system prompt 加入新工具签名
- **新建** `tests/test_coding_tools.py`

---

## Phase 2：原生 Tool Use + 单 Provider 升级 ✅ 已完成

### 边界
- **输入：** LLM 返回 JSON-in-content，由 schema.py 手动解析
- **输出：** 支持 Anthropic Claude API 的原生 tool_use，工具定义自动生成
- **不做：** 多 provider 支持（只加 Anthropic）、不做流式输出（Phase 3）

### 必要性论证
**自问：JSON-in-content 模式有什么问题？**
- DeepSeek 经常返回格式不对的 JSON → schema error → 浪费 turn
- 没有原生 tool_use 的模型，工具调用成功率显著低于有原生支持的模型
- Anthropic Claude 是最强编程模型之一，且有原生 tool_use
- 不升级这个，工具再多也没用——LLM 调不好

**自问：为什么只做 Anthropic 不做 OpenAI？**
- 目标是"像 Claude Code"，Claude 是自然选择
- 先做好一个 provider，稳定后再扩展。多 provider 是 Phase 5+ 的事
- 减少代码量和测试面

### 具体改动

1. **工具描述自动生成：** `ToolDispatcher` 新增 `get_tool_schemas() -> list[dict]` 方法，每个注册工具附带 JSON Schema 描述。`AnthropicLLM` 用这些 schema 构建 `tools` 参数。
2. **AnthropicLLM 适配器：** 实现 `BaseLLM.generate()`，使用 Anthropic Python SDK 的 `client.messages.create(tools=...)`，解析 `tool_use` content block。
3. **系统 prompt 抽出：** 从 `DeepSeekLLM._build_messages` 抽到独立函数，AnthropicLLM 和 DeepSeekLLM 共用。

### 隐患
1. **Anthropic SDK 引入重依赖。** → **缓解：** 作为 optional dependency (`pip install harness[anthropic]`)，不影响无 API key 的本地测试。
2. **tool_use 响应格式与现有 schema.py 不兼容。** → `parse_llm_action()` 需要适配两种格式（dict from JSON-in-content vs. Anthropic tool_use block）。不要做两套解析，而是在 AnthropicLLM.generate() 内部归一化为现有 dict 格式。
3. **成本失控。** Claude API 调用有成本。→ **缓解：** RunConfig 加 `max_tokens_budget`，每 turn 后累计 token 用量，超限停止。

### 改动范围
- **新建** `src/harness/anthropic_llm.py` — AnthropicLLM 类
- **扩展** `src/harness/tools.py` — ToolDispatcher 加工具 schema 注册和导出
- **扩展** `src/harness/agent.py` — RunConfig 加 `max_tokens_budget`
- **修改** `src/harness/llm.py` — 抽出共享 prompt 逻辑
- **扩展** `src/harness/cli.py` — `--provider anthropic` flag
- **扩展** `pyproject.toml` — optional dependency `anthropic`

---

## Phase 3：流式输出 + 权限系统

### 边界
- **输入：** TUI 是 spinner 等待模式；bash/edit 只有简单 y/n 确认
- **输出：** token 级流式渲染；结构化权限层级
- **不做：** 配置文件驱动的权限规则（过早抽象）、审计日志

### 3a. 流式输出

**必要性：** 用 Claude 生成代码时，一个 turn 可能 10-30 秒。spinner 模式下用户完全不知道发生了什么，体验极差。这不是锦上添花，是可用性的底线。

改动：
- `BaseLLM.generate()` 签名加 `on_token: Callable[[str], None] | None = None`
- `AnthropicLLM` 用 `client.messages.stream()` 实现
- `InteractiveSession` 实时渲染 token，替代 spinner
- DeepSeekLLM / ScriptedLLM 忽略 on_token（向后兼容）

### 3b. 权限系统

**自问：Phase 1 的简单 y/n 不够吗？**
- 对原型够了。但如果要实际使用，每次 bash 都确认太烦
- 需要"信任层级"：read 免确认，write 需确认，bash 需确认但可以设为自动

**最小权限模型（3 级）：**
- `ask`（默认）：每次 bash/edit/write 前确认
- `auto-edit`：文件读写自动执行，bash 仍需确认
- `yolo`：全部自动（用户自担风险）

通过 CLI `--trust auto-edit` 设置，不需要配置文件。

**自问：能再精简吗？**
- 路径级 allow/deny？→ **砍。** 先用全局层级，等用户反馈再细化。
- 命令黑名单？→ **砍。** 维护黑名单是无底洞。`ask` 模式下用户自己判断。
- 审计日志？→ **砍。** 现有 trajectory log（JSONL）已经记录了所有工具调用。

### 隐患
1. **流式 + 工具调用交错渲染。** Claude 可能先输出文本再输出 tool_use。需要处理 mixed content blocks。
2. **`yolo` 模式真的会有人用错。** → 加醒目警告："⚠ 所有操作将自动执行，不会请求确认"。
3. **权限检查插入点。** 必须在 `agent.py:_execute_tool_call()` 之前，且不能破坏现有的 on_turn 回调流。

### 改动范围
- **扩展** `src/harness/llm.py` — BaseLLM.generate() 加 on_token
- **修改** `src/harness/anthropic_llm.py` — 流式实现
- **扩展** `src/harness/tui.py` — 流式渲染 + 权限确认 UI
- **扩展** `src/harness/agent.py` — RunConfig 加 `trust_level`，run loop 加权限检查
- **扩展** `src/harness/cli.py` — `--trust` flag

---

## Phase 4：项目感知（让 agent 理解它在哪个项目里） ✅ 已完成

### 边界
- **输入：** agent 对项目一无所知，每次从零开始
- **输出：** 自动注入项目类型、git 状态、用户自定义指令
- **不做：** 跨会话持久化记忆（现有 session 机制够用）、记忆搜索工具

### 最小必要集

| 能力 | 必要性 | 砍掉的替代方案 |
|------|--------|---------------|
| `.hau/CONTEXT.md` 加载 | **必须。** 用户需要告诉 agent 项目约定（类似 CLAUDE.md）。没有这个，agent 每次都在猜。 | 无 |
| Git 状态注入（branch、staged changes） | **必须。** 编程 agent 不知道当前分支和改动状态就是盲人。 | bash("git status") 可以但浪费 turn |
| 项目类型检测 | **可选，但值很高。** 检测到 pyproject.toml → 知道用 pytest；检测到 package.json → 知道用 npm。几十行代码，大幅提升工具调用质量。 | 用户在 CONTEXT.md 里手写 |

**自问：跨会话记忆需要吗？**
- 现有 `SessionManager` 已经有 `accumulated_summary`，在同一 session 内有上下文延续。
- 持久化记忆（像 Claude Code 的 memory 系统）是 V2 特性。当前 CONTEXT.md + session 足够。
- **砍。**

### 隐患
1. **CONTEXT.md 过长撑爆上下文。** → 限制注入长度（如前 500 行），超出截断。
2. **git 状态在长对话中过时。** → 每个 turn 刷新太贵。折中：每次 `run()` 调用时刷新一次。
3. **项目检测误判。** 根目录有 package.json 但实际写 Python。→ 只注入检测结果，不强制行为。

### 改动范围
- **新建** `src/harness/context.py` — `load_project_context(root: Path) -> dict`
- **扩展** `src/harness/tui.py` — InteractiveSession.start() 加载上下文
- **扩展** `src/harness/cli.py` — cmd_run 加载上下文

---

## 阶段依赖 & 里程碑

```
Phase 1 (编程工具)     ✅ 完成 → coding_tools.py + TUI 确认 + CLI --project-root
    ↓
Phase 2 (原生 tool_use) ✅ 完成 → AnthropicLLM + tool schema + --provider/--model + token budget
    ↓
Phase 3 (流式+权限)     ✅ 完成 → 流式渲染 + ask/auto-edit/yolo 三级信任
    ↓
Phase 4 (项目感知)      ✅ 完成 → context.py + TUI/CLI 上下文注入 + 项目类型检测
```

**Phase 1 和 Phase 2 可以有限并行：** coding_tools.py 和 anthropic_llm.py 没有代码依赖，但 Phase 2 完成后需要集成测试（用 Claude 调编程工具）。

---

## 刻意不做的事（V2+）

| 功能 | 为什么现在不做 |
|------|---------------|
| 多 Provider (OpenAI/Ollama) | 先做好一个。多 provider 是抽象层，当前只有一个实现时是过度设计 |
| 子 Agent / 并行执行 | 单 agent 还没做好就做多 agent 是自找麻烦 |
| MCP 支持 | 协议复杂度高，当前内置工具就能覆盖需求 |
| Hooks 系统 | 可配置性应该在用户真正需要时才加 |
| 插件架构 | 同上，过早抽象 |
| 跨会话记忆搜索 | CONTEXT.md + session summary 够用 |
| 命令黑名单 / 路径级权限 | 全局信任层级足够，细粒度权限等用户反馈 |

---

## 验证方式

每个 Phase 完成后：
1. `make check` 通过（lint + test）
2. 新模块有对应单元测试（ScriptedLLM 驱动）
3. 手动端到端验证：

| Phase | 验证场景 |
|-------|---------|
| 1 | `harness chat` → "读取 src/harness/tools.py 第 10-20 行" → agent 用 read_file 返回内容 |
| 1 | `harness chat` → "在 tools.py 的 _echo 方法里加一行注释" → agent 用 edit_file 完成 |
| 2 | 用 `--provider anthropic` 重复 Phase 1 验证，确认 Claude 原生 tool_use 工作 |
| 3 | 验证 `--trust ask` 下 bash 命令弹出确认、`--trust auto-edit` 下文件操作自动执行 |
| 4 | 在项目根目录放 `.hau/CONTEXT.md`，验证 agent 首 turn 就知道项目约定 |
