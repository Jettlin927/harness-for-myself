TS_DIR := $(CURDIR)/ts

.PHONY: help setup install fmt lint typecheck build test check fullcheck chat eval clean

help:
	@echo "Available targets:"
	@echo "  make setup              Install npm dependencies"
	@echo "  make install            Same as setup"
	@echo "  make fmt                Format with Prettier (auto-fix)"
	@echo "  make lint               Lint with ESLint"
	@echo "  make typecheck          Type check with tsc --noEmit"
	@echo "  make build              Compile TypeScript to dist/"
	@echo "  make test               Run vitest test suite"
	@echo "  make check              lint + build + test"
	@echo "  make fullcheck          lint + format check + typecheck + build + test"
	@echo "  make chat               Start interactive TUI"
	@echo "  make eval               Run eval suite"
	@echo "  make clean              Remove node_modules and dist"

setup:
	cd "$(TS_DIR)" && npm install

install: setup

fmt:
	cd "$(TS_DIR)" && npx prettier --write 'src/**/*.ts' 'tests/**/*.ts'

fmtcheck:
	cd "$(TS_DIR)" && npx prettier --check 'src/**/*.ts' 'tests/**/*.ts'

lint:
	cd "$(TS_DIR)" && npx eslint src/ tests/

typecheck:
	cd "$(TS_DIR)" && npx tsc --noEmit

build:
	cd "$(TS_DIR)" && npx tsc

test:
	cd "$(TS_DIR)" && npx vitest run

check: lint build test

fullcheck: lint fmtcheck typecheck build test

chat:
	cd "$(TS_DIR)" && node dist/cli.js chat

eval:
	@if [ -n "$(CASES)" ]; then \
		cd "$(TS_DIR)" && node dist/cli.js eval --cases "$(CASES)"; \
	else \
		cd "$(TS_DIR)" && node dist/cli.js eval; \
	fi

clean:
	rm -rf "$(TS_DIR)/node_modules" "$(TS_DIR)/dist"
