# MCP Progress & Session Summary

Live session state（进度清单 + 概要）由 App 侧面板展示。本文说明这些数据从哪里来、怎么流到 App，以及为什么采用这种设计。

> 核心结论：**清单不是 Claude Code 原生 API 返回的**。我们没有办法"问 Claude Code 当前 todo 状态是什么"。清单是通过三条管道汇合而来：Agent 显式 MCP 调用、CLI 自动镜像 TodoWrite、App 兜底扫消息流。

---

## 1. 三条数据管道

| 路径 | 徽章 | 触发方 | 写入位置 | 谁汇总 |
|------|------|--------|----------|---------|
| **MCP 显式（主路）** | `live` | Agent 主动调用 `mcp__happy__update_progress` / `mcp__happy__update_session_summary` | `metadata.progress` / `metadata.sessionSummary` | Agent 自己传完整快照 |
| **CLI 自动镜像（主路）** | `live` | CLI 进程在 `onMessage` 里看到任何 `TodoWrite` tool_use 时自动触发 | `metadata.progress` | CLI 从 TodoWrite 的 `input.todos` 直接提取 |
| **App 端扫描（降级）** | `TodoWrite` | App 渲染时在消息流里找最后一次 `TodoWrite` tool-call | 不写存储，只在 App 内存派生 | App 端 `computeSessionProgress()` |

**前两条路径都写入 `metadata.progress`**，App 看到的就是"`live` 数据"；区分是否为 Agent 显式调对 UI 不影响。第三条只在前两条都没发生（老 CLI < 0.71.36 / Codex / 只写了消息但没触发镜像）时作为兜底。

**Claude Code SDK 本身没有暴露 todo / session state 的读接口**，所以没有第四条"原生"路径。

---

## 2. 端到端流程

```
                ┌─────────────────────── Claude (Agent) ───────────────────────┐
                │                                                              │
  ┌───── ① 调 mcp__happy__update_progress (显式)         ─┐                    │
  │                                                        │                    │
  │     ② 调 TodoWrite (内部规划)                          │                    │
  │      └─ CLI onMessage 看到 tool_use ──────────────┐    │                    │
  │                                                    │    │                   │
  └────────────────────────────────┬───────────────────┘    │                   │
                                   │                        │                   │
                                   ▼                        ▼                   │
                      ┌─────────────────────┐  ┌─────────────────────┐         │
                      │ CLI Auto-Mirror     │  │ Happy MCP Server    │         │
                      │ (claudeRemote       │  │ (startHappyServer)  │         │
                      │  Launcher.ts        │  │                     │         │
                      │  onMessage hook)    │  │                     │         │
                      └──────────┬──────────┘  └──────────┬──────────┘         │
                                 │                        │                     │
                                 └────────┬───────────────┘                     │
                                          ▼                                     │
                            ┌─────────────────────────────┐                     │
                            │ ApiSessionClient            │                     │
                            │ .updateMetadata({progress}) │                     │
                            │ (packages/happy-cli/src/    │                     │
                            │  api/apiSession.ts)         │                     │
                            └──────────┬──────────────────┘                     │
                                       │ Socket.IO "update-metadata"            │
                                       │ (E2E encrypted blob)                   │
                                       ▼                                        │
                            ┌─────────────────────────────┐                     │
                            │ happy-server                │                     │
                            │ sessionUpdateHandler        │                     │
                            │ 存 Session.metadata 列       │                     │
                            │ 广播 "update-session"        │                     │
                            └──────────┬──────────────────┘                     │
                                       │                                        │
                                       ▼                                        │
                            ┌─────────────────────────────┐                     │
                            │ happy-app                   │                     │
                            │ mergeUpdatedSession         │                     │
                            │ → store.metadata.progress   │                     │
                            └──────────┬──────────────────┘                     │
                                       │                                        │
                                       ▼                                        │
                            ┌─────────────────────────────┐                     │
                            │ SessionProgressPanel        │                     │
                            │ resolveChecklist():         │                     │
                            │   MCP/Auto → TodoWrite → 空 │                     │
                            └─────────────────────────────┘                     │
                                                                                │
 ③ 前两条路径都没发生时 → App 端 computeSessionProgress() 扫消息流兜底           │
                                                                                │
                                                                                ┘
```

**关键点**：happy-server **零代码改动**。我们复用现有的 `update-metadata` 事件和 `Session.metadata` 加密 blob；`progress` / `sessionSummary` 只是 blob 里新增的两个可选字段。**不需要迁移 / 新表 / 新 Socket 事件**。

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

## 4. MCP 工具定义（显式路径）

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
  "update_progress",
  "update_session_summary",
]
```

---

## 5. CLI 自动镜像（TodoWrite → metadata.progress）

位置：`packages/happy-cli/src/claude/claudeRemoteLauncher.ts::onMessage`

CLI 在处理每条 assistant message 时，**同步**扫 `content` blocks 里的 `tool_use`：如果见到 `name === "TodoWrite"`，就**立即**把 `input.todos` 提取出来，调 `session.client.updateMetadata()` 写入 `metadata.progress`。

```ts
if (c.type === "tool_use" && c.name === "TodoWrite") {
  const raw = (c.input as Record<string, unknown>)?.todos;
  const mirrored = Array.isArray(raw) ? raw.filter(validate).map(normalize) : [];
  if (mirrored.length > 0) {
    session.client.updateMetadata((m) => ({
      ...m,
      progress: {
        todos: mirrored,
        currentStage: m.progress?.currentStage,   // 保留
        blockers: m.progress?.blockers,           // 保留
        updatedAt: Date.now(),
      },
    }));
  }
}
```

**特性**：

| 属性 | 说明 |
|------|------|
| **零 Agent 感知** | CLI 进程在后台做，Agent 不会多消耗一个 turn / 一个 token |
| **每次 TodoWrite 都触发** | 初次规划 / 标完成 / 切阶段 / 增删项 —— 所有 TodoWrite 调用都镜像 |
| **与 MCP 显式路径互补** | `currentStage` / `blockers` 字段保留上一次写入值；Agent 显式调 `update_progress` 可以覆盖这两个字段，但 todos 会在下次 TodoWrite 时被重新镜像 |
| **容错** | 包裹 `try/catch`，坏 payload 不会打断消息流 |
| **可用版本** | `@kmmao/happy-coder >= 0.71.36` |

**效果**：即使 Agent 完全不调 MCP，只要它用 Claude Code 自带的 TodoWrite 工具规划，App 就能实时看到清单变化。这把"进度同步"从"靠 Agent 自觉"变成"CLI 底层保底"。

---

## 6. System Prompt 注入

位置：`packages/happy-cli/src/claude/utils/systemPrompt.ts`

系统提示里要求 Agent 在特定时机显式调用 `update_progress` 和 `update_session_summary`，仿照 `change_title` 的模式：

> ## mcp__happy__update_progress — call frequently
> 1. IMMEDIATELY after you plan the first checklist — call this with all items.
> 2. Every time an item changes status — call this again with the full updated list.
> 3. When the plan itself shifts — call this with the new full list.
> 4. Whenever you would update TodoWrite, ALSO call update_progress with the equivalent content.
>
> ## mcp__happy__update_session_summary — call SPARINGLY at true milestones
> - Call ONLY when no summary exists / direction shifts / major decision / open question.
> - DO NOT bundle with update_progress (they run on independent schedules).
> - DO NOT re-call on every new turn if the existing summary is still accurate.

即使 Agent 违反这些指令，CLI 自动镜像（§5）也能保证 `progress` 字段不落后 —— 不过 `currentStage` / `blockers` 和 `sessionSummary` 仍然完全依赖 Agent 显式调。

---

## 7. App 端扫描（兜底路径）

位置：`packages/happy-app/sources/components/session/sessionProgressData.ts`

`computeSessionProgress(messages)` 在 App 端扫描 `useSessionMessages(sessionId)` 返回的消息流：
1. 倒序遍历所有 `tool-call` 类型的消息
2. 找到最后一次 `tool.name === "TodoWrite"`
3. 优先取 `tool.result.newTodos`，回退到 `tool.input.todos`
4. 用 `completedAt ?? startedAt ?? createdAt` 作为时间戳

`resolveChecklist(metadataProgress, messagesAggregate)` 负责三级降级：

```
metadata.progress (MCP/auto-mirror, 非空)  →  source: "mcp"      → 徽章 "live"
                 ↓ 空或不存在
message TodoWrite scan (非空)              →  source: "todowrite" → 徽章 "TodoWrite"
                 ↓ 空
                                              source: "none"     → 空态
```

**何时会退到 App 扫描？** 使用 `happy-coder < 0.71.36` 的机器（无 auto-mirror），且 Agent 没有调 `update_progress`。即使新 CLI 上线后，历史消息流里的 TodoWrite 不会回溯镜像，所以老会话打开时可能仍展示 `TodoWrite` 徽章直到 Agent 下一次写清单。

---

## 8. App 端渲染

组件：`packages/happy-app/sources/components/session/SessionProgressPanel.tsx`

三段式布局：

| 区域 | 数据源 | 刷新按钮 |
|------|--------|---------|
| 📖 会话概要 | `metadata.sessionSummary`（仅 MCP 显式） | `[🔄 更新]` → 注入 `update_session_summary` 调用指令 |
| 📋 清单 | `resolveChecklist(...)` | `[🔄 刷新]` → 注入 `update_progress` 调用指令 |
| 👣 足迹 | `computeSessionProgress(...)` 聚合（文件 / 命令 / 轮次） | — |

**注意**：
- 概要卡**只有 MCP 显式这一条路径**。TodoWrite 不含叙事字段，auto-mirror 也不写 summary。
- 清单卡**有三条路径汇合**（MCP 显式 + auto-mirror → metadata.progress；TodoWrite 扫描降级）。

每个清单条目可点击，触发 per-status 的 action sheet：

| 状态 | 菜单 |
|------|------|
| ☑ completed | 验证 / 有问题 / 取消 |
| 🔵 in_progress | 验证 / 继续 / 有问题 / 取消 |
| ☐ pending | 继续 / 有问题 / 取消 |

所有动作都是**把模板化 prompt 追加到输入框**（`appendToInput`），用户可编辑后发送 —— Agent 收到后再调 `update_progress` 闭环。

---

## 9. 为什么不用自建 Prisma 字段

最初方案是加 `Session.progressJson` / `Session.summaryJson` 两列，后来对齐 `change_title` 的实现改为复用 `Session.metadata`。原因：

1. **E2E 加密自动继承** —— metadata 是加密 blob，server 看不到明文；单独建列会暴露
2. **零迁移** —— 不用 Prisma migrate，不用改 schema
3. **App 侧订阅自动生效** —— `update-session` 事件本就带 metadata，不用新 Socket channel
4. **前后兼容** —— 老 App 拿到新字段会忽略；新 App 遇到老 metadata 用 `??` 优雅降级

代价：
- metadata blob 在每次任意字段更新时都会整体重传（即使只改了 title 也会带上 progress / summary）
- 需要 CLI 和 App 两侧手工维护类型一致（无 Zod 编译时校验跨包）

对当前数据量（todos 几十项、summary 几段文字），整体重传的带宽代价可以忽略。Auto-mirror 在 TodoWrite 密集触发时会产生多次 metadata 更新（每次 TodoWrite 一次），但因为有 `metadataLock` 串行化，不会产生竞态。

---

## 10. 运维 & 已知限制

### 三条路径的生效矩阵

| CLI 版本 | Agent 是否调 MCP | TodoWrite 是否被 Agent 用 | 用户看到 |
|----------|------------------|---------------------------|----------|
| ≥ 0.71.36 | 是 | 任意 | MCP 显式写入（`live` 徽章） |
| ≥ 0.71.36 | 否 | 是 | auto-mirror 写入（`live` 徽章） |
| ≥ 0.71.36 | 否 | 否 | 空态 |
| < 0.71.36 | 是 | 任意 | MCP 显式写入（`live` 徽章） |
| < 0.71.36 | 否 | 是 | App 扫描降级（`TodoWrite` 徽章） |
| < 0.71.36 | 否 | 否 | 空态 |

Codex 后端目前**没有** auto-mirror（只有 Claude 后端的 `claudeRemoteLauncher` 挂了 hook），Agent 必须显式调 MCP 才能走 `live` 徽章。

### 陈旧快照问题

Happy 的一个 session 可以横跨多天多任务。**TodoWrite 全量覆盖语义 + auto-mirror** 天然保证最后一次 TodoWrite 状态会立即推给 App；但如果新任务**完全没用 TodoWrite**（比如小对话、只问答不规划），前一任务遗留的清单会一直停在面板上。通过以下方式缓解：
- **相对时间显示**：清单卡 header 显示 `updatedAt` 的相对时间，超过一定时间用户能识别陈旧
- **手动刷新按钮**：用户察觉陈旧时一键要 Agent 重发
- **Agent 自觉**：系统提示要求 Agent 切换阶段时重写清单

### 加密边界

`metadata.progress.todos[].content` 和 `metadata.sessionSummary.goal` 等所有字段都在 E2E 加密 blob 内部。happy-server 只保存密文（见 `sessionUpdateHandler.ts`），无法读取内容。只有持有会话密钥的 CLI 和 App 能解密。**写 progress / summary 时请假定内容可能会被 App 以明文展示给用户**（实际就是这么用的）。

### Auto-mirror 与 update_progress 的字段合并

Auto-mirror 只写 `todos` + `updatedAt`，**保留**上一次 `metadata.progress` 的 `currentStage` / `blockers`。这样：
- Agent 显式调 `update_progress({ todos, currentStage: "Phase 2", blockers: [...] })` → 三字段都写进去
- Agent 下一次调 TodoWrite → auto-mirror 只改 todos，stage 和 blockers 保留
- Agent 再次显式调 `update_progress({ todos, currentStage: "Phase 3" })` → stage 更新

这避免了 auto-mirror 覆盖掉 Agent 手工设定的阶段/阻塞信息。

---

## 11. 引用文件（file:line）

- **Wire**：`packages/happy-wire/src/sessionState.ts`
- **CLI MCP 工具**：`packages/happy-cli/src/claude/utils/startHappyServer.ts`（`progressHandler` / `summaryHandler` / `registerTool("update_progress")` / `registerTool("update_session_summary")`）
- **CLI Auto-Mirror Hook**：`packages/happy-cli/src/claude/claudeRemoteLauncher.ts::onMessage`（搜 `[progress-mirror]` log prefix）
- **CLI 系统提示**：`packages/happy-cli/src/claude/utils/systemPrompt.ts`
- **CLI 类型**：`packages/happy-cli/src/api/types.ts::Metadata`
- **CLI metadata 更新**：`packages/happy-cli/src/api/apiSession.ts::updateMetadata`
- **Server 处理器**：`packages/happy-server/sources/app/api/socket/sessionUpdateHandler.ts::update-metadata`
- **App schema**：`packages/happy-app/sources/sync/storageTypes.ts::MetadataSchema`
- **App 聚合器**：`packages/happy-app/sources/components/session/sessionProgressData.ts`
- **App 面板**：`packages/happy-app/sources/components/session/SessionProgressPanel.tsx`
- **App 订阅 merge**：`packages/happy-app/sources/sync/updateSessionMerge.ts`

---

## 12. FAQ

**Q: 为什么不直接读 Claude Code 的 TodoWrite 状态？**
A: Claude Code SDK 没有暴露这种接口。TodoWrite 是 Claude 用的一个 tool，它的 input/result 只能在消息流里看到，没有"查询当前状态"的 API。Auto-mirror 就是在这个消息流的 tool_use 事件上挂了个监听。

**Q: MCP 显式调用和 auto-mirror 会打架吗？**
A: 不会。两者都写 `metadata.progress`，后写的覆盖先写的。但 auto-mirror 只写 `todos` 字段（保留 `currentStage` / `blockers`），而显式调用能写全部字段。所以显式调用在有额外字段时更"完整"，auto-mirror 只保证 todos 新鲜。

**Q: MCP 和 TodoWrite 扫描会打架吗？**
A: 不会。`metadata.progress` 一旦有值，`resolveChecklist` 永远优先它，App 端扫描就不会触发。只有 `metadata.progress` 为空（空数组或不存在）时才降级到扫描。

**Q: 如果 Agent 同时调了两个 MCP 工具但内容不一致怎么办？**
A: 以 MCP 为准。System prompt 告诉 Agent 两个工具要同步，但如果它"忘了"，那用户看到的是 MCP 里的版本（因为 MCP 是显式声明给用户看的）。

**Q: 我能手动编辑 todos 吗（比如勾选完成）？**
A: 不能。这会造成"用户视角 ≠ Claude 视角"的漂移，下一次 Agent 调 TodoWrite 或 `update_progress` 会覆盖掉用户的改动。正确姿势是点条目选"验证 / 继续 / 有问题"，让 Agent 去改状态。

**Q: auto-mirror 会不会每个 TodoWrite 调一次 socket，负载高？**
A: Agent 的 TodoWrite 频率通常是每个任务阶段一次（几个/分钟量级），metadata blob 重传也只是几 KB，实际负载可忽略。`metadataLock` + `backoff` 保证并发安全。

**Q: 为什么不给 auto-mirror 单独一个徽章（比如 `auto`）？**
A: 对用户来说 "live" 就够了 —— 关心的是"数据是否新鲜"而不是"谁写的"。MCP 显式和 auto-mirror 都是实时写入，区分它们只会增加 UI 噪音。内部调试可以通过 CLI 日志 `[progress-mirror]` 前缀区分。

---

## 13. Updates (@kmmao/happy-coder 0.71.37 / wire 0.11.8)

**极简 C**：进一步推进"数据驱动"，显式提示词只保留 `summary + title`。

### 新增

- **多 task list / 分代**：`metadata.progress.lists: SessionProgressList[]` + `currentListId`。auto-mirror hook 用 SDK 的 oldTodos 判定边界（`priorAllCompleted && overlap < 30%` → 归档旧 list + 创建新 list）。历史 list 保留最多 20 个，超过淘汰最早的已完成代。
- **`activeForm` 字段**：从 SDK `TodoWriteInput` 透传。App UI 在 `status === "in_progress"` 时优先渲染 activeForm（更动感，例如 "Running tests" 而非 "Run tests"）。
- **`verificationNudgeNeeded` 字段**：从 SDK `TodoWriteOutput` 透传（只对 completed 项打旗）。App UI 在受影响条目旁显示 ⚠️ 徽章，提示用户验证完成的真实性。
- **App UI tab 行**：当 metadata.progress.lists 存在多条时，清单卡上方展示 tab 切换（标签 + 完成度）。用户点 tab 读only查看历史 list；默认跟随活跃 list。

### 变更

- **系统提示大幅削减**：`update_progress` 的常驻指令整段删除。现在 systemPrompt 的 MCP 部分只剩 `change_title` + `update_session_summary`。进度同步靠 auto-mirror 的 tool_use 监听，完全不依赖 Agent 合作。
- **MCP `update_progress` 降级为可选加料通道**：工具仍注册，新增可选 `listId?: "new" | "<uuid>"` 和 `label?: string` 参数，供 Agent 显式控代用。刷新按钮注入的 prompt 也改为请求 Agent 调 TodoWrite（而非调 MCP）。
- **`resolveChecklist` 支持三级降级**：`metadata.progress.lists[currentListId]` → `metadata.progress.todos`（legacy 兼容） → 消息流扫 TodoWrite 兜底。

### 仍保留

- `update_session_summary` 工具 + 系统提示（唯一无 SDK 数据源的路径，必须 Agent 主动写）
- `change_title` 工具 + 系统提示
- 所有刷新按钮 / 条目 tap 菜单 / 概要卡 UI

### 兼容矩阵

| CLI 版本 | 用户看到 |
|---------|---------|
| ≥ 0.71.36 且 ≥ 0.71.37 | 多 list + activeForm + nudge，所有字段可用 |
| 0.71.36 | 单 list auto-mirror，无 activeForm / nudge / 多列表 |
| < 0.71.36 | App 端扫消息流降级（`TodoWrite` 徽章） |

老 App 读取新 metadata：忽略 `lists` / `currentListId` / `activeForm` / `verificationNudgeNeeded`，继续读 legacy `todos` 字段（我们始终保持同步）。
新 App 读取老 metadata：无 `lists` 时自动走 legacy 路径。

### 新 file:line

- **Hook**：`packages/happy-cli/src/claude/claudeRemoteLauncher.ts::onMessage` → 搜 `[progress-mirror]`
- **App helper**：`packages/happy-app/sources/components/session/sessionProgressData.ts::getChecklistTabs`
- **App tab UI**：`packages/happy-app/sources/components/session/SessionProgressPanel.tsx::ChecklistTabRow`

---

## Last reviewed

- 2026-04-18 (0.71.37)
