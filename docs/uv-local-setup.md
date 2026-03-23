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
直接运行演示脚本：

```bash
./.venv/bin/python scripts/run_mvp.py "please add numbers"
```

也可以直接用 `Makefile`：

```bash
make setup
make fmt
make lint
make smoke
make test
make check
make run GOAL="please add numbers"
```

带上下文运行：

```bash
./.venv/bin/python scripts/run_mvp.py "what time is it" --max-steps 5 --context '{"user":"jett"}'
```

## 测试
```bash
./.venv/bin/python -m unittest discover -s tests -p "test_*.py"
```

## 说明
- 当前项目没有额外第三方依赖，所以创建虚拟环境后即可运行。
- 如果后续引入依赖，优先继续使用 `uv` 管理，并把安装方式补充到本文件。
- `make clean` 会删除 `.venv`、`.uv-cache`、`.uv-python`，属于本地重置命令，执行前确认没有需要保留的本地环境。
- `make fmt` 和 `make lint` 通过 `uv` 调用 Ruff；首次运行时如果本地还没有 Ruff，`uv` 会自动拉取。
