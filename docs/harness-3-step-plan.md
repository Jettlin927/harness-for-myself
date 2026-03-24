# Harness 三步实施计划

## 规划原则
- 先跑通，再稳住，最后可运营。
- 每一步都要有可演示产物，不跳步。
- 新增能力必须可验证（日志、指标、回归任务）。

## Step 1: 可跑闭环（Run Loop MVP）

### 目标
构建一个最小可运行 harness，完成单轮到多轮的基础自循环。

### 范围（只做这些）
- 单 agent。
- 单模型调用入口。
- 单轮仅允许一个工具调用（或直接 final）。
- 结构化工作记忆（goal/context/history）。
- 结构化 LLM 输出 schema（`final_response` / `tool_call`）。
- 外部轨迹日志（按轮次记录输入、输出、工具结果）。

### 不做（刻意延后）
- 多 agent 协作。
- 复杂规划器（长链任务拆解）。
- 自动策略优化。

### 交付物
- `loop` 主流程实现（可持续循环直到结束）。
- `tool dispatcher`（最小工具路由）。
- `trajectory logger`（JSONL 或同等格式）。
- 一组最小 smoke 用例（至少 3 个任务）。

### 验收标准
- 能稳定完成“工具调用后继续推理并收敛为 final”。
- 每轮都有可追踪日志，且字段完整。
- 在限定步数内可终止，不会无限循环。

### 风险与控制
- 风险：LLM 输出漂移导致解析失败。
- 控制：严格 schema 校验 + 失败回退（要求模型重答一次）。

## Step 2: 稳定性护栏（Reliability Layer）

### 目标
让 harness 在真实任务中可控、可恢复、可降级。

### 范围
- 停止条件：`goal_reached`、`max_steps`、`max_budget`、`max_failures`。
- 错误分流：可重试/不可重试/需换策略。
- 上下文治理：窗口控制 + 历史摘要压缩。
- 状态快照：每轮持久化（支持中断恢复）。
- 幂等防护：避免同一危险工具被重复误触发。

### 不做（刻意延后）
- 全自动自我改写 prompt。
- 复杂强化学习/在线训练。

### 交付物
- `stop controller`。
- `error policy` 与重试策略（指数退避可选）。
- `memory compactor`（旧历史摘要进长期记忆）。
- `state snapshot` + `resume` 能力。

### 验收标准
- 遇到工具失败时，系统可按策略恢复或安全退出。
- 长上下文任务可连续运行，不因 token 膨胀崩溃。
- 进程中断后可从最近快照恢复继续。

### 风险与控制
- 风险：摘要记忆丢失关键事实。
- 控制：摘要时强制保留“约束、未完成事项、关键证据”。

## Step 3: 可运营与可迭代（Ops & Evolution）

### 目标
把 harness 从“能跑”升级为“能持续改进”。

### 范围
- 指标体系：成功率、平均步数、工具错误率、成本、时延。
- 轨迹回放：按任务重放决策链，支持问题定位。
- 基准任务集：固定回归题，支持版本对比。
- 策略版本化：prompt/工具策略/压缩策略可追溯。
- 发布闸门：未通过回归不升级默认策略。

### 交付物
- `evaluation runner`（离线回归执行器）。✅ `src/harness/eval.py` + `scripts/run_eval.py`
- `benchmark suite`（基础任务集 + 期望结果）。✅ 内置用例集，支持自定义 JSON 用例文件
- `versioned configs`（策略与参数版本管理）。✅ `src/harness/config.py` + `configs/default.json` + CLI `--config`
- 最小可观测看板（哪怕先是命令行报表）。✅ `EvalReport` 命令行汇总（pass_rate、耗时、失败详情）

### 验收标准
- 任意一次改动可回答：性能是否变好、成本是否可接受、是否引入回退。
- 能在 1 次回放内定位主要失败链路。
- 版本切换可回滚。

### 风险与控制
- 风险：只追求成功率，忽视成本和稳定性。
- 控制：指标采用“成功率 + 成本 + 稳定性”三目标共同约束。

## 执行节奏建议
1. Step 1 完成后先做一次小规模真实任务试跑，再进入 Step 2。
2. Step 2 完成后先冻结接口，再建设 Step 3 的评估与版本化。
3. Step 3 上线后，所有能力迭代遵循“先基准后发布”。

## 当前默认决策（可后续调整）
- 先用单 agent 架构，不提前引入多 agent。
- 先做 deterministic-ish harness（强 schema、强约束），后续再放宽创造性。
- 优先保证可恢复和可观测，再追求复杂智能行为。

## 进展文档
- `step1-execution-log.md`: Step 1 implementation and verification baseline.
- `step2-reliability-layer.md`: Step 2 reliability layer — completed.
- Step 3 全部完成：eval runner ✅、benchmark suite ✅、命令行报表 ✅、versioned configs ✅（`src/harness/config.py` + `configs/default.json` + `harness eval --config`）。

## 后续演进
三步计划已全部完成。项目正在向"编程 Agent 工具"方向演进，详见 `evolution-roadmap.md`：
- Phase 1 ✅ 编程工具（read_file/edit_file/bash + TUI 确认）
- Phase 2 ✅ Anthropic 原生 tool_use + CLI --provider/--model + token 预算
- Phase 3 ⬜ 流式输出 + 权限系统
- Phase 4 ⬜ 项目上下文感知
