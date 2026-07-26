# happy-wire CLAUDE.md

## Overview
Shared message wire types and Zod schemas (`@kmmao/happy-wire`) used by all Happy clients and services. This is a pure type/schema package with no runtime side effects.

## Source Files

| File | Purpose |
|------|---------|
| `messages.ts` | Session messages, update events, encrypted value schemas |
| `machineTypes.ts` | MachineMetadata, DaemonState, TailscaleInfo — **single source of truth** |
| `sessionProtocol.ts` | Session protocol envelope types |
| `legacyProtocol.ts` | Legacy agent/user message formats |
| `messageMeta.ts` | Message metadata (model, permissions, thinking) |
| `voice.ts` | Voice token request/response schemas (ElevenLabs integration) |
| `tasks.ts` | Task queue schemas — priority, status, trigger, dispatch, reporting |
| `skills.ts` | Skill CRUD schemas and injection content type |

## Wire-Specific Rules
- 2 spaces indentation, source in `src/`, tests as `.test.ts`
- ESM module system, bundled with pkgroll
- All message types must have corresponding Zod schemas for runtime validation
- Tests require a build first: `yarn workspace @kmmao/happy-wire test` runs `build && vitest run`
- Changes here affect all downstream packages (happy-cli, happy-agent, happy-server, happy-app) — ensure backward compatibility
- New optional fields are safe (backward compatible); removing or renaming fields is breaking
- After changing wire, always rebuild and test downstream: CLI (`build`), Agent (`build + test`), App (`typecheck`)

## Publish Checklist
1. `yarn workspace @kmmao/happy-wire build`
2. `yarn workspace @kmmao/happy-wire test`
3. Bump version in `package.json`
4. `cd packages/happy-wire && npm publish --access public`
5. Update `@kmmao/happy-wire` version in CLI and Agent `package.json`
6. Publish CLI and Agent with updated dependency
