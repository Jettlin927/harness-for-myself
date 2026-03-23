# Step 2 执行记录（Reliability Layer）

## 执行日期
- 2026-03-24

## 已完成能力
- 停止条件扩展：支持 `max_budget`、`max_failures`、`goal_reached_token`
- 工具错误分流：区分可重试与不可重试错误
- 工具重试策略：对 `RetryableToolError` 进行限次自动重试
- 状态快照：每轮结束持久化运行状态，包含 `goal/context/turns/summary/failures/budget`
- 恢复能力：支持从最近快照 `resume`
- 幂等防护：对配置中的危险工具做重复调用拦截
- 摘要压缩增强：保留 `constraint`、`todo`、`evidence` 类关键信息

## 代码落点
- `src/harness/agent.py`: 主循环接入 budget / failures / snapshot / resume / idempotency
- `src/harness/stop_controller.py`: 停止条件控制
- `src/harness/error_policy.py`: 工具错误重试策略
- `src/harness/snapshot.py`: 快照读写
- `src/harness/tools.py`: 可注册工具与 `RetryableToolError`
- `src/harness/memory.py`: 关键信息保真压缩
- `tests/test_reliability.py`: Step 2 核心回归测试

## 验证结果
- 测试命令：`python3 -m unittest discover -s tests -p "test_*.py"`
- 结果：`Ran 33 tests ... OK`

## 当前实现约定
- budget 采用轻量计数：每次 LLM 生成算 1，每次工具执行尝试算 1
- 可重试错误通过 `RetryableToolError` 显式声明，避免猜测字符串
- 危险工具幂等防护按 `tool_name + sorted(arguments)` 指纹判断重复
- 快照默认落在 `snapshot_dir`，未配置时回落到 `log_dir`

## 留给 Step 3
- 指数退避和更细粒度的 retry policy 仍未引入
- 快照恢复目前只恢复 harness 状态，不恢复外部工具副作用
- budget 还是本地抽象值，不是真实 token / cost 计量
