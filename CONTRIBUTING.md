# Contributing

感谢你对本项目感兴趣。以下是参与贡献的完整指南。

## 开发环境搭建

### 前置要求

- macOS / Linux
- [`uv`](https://github.com/astral-sh/uv) 已安装（`~/.local/bin/uv`）

### 首次设置

```bash
make setup       # 安装 Python 3.12 并创建 .venv
```

手动方式：

```bash
UV_CACHE_DIR="$PWD/.uv-cache" UV_PYTHON_INSTALL_DIR="$PWD/.uv-python" \
  ~/.local/bin/uv python install 3.12

UV_CACHE_DIR="$PWD/.uv-cache" \
  ~/.local/bin/uv venv .venv --python 3.12
```

## 日常开发流程

```bash
make fmt        # 用 Ruff 格式化代码
make lint       # 用 Ruff 检查代码规范
make smoke      # 仅运行冒烟测试（快速反馈）
make test       # 运行全量测试套件
make check      # lint + smoke + test（提交前必跑）
```

## 代码风格

- **格式化工具**：[Ruff](https://docs.astral.sh/ruff/)，行宽 100 字符
- **类型标注**：公开接口必须有类型注解
- **Docstring**：公开类和函数必须有 docstring（格式参考现有代码）
- 提交前务必确保 `make check` 全部通过

## 提交规范

提交消息使用**中文**，格式遵循 Conventional Commits：

```
<类型>(<范围>)：<简短描述>

[可选的详细说明]
```

常用类型：

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `test` | 增加或修改测试 |
| `docs` | 文档变更 |
| `refactor` | 重构（不改变行为） |
| `chore` | 构建/工具链/杂项 |

示例：

```
feat(agent)：新增最大失败次数配置项
fix(schema)：修复空 content 字段的校验边界
test(eval)：补充评估框架的集成测试
```

## 测试要求

- 所有新功能必须附带测试
- 使用 `ScriptedLLM` 保证测试的确定性，避免依赖外部 API
- 测试文件放在 `tests/` 目录，命名格式为 `test_<module>.py`
- 提交前确保 46 个（或更多）测试全部通过

```bash
make test
```

## Pull Request 流程

1. 从 `main` 分支切出特性分支
2. 完成开发并确保 `make check` 通过
3. 提交 PR，描述中说明**变更内容**和**测试方式**
4. PR 会触发 CI 自动运行 lint + 全量测试

## 项目结构速览

```
src/harness/       核心实现
  agent.py         主运行循环
  cli.py           命令行入口
  eval.py          评估框架
  llm.py           LLM 适配器
  memory.py        工作记忆管理
  schema.py        输出 Schema 校验
  snapshot.py      快照持久化
  stop_controller.py  停止条件守卫
  tools.py         工具分发器
  types.py         核心数据类型

tests/             测试套件
scripts/           可执行脚本入口
docs/              架构文档与阶段日志
```

## 提问与反馈

如遇问题，请直接开 Issue 描述复现步骤和预期行为。
