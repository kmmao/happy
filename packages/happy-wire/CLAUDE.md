# happy-wire CLAUDE.md

## Overview
Shared message wire types and Zod schemas (`@kmmao/happy-wire`) used by all Happy clients and services. This is a pure type/schema package with no runtime side effects.

## Wire-Specific Rules
- 2 spaces indentation, source in `src/`, tests as `.test.ts`
- ESM module system, bundled with pkgroll
- All message types must have corresponding Zod schemas for runtime validation
- Tests require a build first: `yarn workspace @kmmao/happy-wire test` runs `build && vitest run`
- Changes here affect all downstream packages (happy-cli, happy-agent, happy-server, happy-app) — ensure backward compatibility
