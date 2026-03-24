# HAU Changelog

All notable changes to HAU (Harness for Yourself) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] — 2026-03-24

### Added

**Step 1 — Run Loop MVP**
- Single-agent self-looping execution (`memory → llm → tool/final → observe → next turn`)
- Strict structured action schema (`tool_call` / `final_response`)
- Tool dispatcher with built-in tools: `echo`, `add`, `utc_now`, `write_text_file`
- External trajectory logging in JSONL
- Schema validation with one-shot retry per turn
- `RuleBasedLLM` and `ScriptedLLM` stubs for deterministic local testing
- DeepSeek API entrypoint (`DeepSeekLLM`)

**Step 2 — Reliability Layer**
- Stop conditions: `max_steps`, `max_budget`, `max_failures`, `goal_reached`
- Tool error routing: retryable vs non-retryable via `RetryableToolError`
- Per-turn state snapshots with resume support
- Idempotency guard for dangerous tool calls
- Memory compactor with constraint/todo/evidence preservation

**Step 3 — Ops & Evolution**
- `EvalRunner` and `EvalCase` for batch regression testing
- Built-in case suite (`BUILTIN_CASES`) bundled in `eval.py`
- `EvalReport` with pass rate, avg turns, avg duration, and `config_version` tracking
- `StrategyConfig` — versioned JSON config files for strategy parameter management
- `harness eval` CLI subcommand for offline regression runs
- `--config FILE` flag on `harness run` and `harness eval` for version-pinned runs
- `configs/default.json` — baseline strategy anchor for regression comparison
- Interactive multi-turn TUI via `harness chat`
- Session persistence across chat goals (`SessionManager`)
- GitHub Actions CI workflow
- MIT License, CONTRIBUTING.md
