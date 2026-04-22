# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Happy Coder is a mobile/web client system for remotely controlling Claude Code and Codex with end-to-end encryption. Users run `happy` instead of `claude` on their computer, then control sessions from phone/web.

## Monorepo Structure

Yarn v1.22.22 workspaces with 5 packages:

| Package | Path | Purpose | Published As |
|---------|------|---------|-------------|
| **happy-cli** | `packages/happy-cli` | CLI wrapper for Claude Code/Codex with daemon | `@kmmao/happy-coder` on npm |
| **happy-server** | `packages/happy-server` | Fastify backend with Prisma/PostgreSQL/Redis | Private |
| **happy-app** | `packages/happy-app` | React Native + Expo mobile/web client | App stores |
| **happy-agent** | `packages/happy-agent` | Remote-only CLI for controlling agents | `@kmmao/happy-agent` on npm |
| **happy-wire** | `packages/happy-wire` | Shared message wire types and Zod schemas | `@kmmao/happy-wire` on npm |

## Common Commands

```bash
# Install all dependencies
yarn install

# Per-package commands (run from monorepo root)
yarn workspace @kmmao/happy-coder build        # CLI: build (rm dist → tsc → pkgroll)
yarn workspace @kmmao/happy-coder test         # CLI: build then vitest run
yarn workspace @kmmao/happy-coder dev          # CLI: dev mode via tsx

yarn workspace happy-server build       # Server: tsc --noEmit
yarn workspace happy-server test        # Server: vitest run
yarn workspace happy-server dev         # Server: start with .env files
yarn workspace happy-server generate    # Server: prisma generate

yarn workspace happy-app typecheck      # App: tsc --noEmit
yarn workspace happy-app test           # App: vitest run
yarn workspace happy-app start          # App: Expo dev server
yarn workspace happy-app ios            # App: iOS simulator
yarn workspace happy-app android        # App: Android emulator

yarn workspace happy-agent build        # Agent: build (rm dist → tsc → pkgroll)
yarn workspace happy-agent test         # Agent: build then vitest run
```

**Important**: happy-cli and happy-agent tests require a build first (`$npm_execpath run build && vitest run`). The daemon spawns the built binary directly.

## Architecture

See `/docs/` for detailed architecture — key docs: `cli-architecture.md`, `protocol.md`, `encryption.md`, `backend-architecture.md`, `api.md`.

System: `Mobile/Web ←→ Server (Fastify+Socket.IO) ←→ CLI Daemon ←→ Claude Code/Codex` with PostgreSQL+Redis+S3. All content E2E encrypted (AES-256-GCM / NaCl secretbox). Data isolation: `~/.happy` (stable) vs `~/.happy-dev` (dev).

## Code Style (All Packages)

- **TypeScript strict mode** everywhere
- **Functional programming** preferred, avoid classes
- **Path alias**: `@/*` maps to `./src/*` (CLI/Agent) or `./sources/*` (Server/App)
- **All imports at file top**, never mid-code
- **Named exports** preferred
- **Yarn** only, never npm
- **Vitest** for all testing, no mocking in CLI tests (real API calls)
- **Zod** for runtime validation

### Package-Specific Conventions

| Convention | CLI/Agent | Server | App |
|-----------|-----------|--------|-----|
| Indentation | 2 spaces | 4 spaces | 4 spaces |
| Source dir | `src/` | `sources/` | `sources/` |
| Test suffix | `.test.ts` | `.spec.ts` | `.test.ts` |
| Bundler | pkgroll | tsx (runtime) | Metro (Expo) |
| Module system | ESM | ESM (CommonJS tsconfig) | Expo |

### Server-Specific Rules
- File naming: match function name to file name (e.g., `sessionCreate.ts` exports `sessionCreate`)
- Use `inTx` for database transactions, `afterTx` for post-commit events
- Never run non-transactional operations (file uploads) inside transactions
- Never create Prisma migrations manually — only `yarn generate` when schema changes
- Use `privacyKit.decodeBase64`/`encodeBase64` instead of Buffer
- All API operations must be idempotent
- Prefix action files with entity type then action (e.g., `friendAdd.ts`)

### App-Specific Rules
- All user-visible strings must use `t('key')` from `@/text` (i18n with 9 languages)
- Use `StyleSheet.create` from `react-native-unistyles` (not RN's StyleSheet)
- Never use `Alert` module — use `@/modal` instead
- Use `useHappyAction` for async operations with auto error handling
- Use `expo-router` API, not react-navigation directly
- Wrap pages in `React.memo`, put styles at end of file
- App pages go in `@sources/app/(app)/`
- No backward compatibility code ever

### CLI-Specific Rules
- All debugging through file logs (never console output that disturbs Claude sessions)
- Logging to `~/.happy-dev/logs/` or `$HAPPY_HOME_DIR/logs/`

## Package Dependency & Sync Rules

### happy-wire is the single source of truth

`@kmmao/happy-wire` defines shared Zod schemas consumed by all other packages:

| Schema | File | Consumers |
|--------|------|-----------|
| `MachineMetadataSchema` | `machineTypes.ts` | CLI, Agent, Server, App |
| `DaemonStateSchema` | `machineTypes.ts` | CLI, Agent, Server, App |
| `TailscaleInfoSchema` | `machineTypes.ts` | CLI, Agent, Server, App |
| `SessionMessageSchema` | `messages.ts` | CLI, Agent, Server, App |
| `UpdateMachineBodySchema` | `messages.ts` | CLI, Agent, Server, App |

**When modifying shared types** (DaemonState, MachineMetadata, etc.):
1. Edit in `packages/happy-wire/src/` only
2. Build wire: `yarn workspace @kmmao/happy-wire build`
3. Verify downstream builds: CLI, Agent, Server, App
4. Publish wire first, then downstream packages

### Publish order (always follow)

```
1. @kmmao/happy-wire   (shared types — must be first)
2. @kmmao/happy-coder  (CLI — depends on wire as devDependency, pkgroll inlines)
3. @kmmao/happy-agent  (Agent — depends on wire as runtime dependency)
```

### When to update each package together

| Change | Wire | CLI | Agent | App |
|--------|------|-----|-------|-----|
| Add/modify DaemonState fields | Yes | Yes (re-export) | Yes (re-export) | UI if needed |
| Add/modify wire message types | Yes | If consumed | If consumed | If consumed |
| CLI-only feature (new RPC handler) | No | Yes | No | If UI needed |
| Agent-only feature | No | No | Yes | If UI needed |
| Tailscale detection changes | No | Yes (detection logic) | Yes (detection logic) | If UI changed |

**Note**: CLI and Agent each have their own `utils/tailscale.ts` (adapted from the same source). Changes to Tailscale detection logic must be synced to both files. This is intentional — the packages cannot import each other.

## Key Documentation

Each package has its own `CLAUDE.md` with package-specific rules — read it before working on that package.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
