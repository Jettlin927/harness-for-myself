UV := ~/.local/bin/uv
UV_CACHE_DIR := $(CURDIR)/.uv-cache
UV_PYTHON_INSTALL_DIR := $(CURDIR)/.uv-python
XDG_DATA_HOME := $(CURDIR)/.local-share
PYTHON312 := $(CURDIR)/.uv-python/cpython-3.12.13-macos-aarch64-none/bin/python3.12
VENV_PYTHON := $(CURDIR)/.venv/bin/python
RUFF := UV_CACHE_DIR="$(UV_CACHE_DIR)" XDG_DATA_HOME="$(XDG_DATA_HOME)" ~/.local/bin/uvx ruff

.PHONY: help setup install-python venv install fmt lint typecheck smoke test check run run-deepseek eval chat clean

help:
	@echo "Available targets:"
	@echo "  make setup              Install Python 3.12, create .venv, install deps"
	@echo "  make install-python     Download Python 3.12 into .uv-python"
	@echo "  make venv               Create .venv with the project-local Python"
	@echo "  make install            Install project dependencies (rich, etc.)"
	@echo "  make fmt                Format Python files with Ruff"
	@echo "  make lint               Lint Python files with Ruff"
	@echo "  make typecheck          Type check with Pyright"
	@echo "  make smoke              Run smoke tests only"
	@echo "  make test               Run the unittest suite"
	@echo "  make check              Run lint + smoke + full test suite"
	@echo "  make run GOAL='...'     Run the demo harness"
	@echo "  make run-deepseek GOAL='...'  Run the harness with DeepSeek API"
	@echo "  make chat               Start interactive multi-turn chat (visual TUI)"
	@echo "  make chat LLM=deepseek  Chat using DeepSeek API"
	@echo "  make eval               Run built-in eval suite"
	@echo "  make eval CASES=path/to/cases.json  Run custom eval cases"
	@echo "  make clean              Remove local uv cache, python, and .venv"

setup: install-python venv install

install-python:
	UV_CACHE_DIR="$(UV_CACHE_DIR)" UV_PYTHON_INSTALL_DIR="$(UV_PYTHON_INSTALL_DIR)" XDG_DATA_HOME="$(XDG_DATA_HOME)" $(UV) python install 3.12

venv:
	UV_CACHE_DIR="$(UV_CACHE_DIR)" XDG_DATA_HOME="$(XDG_DATA_HOME)" $(UV) venv .venv --python "$(PYTHON312)"

install:
	UV_CACHE_DIR="$(UV_CACHE_DIR)" $(UV) pip install -e ".[dev]" --python "$(VENV_PYTHON)"

fmt:
	$(RUFF) format .

lint:
	$(RUFF) check .

typecheck:
	"$(VENV_PYTHON)" -m pyright src/

smoke:
	"$(VENV_PYTHON)" -m unittest tests.test_smoke

test:
	"$(VENV_PYTHON)" -m unittest discover -s tests -p "test_*.py"

check: lint smoke test

fullcheck: lint typecheck smoke test

run:
	@if [ -z "$(GOAL)" ]; then echo "Usage: make run GOAL='please add numbers'"; exit 1; fi
	"$(VENV_PYTHON)" scripts/run_mvp.py "$(GOAL)"

run-deepseek:
	@if [ -z "$(GOAL)" ]; then echo "Usage: make run-deepseek GOAL='please add numbers'"; exit 1; fi
	"$(VENV_PYTHON)" scripts/run_deepseek.py "$(GOAL)"

chat:
	"$(VENV_PYTHON)" scripts/run_chat.py --llm "$(or $(LLM),rule)"

eval:
	@if [ -n "$(CASES)" ]; then \
		"$(VENV_PYTHON)" scripts/run_eval.py --cases "$(CASES)"; \
	else \
		"$(VENV_PYTHON)" scripts/run_eval.py; \
	fi

clean:
	rm -rf .venv .uv-cache .uv-python
