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

## Common Commands

```bash
make fmt
make lint
make smoke
make test
make check
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

## Development Status

Current status:

- Step 1 completed: loop MVP
- Step 2 completed: reliability layer
- Step 3 not started as a full implementation

The current direction is to preserve deterministic, strongly constrained, testable evolution before adding more autonomy or complexity.
