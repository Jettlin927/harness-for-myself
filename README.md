# HAU -- Harness for Yourself

A testable programming agent harness that can autonomously read, search, edit code, and run tests.

## Quick Start

```bash
# Clone and install
git clone https://github.com/Jettlin927/harness-for-myself.git && cd harness-for-myself
uv pip install -e ".[dev,anthropic]"

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start an interactive session
harness chat --provider anthropic --project-root .
```

## Features

- **13 tools** -- coding, search, memory, sub-agents (see full list below)
- **Anthropic Claude native tool_use** -- structured tool calls, no JSON-wrapping hacks
- **Streaming token output** -- real-time response rendering via Rich TUI
- **3-tier permission model** -- `ask` / `auto-edit` / `yolo`
- **Sub-agent system** -- spawn specialized child agents via `.hau/agents/*.md` definitions
- **Skill templates** -- reusable prompts via `.hau/skills/*.md`, invoke with `/skillname`
- **Cross-session memory** -- persistent knowledge via `save_memory` / `recall_memory`
- **Project context injection** -- auto-detects git, language, test/lint commands, loads `.hau/CONTEXT.md`
- **Session persistence + snapshot resume** -- pick up where you left off
- **Batch evaluation framework** -- regression testing with pass rate reports

## Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents with line numbers |
| `edit_file` | Replace exact text in a file (with diff preview) |
| `write_file` | Create a new file (refuses to overwrite existing) |
| `bash` | Execute a shell command |
| `glob_files` | Search for files by glob pattern |
| `grep_search` | Search file contents with regex |
| `list_directory` | List directory contents with type annotations |
| `save_memory` | Save knowledge to persistent cross-session memory |
| `recall_memory` | Retrieve previously saved knowledge |
| `spawn_agent` | Spawn a child agent for sub-tasks |
| `use_skill` | Look up a reusable skill template |

## Usage

### Interactive TUI (recommended)

```bash
# Basic: Claude as LLM, current directory as project
harness chat --provider anthropic --project-root .

# With permission level
harness chat --provider anthropic --project-root . --trust ask        # confirm every tool (default)
harness chat --provider anthropic --project-root . --trust auto-edit  # auto-approve file ops
harness chat --provider anthropic --project-root . --trust yolo       # full auto

# Other providers
harness chat --provider deepseek --api-key sk-...   # DeepSeek
harness chat --llm rule                              # Rule-based (no API, for testing)
```

Inside the TUI:
```
◆ you: find all test files and count tests        ← natural language task
◆ you: fix the type error in src/harness/agent.py ← specific coding task
◆ you: /review                                     ← invoke a skill (if configured)
◆ you: exit                                        ← quit
```

### Single-shot Execution

```bash
harness run --provider anthropic --project-root . "count lines of code in src/"
```

### Other Commands

```bash
harness eval                    # Batch regression evaluation
harness session --verbose       # List saved sessions with details
harness resume <snapshot.json>  # Resume from a saved snapshot
```

## Configuration

### Project Context (`.hau/CONTEXT.md`)

Create `.hau/CONTEXT.md` in your project root to give the agent permanent context:

```markdown
This is a Python web app using Flask.
Tests are in tests/ and run with `pytest`.
Always use type hints.
```

### Agent Definitions (`.hau/agents/*.md`)

Define specialized agents that can be spawned via `spawn_agent`:

```markdown
---
name: test-runner
description: Runs project tests and reports results
max_steps: 10
trust_level: auto-edit
tools: [bash, read_file, glob_files, grep_search]
---
You are a test runner agent. Your job is to:
1. Find the project's test command
2. Run it via bash
3. Report pass/fail status with details
```

### Skill Templates (`.hau/skills/*.md`)

Define reusable prompt templates, invokable with `/skillname` in TUI:

```markdown
---
name: review
description: Code review for recent changes
---
Review the recent code changes. Use `bash git diff HEAD~1` to see the diff.
Focus on: correctness, style, test coverage.
```

### Cross-session Memory

The agent automatically persists knowledge in `.hau/memory/`. Use `save_memory` to store discoveries (conventions, architecture decisions) and `recall_memory` to retrieve them across sessions.

## Architecture

```
working_memory -> LLM -> tool_call / final_response -> observe -> next turn
```

The core loop in `src/harness/agent.py` builds working memory, asks the LLM for a structured action, validates it against a strict schema, executes tools, and decides whether to continue.

```
src/harness/
  agent.py            # Main loop: HarnessAgent + RunConfig
  anthropic_llm.py    # Anthropic native tool_use adapter
  coding_tools.py     # Coding tools (read/edit/write/bash/glob/grep/list)
  subagent.py         # Sub-agent spawning (spawn_agent + use_skill)
  definitions.py      # Agent/skill definition file parser
  project_memory.py   # Cross-session persistent memory
  schema.py           # Strict LLM output validation
  tools.py            # Tool dispatcher and routing
  memory.py           # Working memory with compression
  context.py          # Project context loader (git, language, .hau/)
  tui.py              # Rich TUI
  cli.py              # CLI entry point
```

For detailed docs: [`docs/harness-foundation.md`](docs/harness-foundation.md), [`docs/evolution-roadmap.md`](docs/evolution-roadmap.md), [`docs/phase5-9-evolution-assessment.md`](docs/phase5-9-evolution-assessment.md).

## Development

```bash
make setup      # Install Python 3.12, create venv, install deps
make check      # lint + format check + smoke + full test suite
make fmt        # Ruff format
make lint       # Ruff lint
make typecheck  # Pyright type check
make test       # Run all tests
```

```bash
uv run python -m pytest       # or: make test
make check                     # full CI-equivalent check (matches GitHub Actions)
```

Tests use `unittest` with `ScriptedLLM` for deterministic agent-level testing without real API calls.

### Requirements

- Python >= 3.12
- Runtime: `rich`
- Optional: `anthropic` (for Claude provider)
- Dev: `ruff`, `pyright`, `pytest`

## License

MIT -- see [LICENSE](LICENSE).
