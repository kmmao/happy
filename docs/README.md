# Happy Docs

This folder documents how Happy works internally, with a focus on protocol, backend architecture, deployment, and the CLI tool. Start here.

## Index
- protocol.md: Wire protocol (WebSocket), payload formats, sequencing, and concurrency rules.
- api.md: HTTP endpoints and authentication flows.
- encryption.md: Encryption boundaries and on-wire encoding.
- backend-architecture.md: Internal backend structure, data flow, and key subsystems.
- deployment.md: How to deploy the backend and required infrastructure.
- cli-architecture.md: CLI and daemon architecture and how they interact with the server.
- session-protocol.md: Unified encrypted chat event protocol.
- session-protocol-claude.md: Claude-specific session-protocol flow (local vs remote launchers, dedupe/restarts).
- permission-resolution.md: State-based permission mode resolution across app and CLI (including sandbox behavior).
- monorepo.md: Monorepo architecture, Yarn Workspaces configuration, dependency management, and cross-package conventions.
- local-development.md: Local development setup and debugging for Server / CLI / App, including Docker Compose workflow.
- adding-ai-models.md: Guide for adding or updating AI model definitions and pricing across the codebase.
- happy-wire.md: Shared wire schemas/types package and migration notes.
- sdk-features.md: SDK feature capability matrix across agent backends and the Happy system.
- sdk-upgrade-checklist.md: Claude Agent SDK 升级集成入口，包含集成面、重点核对项与最小回归矩阵。
- mcp-plugins.md: MCP servers and Claude Code plugins used in the development environment.
- mcp-progress.md: Live Progress/Summary 数据链路 — MCP 主路 + TodoWrite 降级 + App 渲染，含端到端流程图与 FAQ。
- release-guide.md: Release workflow, ordering dependencies, and commands for each package after upstream merges.
- claude-mem.md: Cross-session memory system plugin for Claude Code.
- UPSTREAM_TRACKING.md: Upstream PR tracking for the slopus/happy fork.
- architecture-project-supervisor.md: Architecture design for Project as first-class citizen with Supervisor Agent.
- supervisor-operations-guide.md: Project Supervisor operations guide for autonomous code health analysis and fixes.
- automation-operations-guide.md: Automation / Agent Loop operations guide covering daemon automation, loop management, guardian continuity, and recovered-session troubleshooting.
- plans/world-project-naming-guideline.md: Naming boundary between Project (technical container) and World (governance semantics).
- plans/world-model-activation-plan.md: 世界模型活化方案与阶段跟进（Goal/板子 + Task/管道 + Skill 沉淀，不接 Multica）。
- plans/codex-config-first-app-server-plan.md: Codex 配置优先与 app-server 主路径改造计划，包含兼容 legacy MCP 的分阶段实施清单。

## Conventions
- Paths and field names reflect the current implementation in `packages/happy-server`.
- Examples are illustrative; the canonical source is the code.

## Last reviewed
- 2026-04-12
