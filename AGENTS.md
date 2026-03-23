# AGENTS.md

本文件用于约束后续在本项目内协作的 agent 行为，减少重复沟通，并保留阶段性共识。
如果有任何架构或者进度上的变化请修改这个文件，以便后续的对话不产生偏移

## 项目定位

- 当前项目是一个最小可运行的 agent harness MVP。
- 一阶段目标已经完成，定位是“基础框架收官”，不是生产级多工具自治系统。
- 当前实现重点是单 agent 自循环主干：`memory -> llm -> tool/final -> observe -> next turn`。

## 当前阶段现状

- 已完成 Step 1 / Phase 1 基础能力：
  - 单 agent run loop
  - 严格 action schema 校验
  - 同轮 schema fallback retry
  - 最小工具分发器：`echo`、`add`、`utc_now`
  - JSONL 轨迹日志
  - working memory 与基础压缩
- 已完成 Step 2 / Reliability Layer：
  - 停止条件扩展：`max_budget`、`max_failures`、`goal_reached_token`
  - 工具错误分流：可重试 vs 不可重试
  - 工具自动限次重试（`RetryableToolError`）
  - 每轮状态快照与 resume 恢复
  - 危险工具幂等防护（重复调用拦截）
  - 摘要压缩增强（保留 constraint / todo / evidence 类信息）
- 当前代码可运行、可测试、可复盘。
- 当前测试已全绿：`33` 个测试通过。
- 最近一次阶段性提交：`1807fda`（Step 1 收官）；Step 2 变更尚未提交。

## 目录说明

- `src/harness/agent.py`: 主运行循环
- `src/harness/schema.py`: LLM 输出 schema 解析与校验
- `src/harness/tools.py`: 工具注册与执行
- `src/harness/memory.py`: working memory 与压缩
- `src/harness/logger.py`: 轨迹日志输出
- `src/harness/llm.py`: `ScriptedLLM` 与 `RuleBasedLLM`
- `src/harness/types.py`: 核心数据结构
- `src/harness/stop_controller.py`: 停止条件控制
- `src/harness/error_policy.py`: 工具错误重试策略
- `src/harness/snapshot.py`: 快照读写
- `tests/`: 当前测试套件
- `docs/`: 设计说明、阶段计划、执行记录、收官结论

## 已确认的协作规范

### 文档沉淀

- 如果遇到后续可能复用的信息，优先记录到 `docs/` 目录。
- 重要的阶段判断、设计边界、执行结果，都应该留档，而不是只存在对话里。

### 测试规范

一个功能 / 函数算“完成”，必须同时满足：

- 实现代码已写完
- 对应测试文件存在
- 所有测试通过

每个测试套件必须覆盖：

- 正常输入的 happy path
- 空值 / `null` / `undefined` 输入
- 边界值（最大、最小、临界）
- 异常情况的错误处理

开发顺序约定：

- 优先 TDD：先写测试，再写实现
- 如果是修改已有代码，先补测试覆盖现有行为，再改实现

禁止行为：

- 不允许提交没有测试的新函数
- 不允许用 `// TODO: add tests later` 跳过测试

### 提交规范

- commit message 用中文写
- 在不影响语义的前提下，建议保留类型前缀，例如：
  - `feat: ...`
  - `fix: ...`
  - `test: ...`
  - `docs: ...`
  - `refactor: ...`
  - `chore: ...`

## 当前质量门槛

在当前项目里，任何“可提交”改动至少应满足：

- 能通过全量测试：`python3 -m unittest discover -s tests -p "test_*.py"`
- 不破坏一阶段既有能力边界
- 对新增行为补齐对应测试
- 如结论可复用，补充到 `docs/`

## 当前边界与注意事项

- 本项目当前仍是 MVP，不要把它误判为生产可用 agent 平台。
- 暂时没有：
  - 真实外部 LLM 接入
  - 复杂 planner
  - 多 agent 协作
  - 丰富工具生态
  - 持久化记忆系统
  - 完整恢复 / checkpoint 机制
- 后续开发优先延续 deterministic、强约束、可验证的演进方式，不要过早追求“看起来聪明”。

## 推荐工作方式

后续 agent 在动手前，优先按下面顺序执行：

1. 先阅读本文件和 `docs/` 中相关文档。
2. 明确本次变更是否属于修复、扩展还是重构。
3. 先补测试或先确认已有测试覆盖。
4. 进行最小实现修改。
5. 跑全量测试。
6. 按以下规则更新文档（强制，不可跳过）：
   - 新增模块 → 更新 `AGENTS.md` 「目录说明」和 `README.md` 「Structure」
   - 完成一个阶段 → 在 `docs/` 写执行记录，更新 `AGENTS.md` 「当前阶段现状」和测试数量，在 `harness-3-step-plan.md` 「进展文档」里标注完成
   - 架构发生变化 → 更新 `docs/harness-foundation.md` 的流程图
   - 其他可复用结论 → 写入对应的 `docs/` 文件
7. 提交时使用中文 commit message。

## 参考文档

- `docs/harness-foundation.md`
- `docs/harness-3-step-plan.md`
- `docs/step1-execution-log.md`
- `docs/phase1-closure-notes.md`
- `docs/step2-reliability-layer.md`
