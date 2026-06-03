---
status: accepted
---

# Claude runtime is interactive PTY only — no SDK, no `claude -p`

**Rule.** happy 的 Claude 运行时只走 `claude` 二进制的**交互式 PTY 模式**。不引入 `@anthropic-ai/claude-agent-sdk` 作为运行时依赖，不调用 `claude -p` / `--print` headless 模式。`import type` 形式的 SDK 类型借用允许保留——它不构成 runtime 加载，也不进入计费路径。

**Trigger.** 交互式 PTY 是已知唯一稳定走 OAuth 订阅计费的路径；SDK 与 headless 模式的计费归属预期向 API 用量靠拢。我们选择**提前脱钩**而非追事后兼容——避免未来出现"功能已上线但计费方式被动切换"的回滚成本。

**Re-evaluate when.** Anthropic 明确把 SDK 或 headless 模式纳入订阅计费、或 happy 的目标计费模型从订阅切换为按用量。届时回到本 ADR 重新决定，而不是在新代码里悄悄加 `-p` / SDK 依赖。

## Affected call sites

- ✅ **`packages/happy-cli/src/claude/pty/*`** — 主 Claude 会话路径。早于本 ADR 已通过 PTY migration 完成迁移，源码注释里明确写着 "Pre-migration this module called `@anthropic-ai/claude-agent-sdk`'s …, after the PTY migration we spawn `claude` ourselves"。`rawToJsonlMessage.ts`、`jsonl/types.ts` 等模块对 SDK 的引用均为 `import type`，符合本 ADR。
- 🔧 **`packages/happy-cli/src/supervisor/preflightSync.ts:253-297`** —— `attemptConflictResolution` 通过 `execFile("claude", ["-p", resolvePrompt, "--max-turns", "20"])` 在 rebase 冲突时自动解决。**删除该函数**。冲突路径改为：
  1. `git rebase --abort`（已有）
  2. 在 `PreflightResult.error` 里附带冲突文件列表
  3. `handleSupervisorTrigger.ts:384` 已有的 `SupervisorRunStatus { status: "failed", errorMessage }` 上报机制把冲突暴露到 App
  
  常规交互 Session（PTY 合规）继续承担人工解决冲突的能力，用户无需新通道。
- ⏳ **`packages/happy-codium/sources/boot/main/agent-worker/worker.ts`** —— Electron worker 直接 `import { query } from '@anthropic-ai/claude-agent-sdk'`，是 codium 跑 Claude 会话的核心（约 500 行 consume 循环 + streaming input + interrupt + tool index 映射）。**暂缓决策**。已知备选：PTY 复刻（复用 happy-cli `claude/pty/*`，需破例 codium "不依赖任何 `@kmmao/*` 内部包"约束）/ 收敛到 happy-cli daemon（codium 退化为渲染层，需重新定位身份）/ 砍掉 Claude 只留 Codex。跟进项见 `backlog.md`。

## Considered alternatives

- **PTY 模拟 headless** —— 在 PTY 模式下注入 prompt 并解析 TUI 输出找完成信号。本质是从 PTY 侧重新发明 `claude -p`，靠 ANSI 解析做 bounded execution，比 `-p` 更脆弱、每次 claude TUI 升级都可能坏。拒绝。
- **改用 codex headless / 其他 CLI** —— 若"非交互调用排除订阅"的逻辑成立，OpenAI 大概率会跟进。等于把同一颗政策风险雷换地方埋。拒绝。
- **git 侧策略退化（`-X ours` / `-X theirs`）** —— 不是智能合并，会静默丢一边的改动。拒绝。
- **保留 `claude -p` 接受 API 计费** —— 违反规则本身。作为 ADR 特例口子的可维护性代价高于这条自动化路径的边际价值。拒绝。
- **重写 Anthropic Messages API + 自实现 agent loop** —— 等于自己重写 Claude Code 内功（tool loop、权限、persistence、subagent、skills…）。在 preflightSync 这条救援路径上代价过高。拒绝。

## Consequences

- supervisor preflight 在 rebase 冲突时**不再尝试自动解决**——SupervisorRun 直接标 failed，用户在常规 Session 里人工处理。该路径触发率本低（仅 preflight 期间的真实冲突），用户体感损失可接受。
- 引入新的 Claude 自动化时若考虑 `claude -p` 或 SDK，先回到本 ADR 评估订阅策略；不要在 ADR 之外开特例口子。
- codium 现有 SDK worker 在本 ADR 范围内**仍可运行**——它跟 happy-cli 物理隔离（nohoist、不互相依赖），删除 preflightSync 的 `-p` 用法不影响 codium。codium 的 SDK 脱钩是独立改造，等单独的 ADR/讨论。
