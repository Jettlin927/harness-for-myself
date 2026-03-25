# 模块 14: CLI (cli.py → cli.ts)

## 概述

命令行入口，子命令包含 run、resume、chat、session、eval。

---

## TS 技术选型

- 参数解析：`commander`
- 入口：`#!/usr/bin/env node` + package.json `bin` 字段

---

## 子命令

### `harness run <goal>`
- `--project-root <path>` — 项目目录，默认 cwd
- `--no-bash` — 禁用 bash 工具
- `--context <json>` — 额外上下文 JSON
- `--goal-reached-token <str>` — 提前停止标记

### `harness resume <snapshot>`
- `--goal-reached-token <str>`

### `harness chat`
- `--project-root <path>`
- `--no-bash`
- `--new-session` — 强制新会话

### `harness session`
- `--reset` — 删除最新会话
- `-v, --verbose` — 显示摘要

### `harness eval`
- `--cases <path>` — 自定义用例 JSON
- `--output <path>` — 输出报告

---

## 共享参数

- `--llm <rule|deepseek>` — LLM 后端，默认 rule
- `--api-key <str>` — API key
- `--provider <deepseek|anthropic>` — 覆盖 --llm
- `--model <str>` — 覆盖默认模型
- `--trust <ask|auto-edit|yolo>` — 信任级别
- `--max-steps <int>` — 最大步数
- `--snapshot-dir <path>` — 快照目录
- `--log-dir <path>` — 日志目录
- `--config <path>` — StrategyConfig JSON

---

## 内部函数

### `buildLlm(args): BaseLLM`
- provider=anthropic → AnthropicLLM
- provider=deepseek → DeepSeekLLM
- llm=rule → RuleBasedLLM

### `buildRunConfig(args): RunConfig`
- 先加载 StrategyConfig（如有 --config）
- CLI 参数覆盖

### `buildAgent(args): HarnessAgent`
- 组合 buildLlm + buildRunConfig

### `printResult(result): void`
- 输出 final_response、stop_reason、turns、log_path

### `parseContext(raw): Record`
- JSON.parse + 类型校验
