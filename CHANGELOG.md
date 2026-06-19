# Changelog

This monorepo contains multiple packages, each with its own changelog:

| Package | Changelog |
|---------|-----------|
| **happy-cli** (`@kmmao/happy-coder`) | [packages/happy-cli/CHANGELOG.md](packages/happy-cli/CHANGELOG.md) |
| **happy-app** | [packages/happy-app/CHANGELOG.md](packages/happy-app/CHANGELOG.md) |
| **happy-agent** (`@kmmao/happy-agent`) | [packages/happy-agent/CHANGELOG.md](packages/happy-agent/CHANGELOG.md) |
| **happy-wire** (`@kmmao/happy-wire`) | [packages/happy-wire/CHANGELOG.md](packages/happy-wire/CHANGELOG.md) |
| **happy-server** | No changelog (private package) |

## Recent Highlights

### 2026-06-19

- **happy-cli 0.101.3** — Stop the strand watchdog from killing in-flight `/compact` (and other slash commands) at 90s. `/compact` runs entirely inside the TUI: no JSONL records until the final `compact_boundary`, no PTY spinner bytes during the internal API call. The existing wedge detector read that legitimate silence as a stranded turn and aborted the compaction at ~90s (observed: pid-99141 `/compact` at 13:02:26 → "No response for 99s — attempting recovery…" at 13:04:05 → cold-restart loop). New `WATCHDOG_SLASH_COMMAND_RECOVER_MS = 10min` exemption gates the fast wedge paths once WRITE_VERIFY has confirmed the paste landed (`promptSubmissionConfirmed`), so a real submission wedge is still caught in 2.5s but legitimate compaction time on a maxed 200K context is no longer cut short.

- **happy-cli 0.101.2** — Fix duplicate "Context compacted" bubbles after one `/compact`. The `compact_boundary` JSONL record was being re-emitted as a session event on every `--resume` cold-swap (sessionScanner replays the historical record as new), so the App saw N copies of "Context compacted" — one real + one per intervening cold restart (observed: 4 bubbles after 1 `/compact` + 3 restarts). New `compactBoundaryDedup.tryRegisterCompactBoundaryEmission` gates emission on `compact_boundary.uuid`; the downstream summary poll is short-circuited on replay too. Pure-function helper with a 5-case vitest pinning the contract.

- **happy-cli 0.101.1** — Two-bug fix for the `/compact → 96s wait → recovery → silence` failure mode. `claudeRemote.handleResult` now dispatches `promptIsCompact` for strand-redelivered `/compact`, and `maybeRedeliverStrandedPrompt` forces a tier-2 cold restart for any slash-command in-flight prompt (tier-1 Esc + paste was producing `/compact/compact` when the TUI composer wasn't fully cleared, which the TUI silently treats as prose). After `compact_boundary`, the new JSONL summary record is polled and emitted as a "Compaction summary:\n…" session event so users see the actual compacted text.

- **happy-wire 0.33.0 + happy-cli 0.101.0 + happy-agent 0.8.0 + happy-app 2.43.0** — Removed the `autoCompact` protocol entirely. The modelMode key (`-1m` suffix on App-level keys, e.g. `opus-4-7-1m`) is now the single source of truth for both the 200K/1M window-tier choice and the 75%-threshold hint. Pre-fix the AUTO/200K/1M chip could disagree with the model picker — picking `opus-4-7-1m` while autoCompact stayed on AUTO silently downgraded back to 200K with no UI signal. Wire 0.33.0 is breaking (dropped `isAutoCompactEnabled` and `autoCompactThreshold` from `sessionContextUsageEventSchema`).

### 2026-06-05

- **happy-app 2.36.2** — Chat header tightening: the live working directory introduced in 2.36.0 as a faint third row is folded into the existing Process ID subtitle as `Process ID N · <cwd>`, saving one row of vertical space on every session screen. The cwd label is now always rendered (falls back to the launch directory's basename when Claude has not moved), so you always see "where am I" at a glance. Backed by a new `formatSessionCwdLabel` helper with 18 unit tests covering POSIX / Windows / sibling / missing-path cases.

### 2026-06-02

- **happy-cli 0.89.0** — Codex permission-mode pipeline: new `--permission-mode <mode>` and `--yolo` CLI flags plumb an explicit permission mode through `runCodex`, mapping `yolo`/`bypassPermissions` to the `never` approval policy so full-yolo sessions skip all permission prompts. Also fixes initial socket reconnect (smart reconnect now kicks immediately after socket setup, preventing silent connection failures on cold start). App-side: new `new-machine` live-update handler initializes per-machine encryption from the carried data key, so freshly onboarded machines appear instantly without an app restart.

- **happy-cli 0.88.1** — Three more Claude Code 2.1.x hooks (`InstructionsLoaded`, `PermissionDenied`, `PostToolBatch`, verified against 2.1.157's `HookEvent` type) wired through the hook server with hand-mirrored payload types (no agent-sdk dependency). `PermissionDenied` is surfaced end-to-end: a capped, head-deduped `recentPermissionDenials` ring buffer in `session.metadata`, rendered as a "Recent Permission Denials" list on the App's Session Info screen (App UI shipped in code, pending an App release).

### 2026-05-31

- **happy-cli 0.87.0 + happy-app 2.36.0** — Claude Code 2.1.x hook surface integration. CLI now subscribes to `CwdChanged`, `FileChanged`, `WorktreeCreate`, and `WorktreeRemove` (Claude Code 2.1.121+/2.1.157+) and surfaces them through `session.metadata` — no new wire envelope. App shows Claude's live working directory as a third chat-header line, and adds Worktree Activity + Recent File Changes sections to Session Info. Hook injection also switched to Claude Code 2.1.139+ exec form (no more shell parsing in the hook command), and happy's MCP servers now ride with `alwaysLoad: true` so they survive Claude's tool-search deferral across `/clear` and plan-mode swaps.

### 2026-05-26

- **happy-cli 0.86.0** — PTY-mode reliability & performance: subagent (Task/Agent) results now appear in milliseconds via a per-session `subagents/` watcher, long sessions parse only newly appended log bytes, ExitPlanMode auto-approval detects the picker from the current screen snapshot, the context-usage panel splits into Cached context / Cache write / New input, and an optional deep MCP `initialize` handshake probe (`HAPPY_MCP_HANDSHAKE_PROBE=1`) verifies stdio servers really speak MCP.

### 2026-05-13

- **happy-cli 0.78.0** — Upgraded Claude Agent SDK to 0.2.139, added "Move to background" button for converting foreground tasks to background via `Query.backgroundTasks()`.

### 2026-04-24

- **happy-app 2.14.1** — Restored XHigh effort option for Opus 4.7, fixed long-session message loading on PC Web, reduced 404 cache window to 3s.
- **happy-app** — Added project Config tab consolidating monitoring and webhook settings.
- **happy-cli 0.71.56** — Latest CLI with GPT-5.5 model support, unified question prompts across Claude Code and Codex.

### 2026-04-23

- **happy-app, happy-server** — Added LLM semantic scoring layer for auto-option-send with configurable scoring models, score badges, and feedback loop.
- **happy-cli** — Unified Codex options prompt with Claude Code; fixed OpenAI scoring fallback.

### 2026-04-21

- **happy-app 2.14.0** — Redesigned session progress panel (glass UI, activity chart), unified side-panel with code-changes view, per-turn knowledge lifespan with hot/evicted badges, unarchive-without-restart, rebuilt AI profile settings, and visual consistency polish across all surfaces.
- **happy-wire 0.13.0** — New wire schemas for code change attribution, progress refresh tracking, and session provider tags.

### 2026-04-18

- **happy-cli 0.71.39** — Per-list file change attribution for Edit/Write tool calls in progress panel.
- **happy-cli 0.71.38** — Fixed auto-mirror TodoWrite list boundary detection using SDK-native `oldTodos`/`newTodos`.

### 2026-04-17

- **happy-app 2.13.0** — Opus 4.7 model support, XHigh effort tier, memory recall events, and API request status pings.

### 2026-04-14

- **happy-app, happy-server** — WorldMember team collaboration: maxConcurrency enforcement, Decision wait mechanism, human-centric task scheduling, audit logging, and conflict arbitration.

### 2026-04-10

- **happy-app** — Codex alignment: centralized codex metadata schemas, codex contract baselines, session fixtures, and CI enforcement workflow.
- **happy-server** — Centralized AI profiles in wire, unified supervisor triggers (scheduler + webhook).

### 2026-04-04

- **happy-app, happy-server** — Phase 1-3 complete: Task Queue, Skills (with Knowledge→Skill one-tap extraction), Triggers (Cron + Webhook).

### 2026-03-30

- **happy-app, happy-server** — Knowledge base system: Mem0-style dedup, pgvector semantic search, lifecycle scheduler (decay/merge), per-project config.
- **happy-app 2.7.0** — Favorite command reordering, environment variable i18n, background process manager with Docker support.
- **happy-agent 0.5.5** — Remote CLI agent with machine management, Web auth, v3 message API, and RPC framework.

### 2026-03-22

- **happy-app 2.6.0** — Plugin management, file revert, sub-agent progress, fix session auto-recovery, foldable keyboard fix, and extensive code quality improvements.

### 2026-03-21

- **happy-cli 0.44.4** — Fixed session restore causing messages to become unresponsive.

### 2026-03-19

- **happy-cli 0.44.0** — Added Supervisor Loop Mode (autopilot analyze→fix→re-analyze cycles).
