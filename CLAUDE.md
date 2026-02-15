# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Happy Coder is a mobile/web client system for remotely controlling Claude Code and Codex with end-to-end encryption. Users run `happy` instead of `claude` on their computer, then control sessions from phone/web.

## Monorepo Structure

Yarn v1.22.22 workspaces with 4 packages:

| Package | Path | Purpose | Published As |
|---------|------|---------|-------------|
| **happy-cli** | `packages/happy-cli` | CLI wrapper for Claude Code/Codex with daemon | `@kmmao/happy-coder` on npm |
| **happy-server** | `packages/happy-server` | Fastify backend with Prisma/PostgreSQL/Redis | Private |
| **happy-app** | `packages/happy-app` | React Native + Expo mobile/web client | App stores |
| **happy-agent** | `packages/happy-agent` | Remote-only CLI for controlling agents | `happy-agent` |

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
yarn workspace happy-app test           # App: vitest watch mode
yarn workspace happy-app start          # App: Expo dev server
yarn workspace happy-app ios            # App: iOS simulator
yarn workspace happy-app android        # App: Android emulator

yarn workspace happy-agent build        # Agent: build (rm dist → tsc → pkgroll)
yarn workspace happy-agent test         # Agent: build then vitest run
```

**Important**: happy-cli and happy-agent tests require a build first (`$npm_execpath run build && vitest run`). The daemon spawns the built binary directly.

## Architecture

### System Flow
```
Mobile App / Web ←→ Server (Fastify + Socket.IO) ←→ CLI Daemon ←→ Claude Code/Codex
                         ↕
                    PostgreSQL + Redis + S3
```

### End-to-End Encryption
All user content is encrypted client-side before transmission. The server stores encrypted blobs blindly (never decrypts user content). Encryption uses AES-256-GCM (new) and NaCl secretbox (legacy compatibility).

### CLI Daemon Architecture
The CLI runs a persistent background daemon that:
- Manages multiple Claude sessions via spawned child processes
- Connects to the server via Socket.IO (machine-scoped connection)
- Exposes a local HTTP control server on 127.0.0.1 (random port)
- Handles RPC calls from mobile (spawn/stop sessions)
- Auto-updates when `npm upgrade happy-coder` is detected via heartbeat

Data isolation: `~/.happy` (stable) vs `~/.happy-dev` (development) can run in parallel.

### Real-time Sync Protocol
- Persistent updates use `update` events with monotonically increasing `seq` numbers
- Ephemeral events for presence/usage data
- Connection scopes: user-scoped, session-scoped, machine-scoped
- Optimistic concurrency with `expectedVersion` + version-mismatch responses

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

## Key Documentation

Detailed architecture docs live in `/docs/`:
- `protocol.md` — Network protocol specification
- `encryption.md` — Encryption protocol with binary layouts
- `cli-architecture.md` — CLI daemon, IPC, RPC details
- `backend-architecture.md` — Server architecture with Mermaid diagrams
- `api.md` — HTTP API endpoint catalog

Each package has its own `CLAUDE.md` with package-specific guidance — **read the relevant package CLAUDE.md before working on that package**.
