# UV 本地启动说明

## 当前约定
- Python 版本：3.12
- 项目虚拟环境：`$PWD/.venv`
- 项目内 Python 安装目录：`$PWD/.uv-python`
- 项目内 uv 缓存目录：`$PWD/.uv-cache`

## 首次准备
如果终端里找不到 `uv`，当前机器上的可执行文件在：

```bash
~/.local/bin/uv
```

首次在项目内准备环境可执行：

```bash
UV_CACHE_DIR="$PWD/.uv-cache" UV_PYTHON_INSTALL_DIR="$PWD/.uv-python" ~/.local/bin/uv python install 3.12
UV_CACHE_DIR="$PWD/.uv-cache" ~/.local/bin/uv venv .venv --python 3.12
```

## 启动项目

### CLI（推荐，安装后可直接使用）
```bash
uv pip install -e .       # 安装 harness CLI
uv pip install -e ".[anthropic]"  # 可选：安装 Anthropic 支持

harness run "please add numbers"
harness chat              # 多轮交互 TUI
harness chat --llm deepseek --api-key sk-...
harness chat --provider anthropic --model claude-sonnet-4-20250514  # Anthropic Claude
harness chat --project-root .  # 启用编程工具（read_file/edit_file/bash）
harness eval              # 批量回归评估
harness eval --config configs/default.json
harness resume logs/snapshot_20260101_120000.json
```

新增 CLI 参数：
- `--provider deepseek|anthropic` — 选择 LLM provider（覆盖 `--llm`）
- `--model` — 覆盖 provider 默认模型
- `--project-root DIR` — 指定项目根目录，启用编程工具（默认 cwd）
- `--no-bash` — 禁用 bash 工具

### 交互式多轮对话脚本
```bash
./.venv/bin/python scripts/run_chat.py             # rule-based LLM，免 API Key
./.venv/bin/python scripts/run_chat.py --llm deepseek
```

### 单次运行脚本
```bash
./.venv/bin/python scripts/run_mvp.py "please add numbers"
./.venv/bin/python scripts/run_mvp.py "what time is it" --max-steps 5 --context '{"user":"jett"}'
```

### Makefile 常用命令
```bash
make setup
make fmt
make lint
make smoke
make test
make check
make eval
make chat
make run GOAL="please add numbers"
make run-deepseek GOAL="帮我写一首诗并保存到本地 txt"
```

## 测试
```bash
uv run python -m pytest
# 或
./.venv/bin/python -m unittest discover -s tests -p "test_*.py"
```

## 说明
- 开发依赖（`pytest` 等）通过 `uv pip install -e ".[dev]"` 安装，或由 `make setup` 自动处理。
- Anthropic 支持通过 `uv pip install -e ".[anthropic]"` 安装（依赖 `anthropic>=0.40`）。
- 如果后续引入依赖，优先继续使用 `uv` 管理，并把安装方式补充到本文件。
- `make clean` 会删除 `.venv`、`.uv-cache`、`.uv-python`，属于本地重置命令，执行前确认没有需要保留的本地环境。
- `make fmt` 和 `make lint` 通过 `uv` 调用 Ruff；首次运行时如果本地还没有 Ruff，`uv` 会自动拉取。
