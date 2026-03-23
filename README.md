# Minimal Harness MVP (Step 1)

This repository contains the Step 1 implementation of a minimal self-looping agent harness.

## What is included
- single-agent loop (`memory -> llm -> tool/final -> observe -> next turn`)
- strict action schema (`tool_call` or `final_response`)
- one-shot schema fallback retry in the same turn
- minimal tool dispatcher (`echo`, `add`, `utc_now`)
- external trajectory logging in JSONL
- smoke tests for core loop behavior

## Quickstart
```bash
python3 -m unittest discover -s tests -p "test_*.py"
python3 scripts/run_mvp.py "please add numbers"
```

## Structure
- `src/harness/agent.py`: run loop
- `src/harness/schema.py`: strict output schema parser/validator
- `src/harness/tools.py`: tool dispatcher
- `src/harness/logger.py`: trajectory logging
- `src/harness/memory.py`: working memory + basic compression
- `tests/test_smoke.py`: smoke tests
