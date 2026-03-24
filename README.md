# Minimal Agent Harness

A minimal, testable single-agent harness with strict schemas and reliability guardrails.

This project is an MVP for a deterministic-ish agent loop. It focuses on a narrow but solid core:

- single-agent self-looping execution
- strict structured actions: `tool_call` or `final_response`
- observable runs through logs and snapshots
- controlled failure handling and stop conditions

It is intended as a small foundation for learning, experimentation, and iterative extension. It is not a production-ready agent platform.

## What This Project Includes

- single-agent loop: `memory -> llm -> tool/final -> observe -> next turn`
- strict action schema validation
- one-shot schema fallback retry in the same turn
- minimal tool dispatcher: `echo`, `add`, `utc_now`, `write_text_file`
- external trajectory logging in JSONL
- retryable vs non-retryable tool error handling
- budget / failure stop guards
- per-turn snapshots with resume support
- repeated dangerous-tool call blocking
- local scripted LLM stubs for deterministic testing
- DeepSeek-backed runtime entrypoint for real API execution

## What This Project Is Not

This repository is intentionally scoped. It does not currently aim to provide:

- multi-agent collaboration
- a complex planner
- a large tool ecosystem
- persistent long-term memory
- a production-grade checkpoint and recovery system

## Quickstart

### 1. Create the local environment

```bash
make setup
```

If you prefer manual setup with `uv`:

```bash
UV_CACHE_DIR="$PWD/.uv-cache" UV_PYTHON_INSTALL_DIR="$PWD/.uv-python" ~/.local/bin/uv python install 3.12
UV_CACHE_DIR="$PWD/.uv-cache" ~/.local/bin/uv venv .venv --python 3.12
```

### 2. Run the test suite

```bash
make test
```

Equivalent command:

```bash
./.venv/bin/python -m unittest discover -s tests -p "test_*.py"
```

### 3. Run the scripted MVP demo

```bash
make run GOAL="please add numbers"
```

Equivalent command:

```bash
./.venv/bin/python scripts/run_mvp.py "please add numbers"
```

## Run With DeepSeek

Copy the environment template first:

```bash
cp .env.example .env
```

Then fill in `DEEPSEEK_API_KEY` and run:

```bash
make run-deepseek GOAL="帮我写一首诗并保存到本地 txt"
```

Equivalent command:

```bash
./.venv/bin/python scripts/run_deepseek.py "帮我写一首诗并保存到本地 txt"
```

API key resolution order:

1. `--api-key`
2. environment variable `DEEPSEEK_API_KEY`
3. project-root `.env`
4. interactive prompt

If the key is entered interactively, the current implementation writes it back to the project-root `.env`.

The DeepSeek entrypoint also enables `write_text_file` and restricts writes to `~/Desktop/test` by default.

## 交互式多轮对话（推荐入口）

```bash
make chat                      # rule-based LLM，免 API Key
make chat LLM=deepseek         # 使用 DeepSeek API
```

或直接运行：

```bash
./.venv/bin/python scripts/run_chat.py
./.venv/bin/python scripts/run_chat.py --llm deepseek
```

效果类似 Claude Code：spinner 等待 → 工具调用蓝色面板 → 最终回答绿色面板，持续对话直到输入 `exit` 或按 Ctrl+C。

## CLI（脚本模式）

安装后可直接使用 `harness` 命令（需通过 `uv pip install -e .` 或等效方式安装）：

```bash
# 单次运行
harness run "please add numbers"
harness run "what is the time" --llm rule --max-steps 4

# 多轮交互 TUI
harness chat
harness chat --llm deepseek --api-key sk-...

# 从快照恢复
harness resume logs/snapshot_20260101_120000.json

# 查看帮助
harness --help
harness chat --help
```

## 评估框架

对一批用例做批量回归测试：

```bash
# 运行内置用例集
make eval

# 运行自定义用例文件
make eval CASES=my_cases.json

# 保存报告
./.venv/bin/python scripts/run_eval.py --output report.json
```

用例文件格式（JSON 数组）：

```json
[
  {
    "id": "add_numbers",
    "goal": "please add numbers",
    "expected_stop_reason": "final_response",
    "expected_keywords": ["5"]
  }
]
```

也可在 Python 中直接使用：

```python
from harness import HarnessAgent, RunConfig, RuleBasedLLM
from harness.eval import EvalCase, EvalRunner

cases = [EvalCase(id="test", goal="hello", expected_stop_reason="final_response")]
agent = HarnessAgent(llm=RuleBasedLLM(), config=RunConfig())
report = EvalRunner(agent).run(cases)
print(f"通过率: {report.pass_rate:.0%}")
```

## Common Commands

```bash
make fmt
make lint
make smoke
make test
make check
make eval
make run GOAL="please add numbers"
make run-deepseek GOAL="帮我写一首诗并保存到本地 txt"
```

## Example Flow

The core loop follows this structure:

```text
memory -> llm -> tool/final -> observe -> next turn
```

In practice, a typical run looks like:

1. build working memory from goal, context, summary, and history
2. ask the model for the next structured action
3. validate the action schema
4. execute a tool or finish with a final response
5. log the turn, update state, and decide whether to continue

## Project Structure

- `src/harness/agent.py`: run loop
- `src/harness/cli.py`: command-line interface (`harness run / resume`)
- `src/harness/eval.py`: batch evaluation framework
- `src/harness/schema.py`: strict output schema parser and validator
- `src/harness/tools.py`: tool dispatcher
- `src/harness/logger.py`: trajectory logging
- `src/harness/memory.py`: working memory and guarded compression
- `src/harness/snapshot.py`: snapshot persistence for resume
- `src/harness/stop_controller.py`: stop condition guards
- `src/harness/error_policy.py`: retryable vs non-retryable error routing
- `src/harness/types.py`: core data types
- `src/harness/llm.py`: scripted, rule-based, and DeepSeek LLM implementations
- `scripts/run_mvp.py`: local scripted demo entrypoint
- `scripts/run_deepseek.py`: DeepSeek API entrypoint
- `scripts/run_eval.py`: batch evaluation entrypoint
- `tests/`: unit and smoke tests
- `docs/`: architecture notes, execution logs, and setup docs

## Repository Hygiene

This repository includes a checked-in `.env.example` but ignores local secrets and runtime artifacts through `.gitignore`, including:

- `.env`
- `.venv/`
- `.uv-cache/`
- `.uv-python/`
- `logs/`
- `outputs/`

## Documentation

- `docs/harness-foundation.md`: high-level architecture and flow
- `docs/harness-3-step-plan.md`: phased plan and current progress
- `docs/step1-execution-log.md`: Step 1 execution record
- `docs/step2-reliability-layer.md`: Step 2 guardrails and verification notes
- `docs/deepseek-entrypoint.md`: DeepSeek runtime notes
- `docs/uv-local-setup.md`: local setup with `uv`

## License

MIT — see [LICENSE](LICENSE).

## Development Status

Current status:

- Step 1 completed: loop MVP
- Step 2 completed: reliability layer
- Step 3 completed: CLI, eval framework, CI, docstrings

The current direction is to preserve deterministic, strongly constrained, testable evolution before adding more autonomy or complexity.
