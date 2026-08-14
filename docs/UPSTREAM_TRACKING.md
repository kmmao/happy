# Upstream PR Tracking

上游仓库: [slopus/happy](https://github.com/slopus/happy)

本文档记录从上游仓库 cherry-pick / port 的 PR 状态，避免重复评估和遗漏。

---

## 上游分叉现状（2026-06-13 sdk-watch 复核）

上游 `slopus/happy` 已与本地大幅分叉，**全量合并不再可行**：

- 构建工具切换 **yarn → pnpm**（`pnpm-lock.yaml` 26066 行、`pnpm-workspace.yaml`、`patches/*.cjs`）
- **happy-wire 大幅削减**：删除 `machineTypes.ts`、`mcpRegistry.ts`、`previewTypes.ts`、`profile.ts`、`replayBuffer.ts`、`sessionState.ts`、`skills.ts`、`spawnSession.ts`、`tailscaleUtils.ts`、`tasks.ts`、`terminal.ts`（本地刚扩展 `terminal.ts`，方向相反）
- **happy-cli 削减**：删除 `webhook/`、`utils/worktreeCleanup`、`tunnel/providers/upnp`
- **happy-app 切到 Tauri 3**（`src-tauri/` 全量改动）
- 上游新增 LiveKit patches、`.agents/skills/` 体系、`docs/competition/`
- **packages/happy-codium → packages/codium** 路径重命名（启用 `--find-renames=50` 后实质差异仅 13 行；本地内嵌 `claude-code 2.1.157` 比上游 `2.1.143` 还新）

**本文档的策略调整**：不再尝试 stat 上游全量 diff；只追踪 `git log upstream/main ^main --since="2 weeks ago"` 的窗口内可选择性 backport 的 bug fix。

---

## 已合并

| PR # | 标题 | 合并 commit | 日期 | 备注 |
|------|------|-------------|------|------|
| #256 | Auto-detect and linkify URLs in messages | `5251098c` | 2026-02 | port 批次 |
| #275 | Auto-focus input on web window focus | `ee11f43d` | 2026-02 | port 批次 |
| #360 | TypeScript fixes + CI typecheck GitHub Action | `c6e62fe6` | 2026-01 | 早期合并 |
| #366 | Shell-style message history (Up/Down arrow on web) | `5251098c` | 2026-02 | port 批次 |
| #373 | Reduce reconnection delays for faster mobile feedback | `ee11f43d` | 2026-02 | port 批次 |
| #549 | Mermaid diagram copy button | `ee11f43d` | 2026-02 | port 批次 |
| #554 | Image upload to AI agent | `a9e55c9b` | 2026-02 | 单独合并，含 i18n |
| #597 | $ / ! prefix shell command execution | `92a81344` | 2026-02 | 和 quick command UI 一起 |
| #633 | Accept non-text tool_result content types | `ee11f43d` | 2026-02 | port 批次 |
| #643 | Deterministic session tags (prevent duplicate sessions) | `b43eba2f` | 2026-02 | 和 #660 一起 |
| #646 | Show daemon label in session list subtitle | `5251098c` | 2026-02 | port 批次 |
| #660 | Remove startup credential logging (security) | `b43eba2f` | 2026-02 | 和 #643 一起 |
| #708 | Add Gemini 3.0 preview models | `b36cac8a` | 2026-02 | 和 #762 #766 一起 |
| #762 | Improve session title prompt with structured triggers | `b36cac8a` | 2026-02 | 和 #708 #766 一起 |
| #766 | Move @types/* to devDependencies | `b36cac8a` | 2026-02 | 和 #708 #762 一起 |
| — | ToolSearch hidden, happy-wire, ACP config, etc. | `5ccc8839` | 2026-02 | 大批 upstream merge (21 commits) |
| — | CLI PATH fallback (from tiann PR #83) | `339b9f65` | 2026-01 | happy-cli 子仓库 PR |
| `72226c73a` | fix: stabilize Claude remote control permissions | (本期 sdk-watch port) | 2026-06-13 | 仅 port `permissionMode.ts` 新增 `resolveRemoteClaudePermissionMode` + `runClaude.ts` 调用点；`claudeLocalLauncher.ts` 等价行为本地已实现，未 port；`currentRunMode` 守卫不适用本地 PTY 架构 |
| — | bump fastify-type-provider-zod 4.0.2→5 for zod 4 compat (相当于上游 `4930809e7` 修复) | (本期 sdk-watch port) | 2026-06-13 | 与 happy-server 已用版本对齐，避免 monorepo 内 4/6 版本分裂；controlServer.ts API 用法兼容 |
| — | settingsParser 拦截 `disableBundledSkills`（claude-code 2.1.169 安全加固） | (本期 sdk-watch port) | 2026-06-13 | 与 `skillOverrides` 同性质，列入 `BLOCKED_KEYS` + 测试 |
| #1408 (`5c804c8a6`) | fix: 首条远程消息在新会话中被丢弃 | (2026-07-06 sdk-watch port) | 2026-07-06 | 删除 `apiSession.ts` 里 `lastSeq === 0` 特判 —— 新会话 socket 送达的首条加密 `seq:1` 消息不再被 `invalidate()+return` 丢弃、改走既有顺序校验立即路由；替换旧的"断言坏行为"测试为"首条消息立即路由、不走 REST catch-up"；与上游字节对齐；本地 1691 测试全过。#1410 其余部分（/goal UX、codexSkills、slash chip 渲染）未 port（本地 /goal 已由 #1428 覆盖，codexSkills 为 Codex 专属，列入监视） |
| #1428 (`d9c0c734c`) | Add authoritative agent goal support | (`912699c55` 已 port) | 2026-07-06 复核 | `claudeGoalStatus.ts` 与上游字节一致；App 端 `agentGoalStatus.ts`/`AgentGoalBar` 齐备 |
| #1470 (`f6adffb42`) | feat(app): add Fable 5 to Claude model picker | (本地已有) | 2026-07-06 复核 | `modelModeOptions.ts:231`、`claudeRemote.ts:157` 已含 Fable 5 |

---

## 已在本地实现 / 不适用（2026-06-06 sdk-watch 自查确认）

下列上游 commit 经本地代码自查，**对应修复已在本地实现，或本地采用了更优架构**，无需 backport：

| Upstream commit | 标题 | 本地状态 | 验证依据 |
|---|---|---|---|
| `f8c0c0dbb` | fix(cli): clear orphaned permission requests on session resume | ✅ 已实现 | `claudeRemoteLauncherCore.ts:911`、`runCodex.ts:873`、`runAcp.ts:601` 三个 backend 都调用 `permissionHandler.reset('Previous CLI process exited before responding')` |
| `1744ff035` | fix(cli): drop SDK-injected isMeta user messages in chat envelope mapper | ✅ 已实现 + 测试 | `jsonlToLogConverter.ts:158-172` 检测 `isSynthetic` 或 `isMeta` 后标 meta；`sessionProtocolMapper.test.ts:572` 有 `classifies an isMeta user message as meta-user-message` 测试 |
| `a038957d2` | fix(cli): propagate SDK isSynthetic as isMeta so skill prompts get hidden | ✅ 已实现 | 同上 — 本地在 `jsonlToLogConverter` 同时处理两个 flag |
| `9c698a591` | Fix newly-created machine missing from live updates (handle new-machine) | ✅ 已实现 | `apiTypes.ts:40` 定义 `ApiUpdateNewMachineSchema`；`sync.ts:2206-2235` 处理 `new-machine` 分支并初始化 machine encryption |
| `c2b9e16a4` | Fix initial socket reconnect handling | ✅ 本地更完善 | 本地 `createSmartReconnect()` 返回 handle，有 `schedule/cancel/shutdown` 完整生命周期 + `socket.io reconnection: false` 防止 Power-Nap WiFi blips 残连接，远超上游 `startSmartReconnect()` 方法 +1 行的简单实现 |
| `22181f796` | fix(server): stop sending per-message push notifications | ✅ 本地架构无此问题 | 本地无 `dispatchNewMessagePush` 或类似 per-message 推送；`pushSend` 仅在 supervisor、machine-update、user 主动 push 路径调用，从不在 session-message 插入触发 |
| `3204dd2f7` | fix(app): render slash commands as a chip, drop raw command echo | ✅ 已实现 + 测试 | `parseLocalCommandMessage.ts` 已解析 `<command-args>`；测试覆盖带参数、空参数、前后空白等场景 |
| docs: `MessageDisplay`/`PostToolUseFailure`/`UserPromptExpansion`/`TeammateIdle` hook events | (2.1.152+) | ✅ 已识别 | `jsonl/jsonlMessageTypes.ts:79,83,95,111` 全部列入类型 |
| docs: `SessionStart.reloadSkills` (2.1.152) | (2.1.152) | ✅ 已支持 | `utils/startHookServer.ts:195,206,359` |
| docs: `terminalSequence` (2.1.141) | (2.1.141) | ✅ 已支持 | `claude/pty/terminalSequences.ts` 全套提取/透传 |
| docs: Opus 4.7/4.8、`/effort xhigh`、`/effort max`、`ultracode` | (2.1.154-160) | ✅ 已支持 | `jsonlMessageTypes.ts:47` 的 `EffortLevel`；`claudeRemote.ts:115,118` 已加 `claude-opus-4-7[1m]` / `claude-opus-4-8[1m]` |
| docs: `CLAUDE_CODE_SESSION_ID` env var (2.1.132, 2.1.163) | — | ✅ 不适用 | Claude Code TUI 自动透传给 stdio MCP 子进程；本项目作为 PTY 包裹层不需要注入 |
| docs: `skillOverrides` (2.1.129) | — | ✅ 主动拦截 | `utils/settingsParser.ts:38` 把 `skillOverrides` 列入禁字段防绕过 |
| `dac6ba51d` (本地) | feat(sdk-watch): align with claude-code 2.1.165, surface TUI terminal-signal end-to-end | — | 上一次 sdk-watch 已完成 2.1.165 形态对齐 |
| `989b8fa6f` | fix(cli): hide compact summaries from chat (upstream Scoteezy 2026-06-08) | ✅ 不适用 | 上游修复的是 SDK `query()` 直接 emit assistant summary 的路径（改 `sdkToLogConverter.ts`、`claudeRemote.ts` 走 SDK 分支）；本地走 PTY 模式，`/compact` 经 TUI 写 `compact_boundary` system message，已被 `jsonlToLogConverter.ts:158-172` 通过 `isMeta` 短路；本地无 `sdkToLogConverter.ts` 文件，本地 `claudeRemote.ts` 已重构走 PTY 路径，原 SDK 代码分支不存在 |
| `b00c1d4b9` + `d51b11c69` | fix(session) harden archive lifecycle / fix(app) preserve legacy archived sessions | ✅ 不适用 | 上游已自行 revert (`d8c7b4045`、`dcbcbc939`，2026-06-09) |
| `17937dd16` (Windows path 部分) | fix(server): `isStandaloneEntrypoint` 用 `path.win32.basename` | ✅ 不适用 | 本地 `standalone.ts` 无 `isStandaloneEntrypoint` 函数（本地走 Docker 部署，非 bun 单文件 bundle 路径），无对应代码可适用；MCP SDK bump 部分本地早已对齐 1.29.0 |
| `004338cac` `a8a4008d5` | feat: pass through xhigh effort for Opus 4.8 / Opus 4.8 + dynamic workflows support | ✅ 已实现 | 本地 `runClaude.ts:70` 已含 `xhigh`；`1f99f234d feat: add Opus 4.8 model option across app/cli/codium` 已完成；本期 grep 验证 |
| `4930809e7` | fix(cli): bump fastify-type-provider-zod to ^6.1.0 for zod 4 compat | ✅ 已等价 port（升至 `5` 而非 `6.1.0`） | 本期 sdk-watch 选择与 happy-server 一致升至 `5`（已包含 zod 4 兼容修复），避免 monorepo 内 4/6 版本分裂；后续若升 server 到 6.x 再统一 |
| docs: `--safe-mode` flag、`/cd` 命令、`post-session` hook (2.1.169) | (2.1.169) | ✅ 不需新增适配 | `--safe-mode` PTY 透传；`/cd` 已通过 `CwdChanged` hook 接收；`post-session` 仅自托管 runner，本项目非自托管 runner |
| docs: `fallbackModel` setting + `--fallback-model` flag (2.1.166) | (2.1.166) | ✅ 已支持 | `claudeCliFlags.ts:17`、`runClaude.ts:601/739/880/908/945` |
| docs: `disableBundledSkills` setting + `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` env (2.1.169) | (2.1.169) | ✅ 已拦截 | 本期 port — `settingsParser.ts` `BLOCKED_KEYS` 加入 `disableBundledSkills` + 测试 |
| docs: `enforceAvailableModels` managed setting (2.1.175) | (2.1.175) | ✅ 已拦截 | 本期 port — `settingsParser.ts` `BLOCKED_KEYS` 加入 `enforceAvailableModels`（managed-only，App RPC 不应能扩展）+ 测试 |
| docs: `language`/`footerLinksRegexes`/`enforceAvailableModels`/`wheelScrollAccelerationEnabled` setting (2.1.174-176) | (2.1.174-176) | ✅ 不适用 | 仅 TUI 行为/会话标题语言/UI 渲染，不影响 PTY 工作流；`enforceAvailableModels` 在 SaaS 场景非紧迫，列入 P2 监视 |
| docs: Fable 5 默认 1M `[1m]` 后缀剥离 (2.1.173) | (2.1.173) | ✅ 已支持 | `claudeRemote.ts:113-120` 仅对 opus-4-7/4-8 加 `[1m]`，Fable 5 走默认 case 不带后缀 |

---

## 运行时依赖对齐（2026-08-14 更新）

| 包 | 项目当前 | npm 最新 | 状态 |
|---|---|---|---|
| `@anthropic-ai/sandbox-runtime` | `0.0.73` | `0.0.73` | ✅ 2026-08-14 升级（0.0.54→0.0.73，见当期执行记录） |
| `@modelcontextprotocol/sdk` | `^1.30.0` | `1.30.0` | ✅ 2026-08-14 升级；**勿升 2.x**（breaking） |
| `node-pty` | `^1.1.0` | `1.1.0` | ✅ 跟上 |
| `fastify-type-provider-zod`（happy-cli） | `5` | `6.1.0` | ✅ 本期升 `4.0.2 → 5` 修 zod 4 兼容（与 happy-server 对齐）；后续若升 server 到 6.x 再统一 |
| `fastify-type-provider-zod`（happy-server） | `5` | `6.1.0` | ✅ 监视 6.x |
| `@anthropic-ai/claude-code`（用户运行时 TUI 基线） | — | `2.1.232` | ✅ 2026-08-14 对齐至 2.1.232（DirectoryAdded hook + BLOCKED_KEYS 扩充，见当期执行记录）；本机 `claude --version` = 2.1.232 |
| `@anthropic-ai/claude-code`（codium 内嵌） | `2.1.177` | `2.1.177` | ✅ 本期升 `2.1.165 → 2.1.177`；`@anthropic-ai/claude-agent-sdk` 同步至 `^0.3.177`；codium typecheck + 4 测试文件 100 用例全过 |

> 注：本项目走 PTY 模式，**不追踪** `@anthropic-ai/claude-agent-sdk` 与 `claude -p` headless 路径。

---

## 2026-08-14 sdk-watch 执行记录

本机 `claude --version` = **2.1.232**（npm 最新亦为 2.1.232）。本期完成以下升级与 backport（全部带测试验证）：

### 已 port 的上游修复

| Upstream commit | 标题 | 本地落点 | 备注 |
|---|---|---|---|
| #1553 `abdcfff8c` | fix(cli): keep the session alive when the API rejects a turn | `claude/types.ts`（`service_tier: nullish` + `usage .catch(undefined)`）、`claude/types.test.ts`（新建）、`__fixtures__/api-error/rate-limit.jsonl`（新建）、`sessionScanner.test.ts` 回归测试 | 本地确认同病：合成 API 错误消息带 `service_tier: null` 会使 Zod 解析失败丢消息。上游 mapper 归一化部分不适用 —— 本地 usage 消费只取 token 字段，不经 wire 传 `service_tier` |
| #1595 `29ca2e435` | fix: keep the picked model and effort across an abort | `claude/runClaude.ts` + `codex/runCodex.ts` 的 `resetCurrentModeDefaults` 不再重置 model/effort | 本地无 runClaude 测试 harness（上游 harness 数百行），两行删除由 typecheck/构建覆盖 |
| `d1cdc796c` | fix(cli): don't scope machine RPC paths to the daemon's accidental cwd | `registerCommonHandlers.ts`/`registerFilesystemHandlers.ts`/`registerSearchHandlers.ts`/`registerPluginHandlers.ts` 接受 `workingDirectory: string \| null`；`apiMachine.ts` 传 `null` | 本地架构已拆分 handler 模块，采用等价适配而非照抄；workflow/worktree 类 RPC 在 machine 作用域返回明确错误（App 端本就走 session 作用域调用） |
| #1578 `990d385de` | fix(cli): surface the real launch error instead of a bare notice | `claude/utils/launchFailureMessage.ts` + 测试（新建）；接入 `claudeLocalLauncher.ts` 与 `claudeRemoteLauncherCore.ts`（后者原先裸拼 `err.message`，现在有 ANSI 剥离/换行折叠/300 字符截断） | codex 侧已有 `trimIdent` 等价处理，未改 |

### PTY 形态对齐（2.1.202 → 2.1.232）

| 形态变更 | 版本 | 本地落点 | 结论 |
|---|---|---|---|
| `DirectoryAdded` hook（`/add-dir` / `register_repo_root` 后触发，不可阻断） | 2.1.221 | `jsonlMessageTypes.ts` HookEvent union、`generateHookSettings.ts` 订阅、`startHookServer.ts` 接口+分发+测试 | ✅ 本期补录；payload 字段 `new_directory` 经 2.1.232 二进制字符串验证 |
| `sandbox.bwrapPath`/`socatPath`/`ripgrep` 覆盖收紧为 managed-only | 2.1.232 | `settingsParser.ts` `BLOCKED_KEYS` 加入 `sandbox` | ✅ 本期拦截（远程注入二进制路径 = 任意代码执行） |
| `disableSideloadFlags` | 2.1.193 | `BLOCKED_KEYS` | ✅ 本期拦截 |
| marketplace 键（`additionalMarketplaces`/`allowedMarketplaces` 别名 + 旧名 + `blockedMarketplaces` + `disableCommandPluginSources`） | 2.1.223-232 | `BLOCKED_KEYS` | ✅ 本期拦截 |
| `crossSessionInbound`/`dialogExpiry`/`askUserQuestionTimeout`/`autoCompactWindow`/`advisorModel`/`axScreenReader` | 2.1.181-225 | 白名单本就拒绝未知键 | 🔍 P2 — 如需在 App 暴露再加入 ALLOWED_KEYS |
| hook `terminalSequence` 允许列表 OSC 0/1/2/9/**99/777**+BEL | — | `pty/terminalSequences.ts` 已结构化 0/1/2/9，99/777 落入 `other` | 🔍 P2 — 可选扩展 kitty/urxvt 通知解码 |
| `@` mention 跨会话（SendMessage 路由） | 2.1.232 | JSONL 中的实际形态待观察 | 🔍 监视 |
| fullscreen streaming 不再逐更新重新规范化 | 2.1.232 | PTY 透传层 | ✅ 本期全量测试在 2.1.232 上跑通 |

### 运行时依赖升级

| 包 | 变更 | 验证 |
|---|---|---|
| `@anthropic-ai/sandbox-runtime` | `0.0.54 → 0.0.73`（含 0.0.55 TLS 代理修复、0.0.66 Linux bwrap 加固、0.0.72 macOS denyRead 修复；0.0.62 要求 Node ≥ 20.11、0.0.64/0.0.67 Windows breaking 不影响本项目用面） | typecheck + sandbox 测试通过；本地仅用 `SandboxManager.initialize/reset/wrapWithSandbox` 稳定 API |
| `@modelcontextprotocol/sdk` | `^1.29.0 → ^1.30.0`（维护版：stdio 缓冲上限、SSE keep-alive；**勿升 2.x**，同日发布的 2.0.0 有 breaking） | typecheck + 测试通过 |

### 本期跳过 / 排期项

- **#1556/#1564/#1561 套餐限额状态栏**（cli+app 整块功能，含 9 语言 i18n）— 排期为独立功能移植，涉及本地缺失的 `usageLimits.ts`/`SessionStatusBar` 整条链
- **`1862c2c88` 推送抑制"活跃证明"**（server+cli+app）— 本地 `focusTracker.ts` 注释已预告此扩展方向，实现已分叉需独立适配
- **Rig / agy / gemini 3.6** — 上游专属后端生态，继续跳过
- **Side-chat 面板套件** — 继续监视，等上游稳定
- App bug-fix 篮子（#1476 列表跳动、unread 徽章、thinking 保留等）— 待逐个复现后 cherry-pick

---

## claude-code 2.1.177 → 2.1.201 PTY 形态复核（2026-07-06）

本机 `claude --version` = **2.1.201**（npm 最新亦为 2.1.201）。逐条比对官方 changelog 的形态变化与本地适配点：

| 形态变更 | 版本 | 类别 | 本地适配点 | 结论 |
|---|---|---|---|---|
| Claude Sonnet 5（新默认，原生 1M） | 2.1.197 | 模型 | `claudeRemote.ts:142-144` `sonnet-5`/`sonnet-5-1m`→`claude-sonnet-5[1m]`；`modelModeOptions.ts:211` | ✅ 已支持 |
| Fable 5 加入模型选择器 | 上游 #1470 | 模型 | `claudeRemote.ts:157`、`modelModeOptions.ts:231` | ✅ 已支持 |
| permission mode `default`→`manual` 重命名（仍接受 `default`） | 2.1.200 | settings/CLI | `permissionMode.ts:31,137` 仅识别 `"default"` | 🔍 P2 监视 — 向后兼容，`default` 仍可用；若 App/新 claude 改发 `manual` 才需加别名 |
| hook matcher 连字符精确匹配 / 逗号分隔修复 | 2.1.195/191 | hooks | `generateHookSettings.ts:92` 仅用 `matcher:"*"` | ✅ 不适用（未用连字符/逗号匹配） |
| `Notification` hook 新增 `agent_needs_input`/`agent_completed` payload | 2.1.198 | hooks | `jsonlMessageTypes.ts:81,369` 已有 `Notification` 类型 | 🔍 P2 监视（仅 `claude agents` 后台代理触发） |
| `respondToBashCommands:false` — `!` 命令默认触发 Claude 回应输出 | 2.1.186 | settings | `! <cmd>` 透传路径 | 🔍 P2 监视 — 可能改变本地 `!` 后台 shell 体验 |
| 中断保留部分响应（不再报错） | 2.1.179 | JSONL | `jsonl/` 扫描器 | 🔍 P2 抽查扫描器对部分 assistant 消息的健壮性 |
| `SessionStart`/`Setup`/`SubagentStart` 退出码 2 时 stderr 显示到 transcript | 2.1.199 | hooks | 本地 hook 脚本退出码 | 🔍 P2 确认 hook 脚本不以码 2 退出产生噪音 |
| 新 settings 字段：`sandbox.credentials`、`sandbox.allowAppleEvents`、`autoMode.classifyAllShell`、`attribution.sessionUrl`、`Tool(param:value)` 权限语法 | 2.1.178-193 | settings | 透传，无消费 | 🔍 监视，无需适配 |

**结论**：2.1.177→201 形态变化中，模型矩阵（Sonnet 5 / Fable 5）本地已支持；hook matcher 变更因本地只用 `"*"` 免疫；其余均为 P2 监视项，无 P0/P1 适配缺口。

---

## 本期上游 codium 包变更（2026-06-13）

启用 `--find-renames=50` 后真实差异 `146 files changed, 12 insertions, 96 deletions`，全部为：
- 路径回退 `packages/happy-codium → packages/codium`（本地保留 `@kmmao/happy-codium` 命名）
- 包名 `@kmmao/happy-codium → codium`（不采纳）
- 删除 `rebuild`/`postinstall` 脚本（本地需保留 better-sqlite3/node-pty 重建）
- **降级** `@anthropic-ai/claude-code` `2.1.165 → 2.1.143`（不采纳，本地领先）
- **降级** `@anthropic-ai/claude-agent-sdk` `^0.3.166 → ^0.3.143`（不采纳，本地领先）
- 删除本地 `packages/happy-codium/CLAUDE.md` 82 行约定文档（不采纳）

**结论**：本期 codium 上游变更全部不合入。上游处于退路模式，本地全面领先。

> **2026-07-06 复核**：本地 `packages/happy-codium`（146 文件）vs 上游 `packages/codium`（145 文件），差异仅本地多一个 `CLAUDE.md`；本地 deps 仍领先（`@anthropic-ai/claude-code` 本地 `2.1.177` > 上游 `2.1.143`，`claude-agent-sdk` 本地 `^0.3.177` > 上游 `^0.3.143`）。结论不变：全部不合入。

---

## 待评估

### 高优先级 — Bug 修复 & 安全

| PR # | 标题 | 改动 | 评估 |
|------|------|------|------|
| #678 | fix(security): prevent XSS in Mermaid WebView | +27/-12 | 安全修复，上游官方提交，建议合 |
| #697 | fix: sanitize Mermaid content to prevent XSS in WebView | +114/-4 | 社区版 Mermaid XSS 修复，和 #678 重叠，选一个 |
| #701 | fix(sync): prevent App↔CLI sync permanent wedge | +673/-144 | 同步卡死核心修复 (seibe)，改动大需仔细看 |
| #702 | fix(cli): YOLO mode message handling and sync wedge | +90/-43 | 配合 #701，YOLO 模式修复 |
| #728 | fix: prevent --yolo permission mode from being overridden | +11/-4 | 小改动，YOLO 模式被 App 覆盖 |
| #730 | fix: handle blank lines and empty cells in markdown table | +131/-22 | 表格解析崩溃修复 |
| #736 | fix: sanitize CLAUDECODE env var in daemon-spawned sessions | +24/-7 | daemon 环境变量污染 |
| #739 | fix: create new MCP transport per request for stateless mode | +6/-7 | MCP transport 复用 bug |
| #698 | fix: quote CLI path in tmux to handle spaces | +61/-1 | 路径有空格时 tmux 崩溃 |
| #775 | fix: add type safety for todos array | +7/-6 | 小修，类型安全 |

### 中优先级 — 功能增强

| PR # | 标题 | 改动 | 评估 |
|------|------|------|------|
| #700 | feat: compact context button when context nearly full | +102/-0 | 体验提升，纯新增 |
| #703 | feat: Resume Session to continue previous conversations | +209/-20 | 实用功能 (seibe)，我们已有类似实现 `057102f6` 需对比 |
| #709 | feat: workspace file browser in session files screen | +576/-175 | 文件浏览功能，改动大 |
| #737 | feat: session rename with swipe-left action | +782/-41 | 左滑重命名 session，改动大 |
| #695 | feat: sort sessions by activity, show timestamps | +95/-9 | 我们可能已有类似实现，需对比 |
| #696 | feat: show rate limit / quota feedback | +162/-7 | 用量限制提示 |
| #763 | Session display: machine ID and new session labels | +146/-22 | 显示机器标识和新 session 标签 |
| #693 | feat: show daemon vs terminal session origin | +191/-1 | 区分 session 来源 |
| #769 | fix: lock @modelcontextprotocol/sdk to ~1.25.3 | +1/-1 | ❌ **已过期** — 我们已在 `^1.29.0` 且为 npm 最新；上游锁定到 1.25.3 不适用 |

### 中优先级 — 近期上游 feat / 体验（2026-06-06 sdk-watch 新发现）

| Commit | 标题 | 评估 |
|---|---|---|
| `266c0072a` + `03ca2219e` + `6f6696911` | feat(app): collapse consecutive tool calls into grouped containers + settings toggle + 默认 off | 中等 — 减少滚动疲劳；可独立 port，与本地 App 结构兼容 |
| `812f4e1bc` | Add codex permission-mode plumbing and full-yolo approval policy | 中等 — 显式 `--permission-mode`/`--yolo`；codex 路径，本地 Codex 子命令也存在 |
| `b042d834a` | Add configurable agent defaults | 中等 — 新增 `settings/agents.tsx` 设默认 agent；本地暂无 |
| `17aa703fa` | feat(app): surface build metadata in settings | 低 — 设置页显示构建信息 |
| `ab4696a34` | feat(app): taller chat + new-session input on web/desktop | 低 — Web/Desktop 输入框增高 |
| `0bfb7041f` | chore(skills): add /sessions skill (vendored from EveryInc compound) | 低 — 可选 |
| `cb2fc38b4` | fix(app): force grayscale font smoothing under Safari zoom | 低 — Safari 缩放下文字渲染 |
| `3caa51b4b` | fix(app): RN Blob polyfill ArrayBuffer in S3 POST attachments | 低 — Web 上传场景 |
| `31a6e4df1` | fix(server): sync pino streams so bun-compiled bundle starts | 监视 — 本地刚加 `webDiagnosticsLogger`，同区代码；只在 bun 单文件场景出问题，目前我们用 Docker 不受影响 |

### 低优先级 — 大功能 / 需要额外工作

| PR # | 标题 | 改动 | 评估 |
|------|------|------|------|
| #542 | feat: Telegram Mini App integration | +973/-0 | 前端 only，server 端缺失，E2EE 架构冲突 |
| #460/#479 | feat: OpenCode agent support | +1589/-4 | 新 agent 后端，优先级低 |
| #665 | feat: Kimi CLI support via ACP | +2248/-6 | Kimi agent，国内可能有价值 |
| #731 | feat: Kimi agent support (app) | +214/-46 | Kimi app 端，配合 #665 |
| #655 | feat: codex-pty PTY bridge tool | +2312/-8 | 改动巨大 |
| #596 | feat: local Whisper speech-to-text | +4315/-55 | 改动巨大，我们已有 TTS 方案 |
| #681 | fix(security): E2E encrypt vendor API tokens | +666/-59 | 安全重要但改动大，需仔细评估 |

### 已跳过 / 不适用

| PR # / Commit | 标题 | 原因 |
|------|------|------|
| #715 | fix: correct Project Components URLs in README | 文档，不影响代码 |
| #729 | docs: add CONTRIBUTING.md | 文档，我们有自己的 |
| #514 | docker compose, gh actions, and instructions | 我们有自己的 docker-compose |
| #580 | Refactor Docker setup and document Full Auto Mode | 我们有自己的 Docker 配置 |
| `2327f49c2` | feat(message-view): parse Claude SDK local-command wrappers into chips | 仅 SDK 模式消费，本项目走 PTY 不适用 |
| `4a64c66a4` | chore(app): add macOS signing entitlements | 本项目签名/打包独立 |
| `450f29e98` | Grant extra voice minutes to a specific account | 业务硬编码（针对特定账户） |
| `5981a899b` + `d2d2f7301` + `00725d20d` | feat: happy server self-host (CLI 子命令 + bundled artifacts + 拆包) | 监视 — 大重构；本项目已有 docker-compose 自托管路径，是否要引入"happy serve"一键起 server 单独评估 |
| #769 | fix: lock @modelcontextprotocol/sdk to ~1.25.3 | 我们已在 `^1.29.0`（npm 最新），无需降级锁定 |

---

## 流程说明

### 合并上游 PR 的步骤

1. 在本文档「待评估」中找到目标 PR
2. 用 `gh pr diff <number> --repo slopus/happy` 查看改动
3. 评估与本地代码的兼容性
4. Cherry-pick 或手动 port（推荐手动 port 以控制冲突）
5. 提交时在 commit message 中注明 PR 编号，如：`fix: merge upstream PR #697`
6. 将 PR 从「待评估」移到「已合并」，填写 commit hash 和日期

### 定期检查

建议每 1-2 周用 `gh pr list --repo slopus/happy --state open` 检查上游新 PR，更新本文档。
也可使用 `/check-upstream` skill 自动分析。
