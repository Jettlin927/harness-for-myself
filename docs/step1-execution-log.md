# Step 1 执行记录（Run Loop MVP）

## 执行日期
- 2026-03-24

## 已完成能力（Step 1 原始交付）
- 单 agent 自循环：`memory -> llm -> tool/final -> observe -> next turn`
- 严格输出 schema 校验：仅接受 `tool_call` 或 `final_response`
- schema 失败回退：单轮内自动重试一次并带上结构反馈
- 单轮单工具调用（通过 action schema 和 loop 结构约束）
- 外部轨迹日志：每轮 JSONL 落盘
- 基础工作记忆：`goal/context/history/summary_memory`
- 上下文压缩雏形：历史过长时生成摘要记忆
- 最小工具集：`echo`、`add`、`utc_now`

> **当前状态（截至 Phase 2 完成）：** 工具集已扩展为 echo、add、utc_now、write_text_file、read_file、edit_file、bash。LLM 后端支持 RuleBasedLLM、DeepSeekLLM、AnthropicLLM（原生 tool_use）。测试从 3 个增长到 76 个。

## 代码落点（Step 1 原始模块）
- `src/harness/agent.py`: 主循环
- `src/harness/schema.py`: LLM 输出解析与校验
- `src/harness/tools.py`: 工具路由与执行
- `src/harness/logger.py`: 轨迹日志
- `src/harness/memory.py`: 工作记忆与压缩
- `src/harness/llm.py`: RuleBased + Scripted LLM stub
- `scripts/run_mvp.py`: 本地 CLI 演示入口
- `tests/test_smoke.py`: smoke tests（3 项）

> **当前模块（截至 Phase 2）：** 新增 `coding_tools.py`（read_file/edit_file/bash）、`anthropic_llm.py`（Anthropic 原生 tool_use）、`cli.py`（统一 CLI）、`tui.py`（交互式 TUI）、`eval.py`（批量评估）、`config.py`（策略版本化）、`session.py`（会话持久化）。测试文件 9 个，共 76 个测试用例。

## 验证结果
- 测试命令：`python3 -m unittest discover -s tests -p "test_*.py"`
- 结果：`Ran 3 tests ... OK`
- 演示命令：`python3 scripts/run_mvp.py "please add numbers"`
- 结果：2 个 turn 内完成 tool->final 收敛，并生成轨迹日志。

## 与 Step 1 验收标准对照
- 工具调用后继续推理并收敛：已满足
- 每轮日志可追踪且字段完整：已满足
- 有终止边界（max_steps）：已满足

## 当前限制（留给 Step 2）— ✅ 已全部解决
- ~~错误分流仍较粗（尚未区分 retryable / non-retryable）~~ → Step 2：`error_policy.py` + `RetryableToolError`
- ~~停止条件仍最小化（未纳入 budget/failure policies）~~ → Step 2：`stop_controller.py`（max_budget / max_failures / goal_reached）
- ~~摘要压缩策略是规则型雏形，尚未”关键信息保真”~~ → Step 2：保留 constraint/todo/evidence 标签
- ~~仅本地 stub LLM，无真实模型客户端抽象~~ → Phase 1-2：DeepSeekLLM + AnthropicLLM（原生 tool_use）
