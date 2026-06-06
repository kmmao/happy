# Happy Docs

Two layers:

- **Agent-facing canonical source**: `CONTEXT.md` (glossary) + `docs/adr/` (21 ADRs)
- **Human-facing detail**: this folder + sub-folders below

## Architecture & Protocol
- backend-architecture.md: Server structure, data flow, key subsystems.
- cli-architecture.md: CLI + daemon architecture and how they sync with the server.
- protocol.md: Wire protocol (WebSocket), payload formats, sequencing, concurrency.
- session-protocol.md: Unified encrypted chat event protocol.
- session-protocol-claude.md: Claude-specific session-protocol flow (local vs remote launchers, dedupe/restarts).
- encryption.md: Encryption boundaries and on-wire encoding.
- api.md: HTTP endpoints and authentication flows.
- happy-wire.md: Shared wire schemas package and migration notes.
- diff-and-review.md: App-side diff renderer + code review system.
- architecture-project-supervisor.md: Project + Supervisor agent architecture.
- STRUCTURAL_OVERVIEW_ZH.md: 项目结构总览（中文）.

## Operations & Deployment
- self-hosting-guide.md: Self-host the backend on a VPS (15 min).
- deployment.md: Backend deployment and required infrastructure.
- local-development.md: Local dev setup for Server / CLI / App, incl. Docker Compose.
- release-guide.md: Release workflow per package after upstream merges.
- monorepo.md: Yarn Workspaces, dependency management, cross-package conventions.
- automation-operations-guide.md: Daemon automation, loops, guardian continuity, recovered-session troubleshooting.
- supervisor-operations-guide.md: Project Supervisor operations for autonomous health checks.
- mcp-plugins.md: MCP servers and Claude Code plugins.
- mcp-progress.md: Live Progress/Summary data link (MCP + CLI auto-mirror + App fallback).
- permission-resolution.md: State-based permission mode resolution across App + CLI (incl. sandbox behavior).

## Reference
- adding-ai-models.md: Adding/updating AI model definitions and pricing.
- sdk-features.md: SDK feature matrix across agent backends.
- sdk-vs-spawn.md: Why CLI migrated from SDK headless to PTY spawn (see ADR-0008).
- sdk-upgrade-checklist.md: Claude Agent SDK 升级集成入口与最小回归矩阵.
- android-push-notifications.md: Android push notification setup.
- elevenlabs-voice-setup.md: ElevenLabs voice integration.
- claude-mem.md: Cross-session memory plugin (thedotmack/claude-mem).
- UPSTREAM_TRACKING.md: Upstream PR tracking (slopus/happy fork).

## Decisions (ADR)
21 ADRs under `docs/adr/`. Start with **ADR-0001** (E2E zero-knowledge — root security model) and **ADR-0014** (custom session protocol). See `docs/agents/domain.md` for how agents should consume ADRs.

## Active Plans (in flight)
- plans/cli-v3-messages-api.md: CLI migration to v3 HTTP messages (not shipped).
- plans/reliable-http-messages-api.md: Server side of v3 HTTP messages (not shipped).
- plans/codex-divergence-register.md: Living register of Happy ↔ openai/codex divergences.
- plans/knowledge-injection-optimizations.md: Backlog (draft).

## Archive
- archive/plans/ — 14 shipped or superseded plans.
- archive/audits/ — point-in-time security audits (2026-04 is the first).
- archive/world/ — earlier "World Model" narrative docs.

## Agent skills
- agents/domain.md: How agents consume CONTEXT.md + ADRs.
- agents/issue-tracker.md: GitHub Issues workflow on kmmao/happy.
- agents/triage-labels.md: Issue triage vocabulary.

## Conventions
- Paths and field names reflect the current implementation in `packages/happy-server`.
- Examples are illustrative; the canonical source is the code.
- "Why we did X" lives in `docs/adr/`; this folder describes "what" + "how".

## Last reviewed
- 2026-06-07
