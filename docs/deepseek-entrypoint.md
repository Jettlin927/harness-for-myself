# DeepSeek 运行入口

## 目标
- 提供一个真实 API 驱动的 harness 入口
- 启动时优先检查可用的 DeepSeek API key
- 如果当前环境没有 key，则在终端里向用户索要

## 当前入口

推荐使用多轮交互入口：

```bash
make chat LLM=deepseek
# 或
./.venv/bin/python scripts/run_chat.py --llm deepseek
# 或
harness chat --llm deepseek --api-key sk-...
```

单次运行：

```bash
make run-deepseek GOAL="帮我写一首诗并保存到本地 txt"
# 或
./.venv/bin/python scripts/run_deepseek.py "帮我写一首诗并保存到本地 txt"
```

## API key 解析顺序
1. `--api-key`
2. 环境变量 `DEEPSEEK_API_KEY`
3. 项目根目录 `.env`
4. 终端交互输入

## 当前实现说明
- 使用 DeepSeek 的 OpenAI-compatible Chat Completions 风格接口
- 默认模型：`deepseek-chat`
- `DeepSeekLLM` 会要求模型只返回 harness 需要的 JSON 结构
- 如果模型返回普通文本而不是 JSON，当前实现会保底包成 `final_response`
- 如果是通过交互输入拿到 key，程序会自动把它写回项目根目录 `.env`
- 当前默认开放的本地写入目录是 `~/Desktop/test`
- DeepSeek 入口会把 `allowed_write_dir` 和保存提示放进运行上下文，方便模型主动调用 `write_text_file`

## 注意
- 首次真实调用需要网络可用
- 自动写回仅针对项目根目录 `.env`，不会自动修改用户的 shell 配置文件
