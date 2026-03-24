# GitHub 上线与分发建议

## 结论先行

当前仓库已具备”开箱即用、方便分发”的基础状态：

- `make setup` 一步完成安装，`harness` CLI 即可用
- README 包含完整的 Quickstart、demo 示例输出、Roadmap
- LICENSE (MIT)、CONTRIBUTING.md、CHANGELOG.md 齐全
- GitHub Actions CI 已配置
- 项目定位：一个强调 deterministic / strong-guardrails / testable 的教学型或实验型 agent harness

## 上 GitHub 前建议补齐的内容

### 1. 仓库卫生

需要优先确认不会把本地运行产物和敏感信息带上去：

- 确认 `.env` 不提交
- 确认 `logs/`、`outputs/` 不提交
- 确认本地 `.venv/`、`.uv-*`、`.local-share/` 不提交
- 如已把真实 key 写入本地 `.env`，上传前先轮换密钥

建议补充：

- `.env.example`
- `LICENSE` ✅ 已添加（MIT）
- `CONTRIBUTING.md` ✅ 已添加
- `CHANGELOG.md`（哪怕先从 `0.1.0` 开始）✅ 已添加

### 2. README 需要更像“开源首页”

当前 README 已经能说明功能，但对陌生用户还差几个关键问题的直接回答：

- 这项目解决什么问题
- 适合谁，不适合谁
- 5 分钟内怎么跑起来
- 最小示例输出长什么样
- 当前边界是什么
- 下一阶段 roadmap 是什么

建议 README 首页结构改成：

- 项目一句话定位
- 特性列表
- 非目标 / 当前边界
- Quickstart
- 最小 demo
- 架构概览
- 分发与安装方式
- Roadmap

### 3. “如何使用” 还不够标准化

现在主要依赖：

- `scripts/run_mvp.py`
- `scripts/run_deepseek.py`
- `make` 命令

这对你自己够用，但对外部分发还不够友好。陌生用户通常更期待：

- `pip install ...`
- 安装后直接执行 CLI
- 不需要手改 `sys.path`

## 为了方便分发，建议的设计方向

### 方案 A：先做“源码仓库 + CLI 入口”

这是最适合当前阶段的方案，成本低，收益高。

核心设计：

- 保持 `src/` 布局
- 把运行入口从 `scripts/*.py` 收敛到正式 CLI
- 在 `pyproject.toml` 里声明 console script

例如：

- `harness-demo`
- `harness-deepseek`

这样用户安装后可以直接执行命令，而不是运行脚本文件。

这一步完成后，仓库会从“开发脚本项目”升级成“可安装项目”。

### 方案 B：把“库”和“演示入口”分层

为了更容易复用和二次开发，建议把代码分成两层：

- library layer：`src/harness/*`
- app/cli layer：命令行入口、demo 运行方式、参数解析

分层目标：

- 想读架构的人，只看库层
- 想直接跑的人，只用 CLI
- 想二次开发的人，可以 import 你的核心类型与 agent loop

对外 API 最好尽量稳定：

- `HarnessAgent`
- `RunConfig`
- `DeepSeekLLM`
- 若后续扩展工具系统，再暴露清晰的 tool registration API

### 方案 C：把 provider 做成可插拔

当前仓库已经出现了 `RuleBasedLLM` 和 `DeepSeekLLM` 两类入口，这是很好的分发基础。

为了后续更方便推广，建议继续坚持：

- 核心 loop 不绑定具体模型厂商
- provider 只是实现统一 `generate(...)` 接口
- README 把“本地 stub / DeepSeek / future providers”区分清楚

这样后续可以自然演进为：

- `harness[deepseek]`
- `harness[openai]`
- `harness[dev]`

即使现在还不做 extras，结构上也要朝这个方向设计。

## 分发友好的最小落地清单

如果目标是“别人 clone 或 pip install 后能在 5 分钟内跑起来”，建议优先做下面几件事：

1. 补 `LICENSE`
2. 补 `.env.example`
3. 补一个正式 CLI 入口，而不是只保留 `scripts/*.py` ✅ `harness` CLI 已通过 `pyproject.toml` 注册
4. README 增加最小 demo 输入/输出示例 ✅ 已添加 Expected output 示例
5. 去掉入口脚本里的 `sys.path` 注入，改为安装后执行
6. 明确日志、输出、快照目录策略
7. 在 GitHub Actions 上跑测试和 lint ✅ `.github/workflows/ci.yml` 已配置

## 日志与输出目录的分发建议

当前仓库里已有：

- `logs/`
- `outputs/`

这对本地实验方便，但对分发要注意边界：

- 不建议把运行产物长期保存在仓库目录并提交
- 建议默认运行时自动创建目录，但 `.gitignore` 忽略内容
- 更理想的方式是允许用户通过 CLI 参数指定输出目录

建议策略：

- 默认写入项目内 `logs/`、`outputs/`，适合 demo
- 同时支持 `--log-dir`、`--output-dir`、`--snapshot-dir`
- 文档中明确“这些目录属于运行产物，不是源码的一部分”

## GitHub 首页定位建议

建议把项目描述成：

> HAU — Harness for Yourself. A testable single-agent harness with strict schemas and reliability guardrails.

这个定位比“通用 agent framework”更可信，也更符合当前完成度。

## 不建议现在就做的事

为了方便分发，不建议过早引入：

- 多 agent 架构
- 很多工具插件
- 自动 planner
- 复杂长期记忆
- 过重的配置系统

当前最重要的是把已有 MVP 包装成：

- 容易理解
- 容易安装
- 容易跑起来
- 容易扩展

## 推荐推进顺序

1. 先整理 GitHub 上线材料：README、LICENSE、`.env.example`、`.gitignore`
2. 再把运行入口升级成正式 CLI
3. 然后补 GitHub Actions
4. 最后再考虑 PyPI 发布和 provider/plugin 扩展

## 一句话判断标准

如果一个陌生开发者在 5 分钟内可以完成下面流程，就说明这个项目已经具备较好的分发友好性：

1. clone 仓库
2. 按 README 安装
3. 运行一条 demo 命令
4. 看懂输出结果
5. 知道下一步如何替换模型或扩展工具
