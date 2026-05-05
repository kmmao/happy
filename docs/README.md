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
- mcp-progress.md: Live Progress/Summary 数据链路 — MCP 显式 + CLI TodoWrite auto-mirror + App 扫描兜底，含端到端流程图、生效矩阵与 FAQ。
- release-guide.md: Release workflow, ordering dependencies, and commands for each package after upstream merges.
- claude-mem.md: Cross-session memory system plugin for Claude Code.
- UPSTREAM_TRACKING.md: Upstream PR tracking for the slopus/happy fork.
- architecture-project-supervisor.md: Architecture design for Project as first-class citizen with Supervisor Agent.
- supervisor-operations-guide.md: Project Supervisor operations guide for autonomous code health analysis and fixes.
- automation-operations-guide.md: Automation / Agent Loop operations guide covering daemon automation, loop management, guardian continuity, and recovered-session troubleshooting.
- world/global-world-model-ui-restructure.md: World Model 主锚点（Matrix 世界观）。一切皆事件，世界持续运行，Programs 各司其职，Neo（用户）只处理 Anomaly。定义 World Shell UI、事件流、Intent 分解与多层自治。
- world/world-model-roadmap.md: 旧项目级 World 历史路线图参考，记录早期 Project 叙事/法则、AgentRole、Decision、Goal 实施阶段。
- world/world-model-capability-map.md: 旧项目级 World 历史能力盘点参考，保留 Task/Supervisor/Agent Loop/Trigger/Knowledge/Inbox 能力清单。
- world/world-model-multica-analysis.md: Multica 竞品参考资料，保留 Agent 一等公民、任务生命周期、运行时隔离与两阶段 prompt 等模式素材。
- world/world-model-guide.md: 旧项目级 World 功能参考，覆盖早期角色、目标、任务、裁决、成员协作与 App 世界 Tab 设想。
- world/world-project-naming-guideline.md: 命名边界规范。Project 是事件的 source 属性（技术承载层），World 是全局心智层，Bridge/Universe 是跨世界层。
- world/world-model-activation-plan.md: 旧项目级 World 历史活化跟进记录，记录 Goal/Task/Skill/角色/世界 Tab 串联迭代。
- plans/codex-config-first-app-server-plan.md: Codex 配置优先与 app-server 主路径改造计划，包含兼容 legacy MCP 的分阶段实施清单。

## Conventions
- Paths and field names reflect the current implementation in `packages/happy-server`.
- Examples are illustrative; the canonical source is the code.

## Last reviewed
- 2026-04-12
