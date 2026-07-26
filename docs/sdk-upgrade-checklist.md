# Claude Agent SDK 升级集成清单

本文档是 Happy 集成 `@anthropic-ai/claude-agent-sdk` 新版本时的执行入口。

它只回答四件事：

- 这次升级要检查哪些集成面
- 当前仓库已经接了什么
- 还需要做哪些回归验证
- 文档后续应该怎么维护

不在这里重复完整能力说明；能力矩阵看 `docs/sdk-features.md`，CLI 结构看 `docs/cli-architecture.md`。

## 当前基线

- SDK 版本：`packages/happy-cli/package.json` 中为 `@anthropic-ai/claude-agent-sdk@0.3.143`
- 升级路径：`0.2.86 → 0.2.112 → 0.2.119 → 0.2.140 → 0.2.141 → 0.3.142 → 0.3.143`
- 0.2→0.3 主版本跳跃要点：`Query` 从 type 变为 interface（`import type` 兼容），`SDKMessage` 联合类型新增成员，SDK 内部使用 `zod/v4`

## 升级时要看的集成面

每次 SDK 升级都按下面 5 个面检查，避免只看编译通过。

### 1. 会话构造参数

关注新版本是否新增了会影响 session 初始化的参数，或改变了已有参数的语义。

当前仓库已纳入冷重启哈希的相关字段：

- `fallbackModel`
- `customSystemPrompt`
- `appendSystemPrompt`
- `maxBudgetUsd`
- `thinking`
- `effort`
- `taskBudget`
- `locale`
- `betas`
- `agent`
- `agents`
- `outputFormat`
- `plugins`
- `additionalDirectories`
- `hooks`
- `toolAliases`
- `sessionId`
- `persistSession`

注意：`allowedTools` / `disallowedTools` 已从冷重启哈希移除，改为通过 `applyFlagSettings()` 热切换。

关键代码：

- `packages/happy-cli/src/claude/claudeRemoteLauncher.ts`

检查项：

- [ ] 新增 SDK 参数已明确归类为“热切换”或“冷重启”
- [ ] 冷重启哈希覆盖了所有真正影响 session 构造的字段
- [ ] 未被 Happy 消费的新字段不会静默丢失或造成错误默认值

### 2. 运行时热切换能力

关注 SDK 是否新增或调整了 runtime setter，例如 `setModel()`、`setPermissionMode()`。

当前仓库已接入：

- mid-turn `setModel()`
- mid-turn `setPermissionMode()`
- mid-turn `applyFlagSettings()` — 热切换 `allowedTools` / `disallowedTools` 等 Settings 字段
- mid-turn `setMcpServers()` — 热切换 MCP 服务器配置（add / remove / toggle）

其中 `permissionMode` 当前策略是：

- 非 `plan`、非 `bypassPermissions` 之间允许热切换
- 涉及 `plan` 或 `bypassPermissions` 边界时继续走冷重启

关键代码：

- `packages/happy-cli/src/claude/claudeRemoteLauncher.ts`
- `packages/happy-cli/src/claude/claudeRemote.ts`

检查项：

- [ ] 热切换能力与 SDK 当前版本能力表一致
- [ ] 允许热切换的字段不会误触发冷重启
- [ ] 必须冷重启的字段不会误走热切换
- [ ] UI/上层模式切换语义与底层实际行为一致

### 3. result / lifecycle 结果透传

关注 SDK result message 是否新增字段，或终态语义是否有变化。

当前仓库已接入：

- `terminal_reason -> terminalReason`
- `total_cost_usd`
- `num_turns`
- `modelUsage`
- `error_max_turns -> onMaxTurnsReached()`

关键代码：

- `packages/happy-cli/src/claude/claudeRemote.ts`

检查项：

- [ ] 新增 result 字段被正确提取并向上透传
- [ ] 正常完成、取消、中断、max-turns 等终态都能得到一致结果
- [ ] 上层存储、展示、分析逻辑对新增字段兼容

### 4. 协议与消息流兼容性

关注 SDK 新能力是否引入了新的事件、角色、状态或消息结构。

当前升级重点：

- `needs-continue` / max-turns 继续态
- `requires_action` / session state 相关语义
- Agent 相关配置与事件兼容性

检查项：

- [ ] 增量流与历史回放对同一语义的恢复一致
- [ ] 新角色、新状态、新事件不会被类型白名单静默过滤
- [ ] App / Server / wire schema 对新增字段保持兼容
- [ ] reconnect / cold start 后不会只恢复部分状态

### 5. Agent 扩展能力

SDK 升级经常会扩展 Agent 定义、Agent tool 行为或多 agent 配置能力。这一层不能只看类型通过，要看 Happy 是否把它当成真正的 session 输入。

当前仓库已知落点：

- `agent`
- `agents`
- `outputFormat`
- `plugins`
- `additionalDirectories`

这些字段已经进入冷重启哈希，说明它们被视为 session 构造参数。

检查项：

- [ ] 单 agent 配置变更的行为符合预期
- [ ] 多 agent 配置透传后，CLI 启动行为与 SDK 行为一致
- [ ] Agent tool 相关事件在协议层没有字段丢失
- [ ] App / Server 面对新增 Agent 元数据不会报错

## 当前版本的重点核对项

针对 `0.3.143`，当前应把验证重点收敛到下面几项：

### A. 热切换能力

- [x] `default -> acceptEdits` 不重启会话
- [x] `acceptEdits -> default` 不重启会话
- [x] `plan <-> 非 plan` 仍触发冷重启
- [x] `bypassPermissions <-> 其他` 仍触发冷重启
- [x] `applyFlagSettings()` 热切换 permissions 不重启会话
- [x] `setMcpServers()` 热切换 MCP 配置不重启会话
- [ ] MCP add/remove 通过 App RPC 端到端验证

### B. MCP Server 管理

- [x] 注册/注销 MCP 服务器持久化到 KV 注册表
- [x] 受保护服务器 (`happy`) 不可被覆盖或删除
- [ ] App → RPC → CLI 端到端 MCP 服务器热加载
- [ ] App → REST API → KV 注册表 CRUD 操作
- [ ] 注册表跨设备同步正常

### C. 新 Options 字段

- [x] `hooks` — 透传到 SDK，不影响现有 RPC 机制
- [x] `toolAliases` — 透传到 SDK
- [x] `sessionId` / `resumeSessionAt` — 透传到 SDK
- [x] `sessionStoreFlush` / `persistSession` — 透传到 SDK
- [ ] `hooks` + `PostToolUse` 回调实际生效验证

### D. Session Management

- [x] `listSessions` / `getSessionInfo` RPC 正常
- [x] `deleteSession` / `renameSession` RPC 正常
- [x] `getSessionMessages` RPC 正常
- [ ] App 端会话浏览 UI 使用这些 RPC 的端到端验证

## 最小回归矩阵

每次 SDK 升级后，至少跑下面一轮：

### CLI 层

- [ ] 新建 Claude session 成功
- [ ] 普通问答成功
- [ ] 工具调用成功
- [ ] `/compact`、`/clear`、shell command 无回归
- [ ] turn 完成后 usage / cost / context usage 正常

### 会话切换层

- [ ] mid-turn model 切换正常
- [ ] mid-turn permission mode 切换正常
- [ ] 需要冷重启的切换路径不会误走热切换

### App / Server 层

- [ ] 消息列表与输入框状态正常
- [ ] prompt suggestion 正常显示与清理
- [ ] continue / requires_action 状态正常展示
- [ ] reconnect / cold start 后历史恢复正常

## 文档分工

这份文档只维护“升级如何集成与验证”。

相关信息放置规则：

- `docs/sdk-upgrade-checklist.md`：升级入口、当前版本核对项、回归矩阵
- `docs/sdk-features.md`：长期能力矩阵与能力差异
- `docs/cli-architecture.md`：CLI / daemon / session 架构说明
- 具体一次升级的结论：写回对应 PR、提交信息或专项实现文档，不在这里堆积历史流水账

## 维护规则

更新这份文档时，优先做下面几类变更：

1. SDK 升级后，更新“当前基线”版本号。
2. 新增 runtime setter、result 字段、agent 配置项时，补到对应集成面。
3. 出现真实回归后，把问题沉淀到对应检查项，不要只写抽象描述。
4. 已经不再相关的历史说明直接删掉，不保留“完成后归档讨论”这类一次性内容。

这份文档应保持短、准、可执行。它不是历史记录，也不是能力总表。
