# SDK vs CLI Spawn：Claude Code 集成方式对比

Happy 项目早期从 CLI spawn 演进到 Claude Agent SDK，Multica 目前仍采用 CLI spawn 方式。
本文档对比两种集成方式的优劣势，供技术选型参考。

> **当前状态（2026）**：Happy 的 Claude **Remote 模式已从 SDK `query()` 迁回到 spawn**——
> 用 `node-pty` 包裹真实的 `claude` TUI，会话状态从 JSONL 文件增量扫描得到。这是一种
> 带终端透传的 spawn 变体（见下文「Phase 4」与 `cli-architecture.md` 的「Claude PTY session」章节）。
> 因此本文「SDK 优势」中的运行时动态控制（`setModel`/`setPermissionMode` 等）在当前 Remote
> 模式下**不可用**，改由 `coldModeHash` 冷重启替代。下面的对比仍作为两种范式的选型参考保留。

## 架构对比

| 维度 | CLI Spawn | Claude Agent SDK |
|------|-----------|------------------|
| 集成方式 | `execFile("claude", args)` 启动子进程 | `import { query } from "@anthropic-ai/claude-agent-sdk"` |
| 通信机制 | stdout/stderr 文本流 + 进程信号 | 结构化 `AsyncIterableIterator<SDKMessage>` |
| 会话状态 | 进程存活 = 会话存活，无法程序化访问内部状态 | `Query` 对象暴露 `setModel`、`setPermissionMode` 等运行时控制 |
| 多 Agent 支持 | 天然支持（只要 CLI 在 PATH 上） | 仅限 Claude Code |
| 部署要求 | 目标 CLI 必须已安装在宿主机 | Node.js 依赖，npm 包管理 |

## CLI Spawn 优势

### 1. 通用性强

支持任意 Agent CLI（Claude、Codex、Copilot、Gemini 等），只需知道命令名和参数格式。
Multica 用此方式同时编排 7+ 种 Agent。

### 2. 隔离性好

每个任务是独立进程，崩溃不影响宿主。天然的资源隔离（内存、CPU、文件描述符）。

### 3. 实现简单

核心代码量小（spawn + stdout 解析 + 信号转发），不依赖特定 SDK 版本，无需跟进上游 breaking change。

### 4. 语言无关

Go、Python、Rust 都能 spawn 子进程。Multica 后端用 Go 实现，无需 Node.js 运行时。

## CLI Spawn 劣势

### 1. 粗粒度控制

无法在会话运行中动态切换 model、permission mode、effort level 等参数。
改配置 = 杀进程 + 重启，丢失上下文。

### 2. 消息解析脆弱

stdout 是文本流，需要自行解析 JSON Lines 或其他格式。
格式随 CLI 版本变化可能 break，没有类型安全保障。

### 3. 权限控制受限

只能通过启动参数 (`--dangerously-skip-permissions`) 或环境变量粗放配置。
无法实现 per-tool 级别的动态权限决策（如 `canUseTool` 回调）。

### 4. 无法注入运行时上下文

无法在会话运行中追加 system prompt、注入 MCP server 配置、
或动态修改 allowed/disallowed tools 列表。

### 5. 生命周期管理复杂

需要自行处理：进程心跳检测、僵尸进程清理、信号转发（SIGTERM/SIGINT）、
tmux 会话管理、PID 文件等基础设施。Happy 早期在这些方面踩了大量坑
（`spawn ENOENT`、`EACCES`、`stdin garbled`、信号丢失等）。

### 6. 无结构化事件流

CLI 输出混合了用户可见文本、工具调用结果、错误信息。
拆分这些信息需要大量正则/启发式解析，容易遗漏或误判。

## Claude Agent SDK 优势

### 1. 结构化消息流

每条消息都是强类型的 `SDKMessage`（assistant / user / result / system），
直接可用于 UI 渲染、持久化、分析，无需文本解析。

```typescript
for await (const message of query(prompt, options)) {
  // message 有明确的 type 字段，TypeScript 自动推断
}
```

### 2. 运行时动态控制

通过 `Query` 对象可以在会话运行中随时调整：

| 能力 | API |
|------|-----|
| 切换模型 | `query.setModel("opus")` |
| 切换权限 | `query.setPermissionMode("plan")` |
| 调整 effort | `query.setEffort("high")` |
| 中止会话 | `abortController.abort()` |
| Per-tool 权限 | `canUseTool(toolName, input)` 回调 |

### 3. 会话管理内置

`--resume`、`--continue` 等能力由 SDK 原生支持。
会话持久化、上下文压缩、消息历史都由 SDK 管理，宿主无需自建。

### 4. MCP Server 编程式注入

```typescript
const options = {
  mcpServers: {
    "happy": { command: "node", args: ["mcp-server.js"] },
    "github": { command: "gh", args: ["mcp"] },
  }
};
```

无需修改用户的 `~/.claude/settings.json`，运行时动态注入。

### 5. 系统提示词控制

可以通过 `customSystemPrompt` 和 `appendSystemPrompt` 在不修改文件的情况下
注入上下文（如 session metadata、用户偏好、项目配置）。

### 6. 与上游同步演进

SDK 新功能（thinking mode、beta features、structured output、plugins）
通过升级 npm 包即可获得，无需反向工程 CLI 参数。

## Claude Agent SDK 劣势

### 1. 仅限 Claude Code

无法用同一套代码编排 Codex、Copilot 等其他 Agent。
Happy 的 Codex 集成仍然是 spawn 方式 (`runCodex.ts`)。

### 2. Node.js 依赖

SDK 是 npm 包，后端必须是 Node.js 生态。
Go/Rust/Python 后端无法直接使用。

### 3. 上游 breaking change 风险

SDK 版本升级可能引入不兼容变更，需要维护适配层（如 Happy 的 `queryAdapter.ts`）。
Happy 历史上经历过多次 SDK 升级适配（0.2.86 → 0.2.112 → 0.2.119 → 0.2.140）。

### 4. 调试复杂度

SDK 内部是黑盒，出问题时比 spawn 方式更难排查。
spawn 方式可以直接用 `strace` / `dtrace` 观察进程行为。

## Happy 的演进路线

```
Phase 1: tmux + spawn
  └─ tmux 包裹 claude CLI 进程
  └─ stdout 解析 + 信号转发
  └─ 问题: stdin garbled, signal loss, zombie process

Phase 2: 直接 spawn (无 tmux)
  └─ execFile + 管道
  └─ 仍是文本解析

Phase 3: Claude Agent SDK
  └─ @anthropic-ai/claude-agent-sdk
  └─ 结构化消息流
  └─ 动态控制 (model/permission/effort)
  └─ queryAdapter.ts 适配层

Phase 4: node-pty (当前, Remote 模式)
  └─ startClaudePty 用 node-pty 包裹真实 claude TUI
  └─ 终端字节经 router(ANSI 重放缓冲) → daemonBridge(FIFO+背压) → App
  └─ 反向 App→PTY 走 claudePtyReverseServer (/input /resize /close)
  └─ 消息来自 JSONL 文件增量扫描 (sessionScanner)，类型为 ClaudeJsonl*
  └─ 运行时动态控制不可用，改由 coldModeHash 冷重启
```

## 选型建议

| 场景 | 推荐方式 |
|------|---------|
| 需要编排多种 Agent CLI | Spawn |
| 深度集成 Claude Code，需要细粒度控制 | SDK |
| 后端非 Node.js | Spawn |
| 需要动态权限管理 | SDK |
| 快速原型 / MVP | Spawn（更简单） |
| 生产级产品 | SDK（更可靠） |

## 参考项目

- **Happy**: Remote 模式现为 PTY spawn 方式，`packages/happy-cli/src/claude/pty/`（runtime/router/daemonBridge/reverseServer/controller）+ `claudeRemote.ts`；JSONL 解析层 `packages/happy-cli/src/claude/jsonl/`（原 `sdk/`，类型由 `SDK*` 改名为 `ClaudeJsonl*`，见 commit `b9a95e851`）
- **Multica**: Spawn 方式，Go daemon 编排多种 Agent CLI
