# Upstream PR Tracking

上游仓库: [slopus/happy](https://github.com/slopus/happy)

本文档记录从上游仓库 cherry-pick / port 的 PR 状态，避免重复评估和遗漏。

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
| #769 | fix: lock @modelcontextprotocol/sdk to ~1.25.3 | +1/-1 | 版本锁定，看我们当前版本再决定 |

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

| PR # | 标题 | 原因 |
|------|------|------|
| #715 | fix: correct Project Components URLs in README | 文档，不影响代码 |
| #729 | docs: add CONTRIBUTING.md | 文档，我们有自己的 |
| #514 | docker compose, gh actions, and instructions | 我们有自己的 docker-compose |
| #580 | Refactor Docker setup and document Full Auto Mode | 我们有自己的 Docker 配置 |

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
