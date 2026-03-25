# 测试对照计划

## Python → TypeScript 测试 1:1 映射

### 测试框架

- Python: `unittest`（通过 pytest 运行）
- TypeScript: `vitest`

### 测试文件映射

| Python 测试文件 | TS 测试文件 | 用例数 | 覆盖模块 |
|----------------|------------|--------|---------|
| test_smoke.py | smoke.test.ts | 4 | 核心循环 |
| test_reliability.py | reliability.test.ts | 20 | 可靠性层 |
| test_coding_tools.py | coding-tools.test.ts | 47 | 编程工具 |
| test_schema.py | schema.test.ts | 8 | Schema 校验 |
| test_tools.py | tools.test.ts | 23 | 工具调度 |
| test_agent.py | agent.test.ts | 4 | Agent 行为 |
| test_memory.py | memory.test.ts | 12 | 内存管理 |
| test_anthropic_llm.py | anthropic-llm.test.ts | 29 | Anthropic 适配器 |
| test_deepseek.py | deepseek.test.ts | 15 | DeepSeek 适配器 |
| test_session.py | session.test.ts | 18 | 会话管理 |
| test_config.py | config.test.ts | 8 | 配置 |
| test_context.py | context.test.ts | 31 | 项目上下文 |
| test_definitions.py | definitions.test.ts | 15 | 定义解析 |
| test_permissions.py | permissions.test.ts | 14 | 权限系统 |
| test_project_memory.py | project-memory.test.ts | 15 | 项目记忆 |
| test_skills.py | skills.test.ts | 7 | Skill 展开 |
| test_snapshot.py | snapshot.test.ts | 4 | 快照 |
| test_subagent.py | subagent.test.ts | 16 | 子 Agent |
| **合计** | | **221+** | |

### 测试基础设施

**ScriptedLLM 测试桩：** 在 TS 侧 1:1 实现，作为所有 agent 级测试的驱动。

**临时目录：** 使用 `vitest` 的 `beforeEach/afterEach` + `fs.mkdtempSync`。

**Mock：** 使用 `vi.mock()` / `vi.spyOn()` 替代 `unittest.mock`。

### 测试执行

```bash
pnpm test           # 运行全部测试
pnpm test:watch     # 监听模式
pnpm test:coverage  # 覆盖率报告
```
