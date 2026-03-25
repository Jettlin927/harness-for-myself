# HAU 快速上手

## 安装

```bash
# 全局安装
npm install -g hau

# 或通过 npx 直接使用
npx hau chat
```

## 环境配置

设置 Anthropic API Key：

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

或在项目根目录创建 `.env` 文件：

```
ANTHROPIC_API_KEY=sk-ant-...
```

## 基本用法

### 交互式对话

```bash
harness chat
```

支持的交互命令：
- `/help` — 查看帮助
- `/skills` — 列出可用 Skill
- `/agents` — 列出可用 Agent
- `/status` — 查看当前状态
- `/trust <level>` — 切换权限级别（ask / auto-edit / yolo）
- `/clear` — 清空对话

### 单次任务

```bash
harness run --goal "读取 src/main.ts 并添加错误处理"
```

### 恢复会话

```bash
# 列出历史会话
harness session list

# 恢复指定会话
harness resume <session-id>
```

### 运行评估

```bash
harness eval --cases eval-cases.json
```

## 配置选项

```bash
harness chat --provider anthropic --model claude-sonnet-4-20250514
harness chat --trust yolo          # 自动执行所有工具（慎用）
harness chat --max-turns 20        # 限制最大轮数
harness chat --token-budget 50000  # 限制 token 预算
```

## 编程工具

HAU 内置 7 个编程工具，agent 可自主调用：

| 工具 | 功能 |
|------|------|
| `read_file` | 读取文件内容（支持行范围） |
| `edit_file` | 精确字符串替换编辑 |
| `write_file` | 创建或覆盖文件 |
| `run_bash` | 执行 shell 命令 |
| `glob_files` | 按模式搜索文件 |
| `grep_search` | 正则搜索文件内容 |
| `list_directory` | 列出目录内容 |

## 权限级别

| 级别 | 行为 |
|------|------|
| `ask` | 每次工具调用都需确认 |
| `auto-edit` | 读取类工具自动执行，写入类需确认 |
| `yolo` | 所有工具自动执行 |
