# happy-agent CLAUDE.md

## Overview
Remote-only CLI client (`@kmmao/happy-agent`) for controlling Happy Coder agents. Depends on `@kmmao/happy-wire` for shared message types.

## Agent-Specific Rules
- 2 spaces indentation, source in `src/`, tests as `.test.ts`
- ESM module system, bundled with pkgroll
- All debugging through file logs (never console output)
- Tests require a build first: `yarn workspace happy-agent test` runs `build && vitest run`
- Uses NaCl (tweetnacl) for E2E encryption, Socket.IO for real-time communication
