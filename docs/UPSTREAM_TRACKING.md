# Upstream PR Tracking

上游仓库: [slopus/happy](https://github.com/slopus/happy)

本文档记录从上游仓库 cherry-pick / port 的 PR 状态，避免重复评估和遗漏。

---

## 上游分叉现状（2026-06-06 sdk-watch 复核）

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

---

## 运行时依赖对齐（2026-06-06）

| 包 | 项目当前 | npm 最新 | 状态 |
|---|---|---|---|
| `@anthropic-ai/sandbox-runtime` | `0.0.54` | `0.0.54` | ✅ 跟上（2026-06-04 刚发布） |
| `@modelcontextprotocol/sdk` | `^1.29.0` | `1.29.0` | ✅ 跟上 |
| `node-pty` | `^1.1.0` | `1.1.0` | ✅ 跟上 |
| `@anthropic-ai/claude-code`（用户运行时 TUI 基线） | `2.1.165` | `2.1.165` | ✅ 跟上 |
| `@anthropic-ai/claude-code`（codium 内嵌） | `2.1.165` | `2.1.165` | ✅ 本次同步升至 2.1.165；`@anthropic-ai/claude-agent-sdk` 同步至 `^0.3.166`（codium 走 SDK 模式，与本仓库 PTY 策略无冲突） |

> 注：本项目走 PTY 模式，**不追踪** `@anthropic-ai/claude-agent-sdk` 与 `claude -p` headless 路径。

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
