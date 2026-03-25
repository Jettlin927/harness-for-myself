# HAU — Harness for Yourself

可测试的编程 Agent 框架——能自主读代码、搜索、编辑、跑测试的单 agent harness。

## 快速开始

```bash
# 克隆并安装
git clone https://github.com/Jettlin927/harness-for-myself.git && cd harness-for-myself
uv pip install -e ".[dev,anthropic]"

# 设置 API Key
export ANTHROPIC_API_KEY=sk-ant-...

# 启动交互式对话
harness chat --provider anthropic --project-root .
```

## 功能特性

- **13 个工具** — 编程、搜索、记忆、子 agent（详见下表）
- **Anthropic Claude 原生 tool_use** — 结构化工具调用
- **流式 token 输出** — Rich TUI 实时渲染
- **三级权限** — `ask`（逐个确认）/ `auto-edit`（文件自动通过）/ `yolo`（全自动）
- **子 agent 系统** — 通过 `.hau/agents/*.md` 定义专门化 agent，用 `spawn_agent` 派生
- **Skill 模板** — 通过 `.hau/skills/*.md` 定义可复用 prompt，TUI 中 `/skillname` 调用
- **跨会话记忆** — `save_memory` / `recall_memory` 持久化知识
- **项目上下文注入** — 自动检测 git、语言、测试/lint 命令，加载 `.hau/CONTEXT.md`
- **会话持久化 + 快照恢复** — 随时中断，随时继续
- **批量评估框架** — 回归测试，产出 pass_rate 报告

## 工具列表

| 工具 | 说明 |
|------|------|
| `read_file` | 读取文件内容（带行号） |
| `edit_file` | 精确替换文件文本（带 diff 预览） |
| `write_file` | 创建新文件（拒绝覆盖已有文件） |
| `bash` | 执行 shell 命令 |
| `glob_files` | 按 glob 模式搜索文件 |
| `grep_search` | 按正则搜索文件内容 |
| `list_directory` | 列出目录内容（标注文件/目录类型） |
| `save_memory` | 保存知识到跨会话持久记忆 |
| `recall_memory` | 检索之前保存的知识 |
| `spawn_agent` | 派生子 agent 执行子任务 |
| `use_skill` | 查找并使用 skill 模板 |

## 使用方法

### 交互式 TUI（推荐）

```bash
# 基本用法：Claude 驱动，当前目录为项目根
harness chat --provider anthropic --project-root .

# 指定权限级别
harness chat --provider anthropic --project-root . --trust ask        # 每个敏感操作都确认（默认）
harness chat --provider anthropic --project-root . --trust auto-edit  # 文件操作自动通过，bash 需确认
harness chat --provider anthropic --project-root . --trust yolo       # 全部自动执行

# 其他 LLM 提供商
harness chat --provider deepseek --api-key sk-...   # DeepSeek
harness chat --llm rule                              # 规则引擎（无需 API Key，用于测试）
```

进入 TUI 后直接输入任务：
```
◆ 你: 帮我找到所有测试文件并统计测试数量        ← 自然语言任务
◆ 你: 修复 src/harness/agent.py 中的类型错误    ← 具体编程任务
◆ 你: /review                                    ← 调用 skill（需配置）
◆ 你: exit                                       ← 退出
```

### 单次执行

```bash
harness run --provider anthropic --project-root . "统计 src/ 目录的代码行数"
```

### 其他命令

```bash
harness eval                    # 批量回归评估
harness session --verbose       # 查看历史会话详情
harness resume <snapshot.json>  # 从快照恢复运行
```

## 配置

### 项目上下文（`.hau/CONTEXT.md`）

在项目根目录创建 `.hau/CONTEXT.md`，给 agent 提供永久上下文：

```markdown
这是一个 Flask Web 应用。
测试在 tests/ 目录，用 `pytest` 运行。
代码必须使用类型注解。
```

### Agent 定义（`.hau/agents/*.md`）

定义专门化 agent，通过 `spawn_agent` 工具派生：

```markdown
---
name: test-runner
description: 运行项目测试并报告结果
max_steps: 10
trust_level: auto-edit
tools: [bash, read_file, glob_files, grep_search]
---
你是一个测试运行 agent。任务：
1. 找到项目的测试命令
2. 用 bash 执行
3. 报告通过/失败状态和详情
```

### Skill 模板（`.hau/skills/*.md`）

定义可复用的 prompt 模板，在 TUI 中用 `/skillname` 调用：

```markdown
---
name: review
description: 审查最近的代码变更
---
审查最近的代码变更。用 `bash git diff HEAD~1` 查看 diff。
关注：正确性、代码风格、测试覆盖。
```

### 跨会话记忆

Agent 自动将知识持久化在 `.hau/memory/` 目录。用 `save_memory` 保存发现（项目约定、架构决策等），用 `recall_memory` 在后续会话中检索。

## 架构

```
工作记忆 → LLM → tool_call / final_response → 观察 → 下一轮
```

核心循环在 `src/harness/agent.py`：构建工作记忆 → 请求 LLM 生成结构化动作 → schema 严格校验 → 执行工具 → 决定是否继续。

```
src/harness/
  agent.py            # 主循环：HarnessAgent + RunConfig
  anthropic_llm.py    # Anthropic 原生 tool_use 适配器
  coding_tools.py     # 编程工具（read/edit/write/bash/glob/grep/list）
  subagent.py         # 子 agent 派生（spawn_agent + use_skill）
  definitions.py      # Agent/Skill 定义文件解析器
  project_memory.py   # 跨会话持久记忆
  schema.py           # LLM 输出严格校验
  tools.py            # 工具路由分发器
  memory.py           # 工作记忆 + 压缩
  context.py          # 项目上下文加载（git、语言、.hau/）
  tui.py              # Rich TUI 交互界面
  cli.py              # CLI 入口
```

详细文档：[`docs/harness-foundation.md`](docs/harness-foundation.md)、[`docs/evolution-roadmap.md`](docs/evolution-roadmap.md)、[`docs/phase5-9-evolution-assessment.md`](docs/phase5-9-evolution-assessment.md)

## 开发

```bash
make setup      # 安装 Python 3.12，创建虚拟环境，安装依赖
make check      # lint + 格式检查 + 冒烟测试 + 全量测试（与 CI 一致）
make fmt        # Ruff 格式化
make lint       # Ruff lint
make typecheck  # Pyright 类型检查
make test       # 运行全部测试
```

测试使用 `unittest` + `ScriptedLLM` 驱动，无需真实 API 调用即可进行确定性测试。

### 环境要求

- Python >= 3.12
- 运行时依赖：`rich`
- 可选：`anthropic`（Claude 提供商）
- 开发工具：`ruff`、`pyright`、`pytest`

## 许可证

MIT — 见 [LICENSE](LICENSE)
