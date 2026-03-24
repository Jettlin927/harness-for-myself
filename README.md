# HAU -- Harness for Yourself

A testable programming agent harness that can autonomously read, search, edit code, and run tests.

## Quick Start

```bash
# Clone and install
git clone https://github.com/yourname/hau.git && cd hau
uv pip install -e ".[dev,anthropic]"

# Set your API key
export ANTHROPIC_API_KEY=sk-...

# Start an interactive session
harness chat --provider anthropic --project-root .
```

## Features

- **7 coding tools** -- `read_file`, `edit_file`, `write_file`, `run_bash`, `glob_files`, `grep_search`, `list_directory`
- **Anthropic Claude native tool_use** -- structured tool calls, no JSON-wrapping hacks
- **Streaming token output** -- real-time response rendering via Rich TUI
- **3-tier permission model** -- `ask` (confirm every tool) / `auto-edit` (auto-approve reads) / `yolo` (full auto)
- **Project context injection** -- auto-detects git info, language, and loads `.hau/CONTEXT.md`
- **Session persistence + snapshot resume** -- pick up where you left off
- **Structured system prompt** -- guides the agent through a search -> understand -> modify -> verify workflow
- **Batch evaluation framework** -- regression testing with pass rate and timing reports

## CLI Commands

```bash
harness chat                # Interactive multi-turn conversation (TUI)
harness run "fix the bug"   # Single-shot execution
harness eval                # Batch regression evaluation
harness session list        # List saved sessions
harness resume <snapshot>   # Resume from a snapshot file
```

### Provider Options

```bash
harness chat --provider anthropic              # Claude (default model: claude-sonnet-4-20250514)
harness chat --provider deepseek --api-key sk-...  # DeepSeek
harness chat --llm rule                        # Rule-based (no API key needed, for testing)
```

## Architecture

```
memory -> LLM -> tool_call / final_response -> observe -> next turn
```

The core loop in `src/harness/agent.py` builds working memory, asks the LLM for a structured action, validates it against a strict schema, executes tools, and decides whether to continue.

```
src/harness/
  agent.py            # Main loop: HarnessAgent + RunConfig
  anthropic_llm.py    # Anthropic native tool_use adapter
  coding_tools.py     # 7 coding tools
  schema.py           # Strict output validation
  tools.py            # Tool dispatcher and routing
  memory.py           # Working memory with compression
  context.py          # Project context loader
  tui.py              # Rich TUI
  cli.py              # CLI entry point
```

For detailed architecture docs, see [`docs/harness-foundation.md`](docs/harness-foundation.md) and [`docs/evolution-roadmap.md`](docs/evolution-roadmap.md).

## Development

```bash
make setup      # Install Python 3.12, create venv, install deps
make check      # lint + format check + smoke + full test suite
make fmt        # Ruff format
make lint       # Ruff lint
make typecheck  # Pyright type check
make test       # Run all tests
```

### Running Tests

```bash
uv run python -m pytest       # or: make test
make check                     # full CI-equivalent check
```

Tests use `unittest` with `ScriptedLLM` to drive agent-level tests without real API calls. See `tests/` for examples.

### Project Requirements

- Python >= 3.12
- Runtime dependency: `rich`
- Optional: `anthropic` (for Claude provider)
- Dev tools: `ruff`, `pyright`, `pytest`

## License

MIT -- see [LICENSE](LICENSE).
