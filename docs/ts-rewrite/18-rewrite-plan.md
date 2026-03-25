# HAU TypeScript 重写执行计划

## 原则

1. **功能完全对齐** — 每个 Python 模块都有 TS 对应，行为一致
2. **测试先行** — 每个 Phase 先写测试再写实现，确保 1:1 覆盖
3. **分层递进** — 从无依赖的底层模块开始，逐步构建到顶层
4. **每 Phase 独立可验证** — 完成一个 Phase 就跑通该 Phase 的所有测试

---

## Phase 0: 项目脚手架

**目标：** 建立 TS 项目结构、工具链、CI。

**产出：**
- `package.json`（name: hau, bin: harness）
- `tsconfig.json`（target: ES2022, strict: true）
- `vitest.config.ts`
- `.github/workflows/ci.yml`（lint + test + typecheck）
- `src/index.ts`（空壳）
- ESLint + Prettier 配置
- `.gitignore`

**依赖：**
```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.x",
    "chalk": "^5.x",
    "commander": "^12.x",
    "ora": "^8.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vitest": "^2.x",
    "eslint": "^9.x",
    "prettier": "^3.x",
    "@types/node": "^22.x"
  }
}
```

**验证：** `pnpm test` 空测试通过，`pnpm build` 编译成功。

---

## Phase 1: 类型 + Schema + 错误类

**对应 Python 模块：** `types.py`, `schema.py`
**产出文件：** `src/types.ts`, `src/schema.ts`
**测试文件：** `tests/schema.test.ts`

**依赖关系：** 无外部依赖，纯逻辑。

**关键实现：**
- ActionType, TrustLevel, LLMAction, ToolExecutionResult, TurnRecord, RunResult
- SchemaError, RetryableToolError
- ensureDict(), parseLLMAction()

**测试：** 8 个 schema 测试用例。

---

## Phase 2: 工具系统

**对应 Python 模块：** `tools.py`, `coding_tools.py`
**产出文件：** `src/tools.ts`, `src/coding-tools.ts`
**测试文件：** `tests/tools.test.ts`, `tests/coding-tools.test.ts`

**依赖：** Phase 1（types）

**关键实现：**
- ToolDispatcher 类（注册、路由、执行）
- 4 个内置工具（echo, add, utc_now, write_text_file）
- 7 个编程工具（read_file, edit_file, write_file, run_bash, glob_files, grep_search, list_directory）

**TS 差异点：**
- `subprocess.run` → `child_process.execSync` 或 `execa`
- `Path.glob` → `glob` npm 包
- `re.compile` → `new RegExp()`
- `difflib.unified_diff` → `diff` npm 包

**测试：** 23 + 47 = 70 个测试用例。

---

## Phase 3: 内存管理 + 日志

**对应 Python 模块：** `memory.py`, `logger.py`
**产出文件：** `src/memory.ts`, `src/logger.ts`
**测试文件：** `tests/memory.test.ts`

**依赖：** Phase 1（types）

**关键实现：**
- MemoryManager（buildWorkingMemory, maybeCompress, summarizeRun）
- 观察截断、标记提取
- TrajectoryLogger（JSONL 追加写入）

**测试：** 12 个测试用例。

---

## Phase 4: 停止控制 + 错误策略

**对应 Python 模块：** `stop_controller.py`, `error_policy.py`
**产出文件：** `src/stop-controller.ts`, `src/error-policy.ts`
**测试文件：** 内联于 reliability 测试

**依赖：** Phase 1（types）

**关键实现：**
- StopController（checkBeforeTurn, checkAfterFailure, checkGoalReached）
- ErrorPolicy（shouldRetryTool）

---

## Phase 5: 快照 + 会话 + 配置

**对应 Python 模块：** `snapshot.py`, `session.py`, `config.py`
**产出文件：** `src/snapshot.ts`, `src/session.ts`, `src/config.ts`
**测试文件：** `tests/snapshot.test.ts`, `tests/session.test.ts`, `tests/config.test.ts`

**依赖：** Phase 1（types）

**关键实现：**
- SnapshotStore（原子写入 .tmp → rename）
- SessionManager（CRUD + summary 构建）
- StrategyConfig（加载、校验、toRunConfig）

**TS 差异点：**
- `os.replace` → `fs.renameSync`（Node.js 的 rename 在同文件系统上是原子的）

**测试：** 4 + 18 + 8 = 30 个测试用例。

---

## Phase 6: LLM 基类 + 测试桩

**对应 Python 模块：** `llm.py`（BaseLLM, ScriptedLLM, RuleBasedLLM, DeepSeekLLM, buildSystemPrompt）
**产出文件：** `src/llm.ts`
**测试文件：** `tests/deepseek.test.ts`

**依赖：** Phase 1（types）, Phase 2（tools, for schemas）

**关键实现：**
- BaseLLM 抽象类
- ScriptedLLM（测试必须）
- RuleBasedLLM
- DeepSeekLLM（HTTP transport 可注入）
- buildSystemPrompt()

**TS 差异点：**
- `urllib.request` → `fetch`（Node 18+ 原生）
- `getpass` → `readline` 交互提示
- `generate()` 返回 `Promise`（异步）

**测试：** 15 个测试用例。

---

## Phase 7: Anthropic 适配器

**对应 Python 模块：** `anthropic_llm.py`
**产出文件：** `src/anthropic-llm.ts`
**测试文件：** `tests/anthropic-llm.test.ts`

**依赖：** Phase 6（BaseLLM）

**关键实现：**
- AnthropicLLM（_buildMessages 是核心难点）
- 流式 token 输出
- 重试逻辑
- 消息格式：role 交替、tool_use/tool_result block、Turn 编号注入

**测试：** 29 个测试用例（最复杂的测试集）。

---

## Phase 8: Agent 核心循环

**对应 Python 模块：** `agent.py`
**产出文件：** `src/agent.ts`
**测试文件：** `tests/smoke.test.ts`, `tests/agent.test.ts`, `tests/reliability.test.ts`, `tests/permissions.test.ts`

**依赖：** Phase 1-7 全部

**关键实现：**
- RunConfig
- HarnessAgent（run, resume, 主循环）
- 审批系统（_needsApproval）
- 危险工具指纹缓存
- Schema 重试
- Token 预算追踪

**这是最关键的 Phase** — 所有子系统在此汇合。

**测试：** 4 + 4 + 20 + 14 = 42 个测试用例。

---

## Phase 9: 定义文件 + 子 Agent + 项目记忆

**对应 Python 模块：** `definitions.py`, `subagent.py`, `project_memory.py`
**产出文件：** `src/definitions.ts`, `src/subagent.ts`, `src/project-memory.ts`
**测试文件：** `tests/definitions.test.ts`, `tests/subagent.test.ts`, `tests/project-memory.test.ts`

**依赖：** Phase 8（agent）

**关键实现：**
- Frontmatter 解析器
- AgentDefinition / SkillDefinition 校验
- SubAgentSpawner + trust 层级解析
- createUseSkillCallable
- ProjectMemory（文件系统存储）

**测试：** 15 + 16 + 15 = 46 个测试用例。

---

## Phase 10: 项目上下文

**对应 Python 模块：** `context.py`
**产出文件：** `src/context.ts`
**测试文件：** `tests/context.test.ts`

**依赖：** Phase 9（definitions, project-memory）

**关键实现：**
- loadProjectContext
- 语言/包管理器/工具链检测
- Git 状态读取
- .hau/CONTEXT.md 加载

**测试：** 31 个测试用例。

---

## Phase 11: CLI + TUI + Eval

**对应 Python 模块：** `cli.py`, `tui.py`, `eval.py`
**产出文件：** `src/cli.ts`, `src/tui.ts`, `src/eval.ts`
**测试文件：** `tests/skills.test.ts`（skill 展开逻辑在 TUI 中）

**依赖：** Phase 8-10 全部

**关键实现：**
- commander 子命令
- 交互式 REPL（readline）
- Turn 渲染（chalk 着色）
- Spinner（ora）
- 审批交互
- EvalRunner

**测试：** 7 + 额外 E2E 测试。

---

## Phase 12: 发布

**产出：**
- `src/index.ts` — 公开 API（对应 `__init__.py` 的 `__all__`）
- `README.md` 更新
- `CHANGELOG.md`
- `npm publish` 到 npm registry

**验证：**
- `npx hau chat` 端到端测试
- `pnpm test` 全部 221+ 用例通过
- `pnpm build` 无错误
- CI green

---

## 依赖关系图

```
Phase 0: 脚手架
    ↓
Phase 1: types + schema
    ↓
  ┌────────┬──────────┐
Phase 2   Phase 3   Phase 4
 tools     memory   stop/error
  └────────┼──────────┘
           ↓
       Phase 5: snapshot + session + config
           ↓
       Phase 6: LLM 基类
           ↓
       Phase 7: Anthropic 适配器
           ↓
       Phase 8: ★ Agent 核心循环 ★
           ↓
       Phase 9: definitions + subagent + memory
           ↓
       Phase 10: context
           ↓
       Phase 11: CLI + TUI + eval
           ↓
       Phase 12: 发布
```

---

## 风险点

| 风险 | 缓解 |
|------|------|
| `_buildMessages` 格式复杂 | Phase 7 有 29 个测试覆盖 |
| subprocess 行为差异 | run_bash 用 `child_process.execSync`，超时用 `timeout` 参数 |
| 原子写入 | `fs.renameSync` 在同文件系统原子 |
| glob 行为差异 | 用 `glob` npm 包，测试覆盖边界 |
| unified diff | 用 `diff` npm 包，对比输出格式 |
| 流式输出 | Anthropic TS SDK 原生支持 stream |

---

## 每 Phase 验收标准

1. 所有对应测试通过（`pnpm test`）
2. TypeScript 编译无错误（`pnpm build`）
3. ESLint 无警告（`pnpm lint`）
4. 代码提交并 CI green
