# MCP Progress & Session Summary

Live session state（进度清单 + 概要）在 App 的 **Knowledge tab → 进度 sub-tab** 上展示。本文说明这些数据从哪里来、怎么流到 App，以及为什么采用这种设计。

> 核心结论：**清单不是 Claude Code 原生 API 返回的**。我们没有办法"问 Claude Code 当前 todo 状态是什么"。清单是**我们定义的 MCP 工具接收 Agent 主动发来的快照**，或者在缺省时**我们扫消息流自己汇总**。

---

## 1. 两条独立的数据管道

| 路径 | 徽章 | 传输方式 | 由谁汇总 |
|------|------|----------|-----------|
| **MCP（主路）** | `live` | Agent 主动调用 **我们定义的** `mcp__happy__update_progress` / `mcp__happy__update_session_summary` 工具，把完整快照传给我们 | Agent 自己生成（App 只存储 + 渲染） |
| **TodoWrite（降级）** | `TodoWrite` | Agent 调用 Claude Code **内置的** `TodoWrite` 工具，我们**扫会话消息流**截取最后一次 `newTodos` / `todos` | App 端 `computeSessionProgress()` 自己汇总 |

两条路径**都是 Agent 产出的内容**，但传输契约完全不同：
- MCP 是显式契约，Agent 知道是给 App 看的
- TodoWrite 是偷听 —— Agent 以为在记内部笔记

**Claude Code SDK 本身没有暴露 todo / session state 的读接口**，所以没有第三条"原生"路径。

---

## 2. 端到端流程（以 `update_progress` 为例）

```
  ┌────────────┐    ① tool-call       ┌────────────────────┐
  │   Claude   │ ───────────────────▶ │  Happy MCP server  │
  │  (Agent)   │    (update_progress) │  (in CLI process)  │
  └────────────┘                      └──────────┬─────────┘
                                                  │ ② updateMetadata({progress})
                                                  ▼
                                      ┌────────────────────┐
                                      │ ApiSessionClient   │
                                      │ (packages/happy-cli│
                                      │  /src/api/         │
                                      │   apiSession.ts)   │
                                      └──────────┬─────────┘
                                                  │ ③ Socket.IO emit
                                                  │    "update-metadata"
                                                  │    (E2E encrypted blob)
                                                  ▼
                                      ┌────────────────────┐
                                      │   happy-server     │
                                      │ sessionUpdateHandler│
                                      │ 存 metadata column  │
                                      │ 广播 update-session │
                                      └──────────┬─────────┘
                                                  │ ④ broadcast
                                                  ▼
                                      ┌────────────────────┐
                                      │   happy-app        │
                                      │ mergeUpdatedSession│
                                      │ → store.metadata   │
                                      │   .progress        │
                                      └──────────┬─────────┘
                                                  │ ⑤ useSession() 触发重渲染
                                                  ▼
                                      ┌────────────────────┐
                                      │SessionProgressPanel│
                                      │ resolveChecklist() │
                                      │ → 清单卡 / 概要卡   │
                                      └────────────────────┘
```

**关键点**：happy-server **零代码改动**。我们复用现有的 `update-metadata` 事件和 `Session.metadata` 加密 blob，`progress` / `sessionSummary` 只是 blob 里新增的两个可选字段。**不需要迁移 / 新表 / 新 Socket 事件**。

---

## 3. Wire Schema

共享类型定义在 `@kmmao/happy-wire`:

- `packages/happy-wire/src/sessionState.ts`
  - `SessionProgressState`: `{ todos, currentStage?, blockers?, updatedAt }`
  - `SessionSummaryState`: `{ goal, currentFocus?, keyDecisions?, openQuestions?, impactScope?, updatedAt }`
  - `SessionProgressTodo`: `{ content, status, stage? }`

类型在 CLI 侧手工镜像到 `packages/happy-cli/src/api/types.ts::Metadata`；
在 App 侧用 Zod 镜像到 `packages/happy-app/sources/sync/storageTypes.ts::MetadataSchema`。
两侧字段必须保持一致 —— metadata blob 加密在 CLI 侧，解密在 App 侧。

---

## 4. MCP 工具定义

位置：`packages/happy-cli/src/claude/utils/startHappyServer.ts`

### `mcp__happy__update_progress`

- **调用时机**：初次规划后 + 每次状态变化 + 阶段切换（见 system prompt）
- **输入**：完整 todos 数组（全量覆盖，不是 delta）+ 可选 `currentStage` / `blockers`
- **处理**：调用 `client.updateMetadata(meta => ({ ...meta, progress: { todos, currentStage, blockers, updatedAt: Date.now() } }))`
- **返回给 Agent**：`Progress updated (N items).`

### `mcp__happy__update_session_summary`

- **调用时机**：理解用户目标后 + 方向变化 + 重大决策（里程碑驱动，不是每轮）
- **输入**：`goal` 必填 + `currentFocus` / `keyDecisions` / `openQuestions` / `impactScope` 可选
- **处理**：同上，写到 `metadata.sessionSummary`

两个工具通过 `toolNames` 数组暴露给 Claude Code：
```ts
// packages/happy-cli/src/claude/utils/startHappyServer.ts
toolNames: [
  "change_title",
  "query_project_knowledge",
  "update_progress",
  "update_session_summary",
]
```

---

## 5. System Prompt 注入

位置：`packages/happy-cli/src/claude/utils/systemPrompt.ts`

系统提示里**明确要求** Agent 在特定时机调用这两个工具，仿照 `change_title` 的 IMMEDIATELY 模式：

> ## mcp__happy__update_progress — call frequently
> 1. IMMEDIATELY after you plan the first checklist — call this with all items.
> 2. Every time an item changes status — call this again with the full updated list.
> 3. When the plan itself shifts — call this with the new full list.
> 4. If you stop calling this, the Progress tab freezes on an old snapshot.
>
> Rule of thumb: whenever you would update TodoWrite, ALSO call update_progress with the equivalent content.

如果 Agent 不遵守提示（老版本 CLI / Codex 后端 / 上下文被压缩），就会退化到**TodoWrite 降级路径**。

---

## 6. TodoWrite 降级路径

位置：`packages/happy-app/sources/components/session/sessionProgressData.ts`

`computeSessionProgress(messages)` 在 App 端扫描 `useSessionMessages(sessionId)` 返回的消息流：
1. 倒序遍历所有 `tool-call` 类型的消息
2. 找到最后一次 `tool.name === "TodoWrite"`
3. 优先取 `tool.result.newTodos`，回退到 `tool.input.todos`
4. 用 `completedAt ?? startedAt ?? createdAt` 作为时间戳

`resolveChecklist(metadataProgress, messagesAggregate)` 负责三级降级：

```
metadata.progress (MCP, 非空)  →  source: "mcp"     → 徽章 "live"
                 ↓ 空或不存在
message TodoWrite scan (非空)  →  source: "todowrite" → 徽章 "TodoWrite"
                 ↓ 空
                                   source: "none"    → 空态
```

---

## 7. App 端渲染

组件：`packages/happy-app/sources/components/session/SessionProgressPanel.tsx`

三段式布局：

| 区域 | 数据源 | 刷新按钮 |
|------|--------|---------|
| 📖 会话概要 | `metadata.sessionSummary`（仅 MCP） | `[🔄 更新]` → 注入 `update_session_summary` 调用指令 |
| 📋 清单 | `resolveChecklist(...)` | `[🔄 刷新]` → 注入 `update_progress` 调用指令 |
| 👣 足迹 | `computeSessionProgress(...)` 聚合（文件 / 命令 / 轮次） | — |

**注意**：概要卡**只有 MCP 一个源**。TodoWrite 里没有对应的叙事字段可以降级。

每个清单条目可点击，触发 per-status 的 action sheet：

| 状态 | 菜单 |
|------|------|
| ☑ completed | 验证 / 有问题 / 取消 |
| 🔵 in_progress | 验证 / 继续 / 有问题 / 取消 |
| ☐ pending | 继续 / 有问题 / 取消 |

所有动作都是**把模板化 prompt 追加到输入框**（`appendToInput`），用户可编辑后发送 —— Agent 收到后再调 `update_progress` 闭环。

---

## 8. 为什么不用自建 Prisma 字段

最初方案是加 `Session.progressJson` / `Session.summaryJson` 两列，后来对齐 `change_title` 的实现改为复用 `Session.metadata`。原因：

1. **E2E 加密自动继承** —— metadata 是加密 blob，server 看不到明文；单独建列会暴露
2. **零迁移** —— 不用 Prisma migrate，不用改 schema
3. **App 侧订阅自动生效** —— `update-session` 事件本就带 metadata，不用新 Socket channel
4. **前后兼容** —— 老 App 拿到新字段会忽略；新 App 遇到老 metadata 用 `??` 优雅降级

代价：
- metadata blob 在每次任意字段更新时都会整体重传（即使只改了 title 也会带上 progress / summary）
- 需要 CLI 和 App 两侧手工维护类型一致（无 Zod 编译时校验跨包）

对当前数据量（todos 几十项、summary 几段文字），整体重传的带宽代价可以忽略。

---

## 9. 运维 & 已知限制

### Agent 不调 MCP 的情况

- **老版 CLI**：`@kmmao/happy-coder < 0.72` 没有这两个工具。App 会自动降级到 TodoWrite 路径。
- **Codex 后端**：Codex 走的是另一条 MCP 桥接（`happyMcpStdioBridge.ts`），目前也路由到了相同工具；但 Codex Agent 的合规性和 Claude 不同，触发频率较低。
- **用户手动刷新**：`[🔄 刷新]` 按钮注入的 prompt 是"请调用 mcp__happy__update_progress"，强制让 Agent 再发一次。

### 陈旧快照问题

Happy 的一个 session 可以横跨多天多任务。上一任务的 TodoWrite 会滞留在消息流末尾，新任务如果没调 MCP / TodoWrite，进度面板就会展示旧清单。通过以下方式缓解：
- **MCP 主路**：提示词要求 Agent 每切换阶段都重写 `update_progress`（全量覆盖）
- **相对时间显示**：清单卡 header 显示 `updatedAt` 的相对时间，超过一定时间用户能识别陈旧
- **手动刷新按钮**：用户察觉陈旧时一键要 Agent 重发

### 加密边界

`metadata.progress.todos[].content` 和 `metadata.sessionSummary.goal` 等所有字段都在 E2E 加密 blob 内部。happy-server 只保存密文（见 `sessionUpdateHandler.ts`），无法读取内容。只有持有会话密钥的 CLI 和 App 能解密。**写 progress / summary 时请假定内容可能会被 App 以明文展示给用户**（实际就是这么用的）。

---

## 10. 引用文件（file:line）

- **Wire**：`packages/happy-wire/src/sessionState.ts`
- **CLI MCP 工具**：`packages/happy-cli/src/claude/utils/startHappyServer.ts`（`progressHandler` / `summaryHandler` / `registerTool("update_progress")` / `registerTool("update_session_summary")`）
- **CLI 系统提示**：`packages/happy-cli/src/claude/utils/systemPrompt.ts`
- **CLI 类型**：`packages/happy-cli/src/api/types.ts::Metadata`
- **CLI metadata 更新**：`packages/happy-cli/src/api/apiSession.ts::updateMetadata`
- **Server 处理器**：`packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts::update-metadata`
- **App schema**：`packages/happy-app/sources/sync/storageTypes.ts::MetadataSchema`
- **App 聚合器**：`packages/happy-app/sources/components/session/sessionProgressData.ts`
- **App 面板**：`packages/happy-app/sources/components/session/SessionProgressPanel.tsx`
- **App 订阅 merge**：`packages/happy-app/sources/sync/updateSessionMerge.ts`

---

## 11. FAQ

**Q: 为什么不直接读 Claude Code 的 TodoWrite 状态？**
A: Claude Code SDK 没有暴露这种接口。TodoWrite 是 Claude 用的一个 tool，它的 input/result 只能在消息流里看到，没有"查询当前状态"的 API。

**Q: MCP 和 TodoWrite 会打架吗？**
A: 不会。MCP 存在 `metadata.progress`，TodoWrite 扫消息流。`resolveChecklist` 永远优先 MCP。它们可以同时存在，App 只展示 MCP 版本。

**Q: 如果 Agent 同时调了两个工具但内容不一致怎么办？**
A: 以 MCP 为准。System prompt 告诉 Agent 两个工具要同步，但如果它"忘了"，那用户看到的是 MCP 里的版本（因为 MCP 是显式声明给用户看的）。

**Q: 我能手动编辑 todos 吗（比如勾选完成）？**
A: 不能。这会造成"用户视角 ≠ Claude 视角"的漂移，下一次 Agent 调 `update_progress` 会覆盖掉用户的改动。正确姿势是点条目选"验证 / 继续 / 有问题"，让 Agent 去改状态。

---

## Last reviewed

- 2026-04-18
