# 模块 3: 工具系统 (tools.py + coding_tools.py → tools.ts + coding-tools.ts)

## 概述

工具注册、路由和执行引擎，包含 4 个内置工具和 7 个编程工具。

---

## ToolDispatcher 类

### 构造函数

```typescript
constructor(options?: { allowedWriteRoots?: string[] })
```

- `allowedWriteRoots`：写操作允许的绝对路径前缀列表
- 初始化时自动注册 4 个内置工具：`echo`、`add`、`utc_now`、`write_text_file`

### 字段

- `_tools: Map<string, (args: Record<string, unknown>) => unknown>`
- `_schemas: Map<string, Record<string, unknown>>`
- `allowedWriteRoots: string[]`

### 方法

#### `registerTool(name, tool, schema?): void`
- 注册工具函数和可选 JSON Schema
- 同名注册会覆盖

#### `getToolSchemas(): ToolSchema[]`
- 返回 Anthropic 兼容格式：`{ name, description, input_schema }`

#### `execute(toolName, arguments): ToolExecutionResult`
- 查找工具 → 未找到返回 `{ ok: false, error: "Unknown tool: ..." }`
- 执行工具：
  - `RetryableToolError` → `{ ok: false, retryable: true }`
  - 其他异常 → `{ ok: false, retryable: false }`
  - 成功 → `{ ok: true, output: ... }`

---

## 内置工具

### echo
- 参数：`text: string`
- 返回：`{ echo: text }`

### add
- 参数：`a: number, b: number`
- 返回：`{ sum: a + b }`
- 校验：a、b 必须是数字，否则 ValueError

### utc_now
- 参数：无
- 返回：`{ utc: "ISO 8601 string" }`

### write_text_file
- 参数：`path: string, content: string`
- 返回：`{ path, bytes_written }`
- 校验：path 必须绝对路径、在 allowedWriteRoots 内、content 非空

---

## 编程工具（coding-tools.ts）

### read_file
- 参数：`path: string, offset?: number (默认 1), limit?: number (默认 200)`
- 返回：`{ content: string (带行号), lines: number, truncated: boolean }`
- 行号格式：`"     1\tline content"` (5 位右对齐 + tab)
- 校验：绝对路径、文件存在、UTF-8

### edit_file
- 参数：`path: string, old_text: string, new_text: string`
- 返回：`{ path, replacements: 1, diff: string }`
- 校验：
  - old_text 必须在文件中出现**恰好 1 次**
  - 0 次 → 错误 "old_text not found"
  - >1 次 → 错误 "Found N matches, provide more context"
- diff：unified diff 格式

### write_file
- 参数：`path: string, content: string`
- 返回：`{ path, bytes_written }`
- 校验：文件**不得已存在**（防止覆盖，引导用 edit_file）

### run_bash
- 参数：`command: string, timeout?: number (默认 30s)`
- 返回：`{ stdout, stderr, returncode }`
- 超时：returncode = -1，stderr 包含超时信息
- 使用 `child_process.execSync` 或 `execa`

### glob_files
- 参数：`pattern: string, root: string, limit?: number (默认 100)`
- 返回：`{ matches: string[], total: number, truncated: boolean }`
- 校验：root 必须是绝对路径、存在的目录

### grep_search
- 参数：`pattern: string (regex), root: string, include?: string, limit?: number (默认 50), context_lines?: number (默认 0)`
- 返回：`{ matches: [{ path, line, content }], total, truncated }`
- 跳过目录：`.git`、`node_modules`、`__pycache__`
- 静默跳过：非 UTF-8 文件、权限不足

### list_directory
- 参数：`path: string`
- 返回：`{ entries: [{ name, type: "file" | "directory" }] }`
- 按名称字母排序

---

## 工具注册函数

### `registerCodingTools(dispatcher, options?): void`

```typescript
function registerCodingTools(
  dispatcher: ToolDispatcher,
  options?: {
    allowBash?: boolean;      // 默认 true
    projectRoot?: string;     // 提供时注册 memory 工具
  }
): void
```

注册所有 7 个编程工具到 dispatcher。若 projectRoot 提供，额外注册 `save_memory` 和 `recall_memory`。

---

## 测试覆盖要点

- read_file：小文件、offset/limit、大文件截断、相对路径、不存在、二进制文件
- edit_file：单次匹配、未找到、多次匹配、diff 格式、替换正确性
- write_file：创建新文件、创建父目录、拒绝覆盖、相对路径
- run_bash：echo、失败命令、超时
- glob_files：基础 glob、递归 `**/*.py`、空匹配、limit 截断
- grep_search：基础搜索、include 过滤、regex、无匹配、limit、二进制跳过、context_lines
- list_directory：文件和目录、空目录、相对路径、不存在、非目录
