# 模块 15: TUI (tui.py → tui.ts)

## 概述

基于终端的交互式多轮对话界面。

---

## TS 技术选型

- 终端 UI：`ink`（React 风格）或 `chalk` + `ora`（更轻量）
- 输入：`readline` 或 `inquirer`
- 建议先用 chalk + ora 保持简洁

---

## InteractiveSession 类

### 构造函数
```typescript
constructor(options: {
  agent: HarnessAgent;
  sessionDir?: string;
  newSession?: boolean;
})
```

### 属性
- `agent: HarnessAgent`
- `_sessionMgr: SessionManager`
- `_session: SessionState`
- `_totalTokens: number`
- `_projectContext: ProjectContext`
- `_skills: Map<string, SkillDefinition>`
- `_agentDefs: AgentDefinition[]`
- `_autoApproveThisGoal: boolean`

---

## 交互流程

### `start(): void`
1. 打印 banner（项目信息、会话、可用命令）
2. 循环：提示输入 → 处理命令/goal → 执行 → 显示结果
3. Ctrl-C 退出

### 内置命令
- `/help` — 帮助面板
- `/skills` — 列出可用 skill
- `/agents` — 列出可用 agent 定义
- `/status` — 会话状态（ID、goal 数、trust、token 数）
- `/trust <mode>` — 切换信任级别
- `/clear` — 新建会话

### Skill 展开
- `/skillname [extra args]` → 查找 skill body + 追加参数
- 未知 skill → 错误提示 + 列出可用

---

## 渲染

### Turn 渲染（每轮回调）

**工具调用轮：**
- 标题：`Turn N  ⚙ Tool Call`（蓝色）
- 内容：工具名 + 参数（key = value 格式）
- 结果：✓ 成功（绿色）/ ✗ 失败（红色）

**最终响应轮：**
- 标题：`Turn N  ✓ Final Response`（绿色边框）
- 内容：响应文本

**Schema 错误轮：**
- 标题：`Turn N  ⚠ Schema Error`（红色边框）
- 内容：错误信息 + 尝试次数

### Banner 显示
- 行 1：项目语言、分支、信任级别、max_steps
- 行 2：会话 ID（前 8 位）、已完成 goal 数
- 行 3：命令提示
- 行 4：可用 skill 列表
- yolo 模式显示警告

### 运行摘要
- stop_reason（绿色=成功，红色=错误）
- turns 数、耗时、token 估算、日志路径

---

## 审批流程

### `_approveTool(toolName, description, arguments): boolean`
- edit_file → 显示 diff 预览（黄色面板）
- 提示：`[toolName] description (y/n/a):`
  - y → 批准
  - n → 拒绝
  - a → 批准当前 goal 所有后续工具

---

## UI 样式常量

| 名称 | 值 | 用途 |
|------|-----|------|
| ICON_TOOL | ⚙ | 工具调用 |
| ICON_OK | ✓ | 成功 |
| ICON_ERR | ✗ | 失败 |
| ICON_SCHEMA | ⚠ | Schema 错误 |
| ICON_AGENT | ◆ | Agent 标识 |
| ICON_USER | ▸ | 用户提示符 |
