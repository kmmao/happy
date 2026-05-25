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
