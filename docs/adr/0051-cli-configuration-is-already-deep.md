---
status: accepted
---

# CLI configuration/paths stay in `configuration.ts` — no `ConfigLoader` split

## Context

An architecture review flagged `packages/happy-cli/src/configuration.ts`,
`src/projectPath.ts`, and `src/codex-shared/codexHomeOverlay.ts` as a scattered,
three-way configuration seam "with no single source of truth for precedence,"
and proposed consolidating them behind an injected `ConfigLoader`.

Reading the three files disproves the premise:

- **`configuration.ts`** is already a deep module. One `Configuration` class, one
  exported singleton (`configuration`), and the precedence chain is centralized and
  documented in place: `HAPPY_*_URL` env > `settings.<key>` > default for URLs, and
  `HAPPY_HOME_DIR` env > default home dir for paths. Every path (`logsDir`,
  `settingsFile`, `privateKeyFile`, `sessionKeysDir`, …) derives from `happyHomeDir`.
  By the deletion test it earns its keep: delete it and the `env || setting || default`
  logic reappears at every call site.
- **`projectPath.ts`** (8 lines) is orthogonal. It resolves the CLI's own install
  directory (for spawning the built binary), not user settings — it shares no
  precedence logic with `configuration.ts`.
- **`codexHomeOverlay.ts`** is already deep — small interface
  (`createCodexHomeOverlay({ authJson, sourceHome? }) → { path, cleanup }`), real
  behavior behind it (temp dir, selective symlinking, `auth.json` injection,
  cross-platform junction handling, cleanup handle). It has exactly one consumer
  (Codex auth). Generalizing it to a `createHomeOverlay(sourceDir, overrides,
  excludePatterns)` would be a hypothetical seam: nothing yet varies across it
  (one adapter, not two).

## Decision

**No change.** Keep configuration/path resolution in `configuration.ts` as the single
deep module it already is. Do not introduce a `ConfigLoader` indirection layer, and do
not fold `projectPath.ts` or `codexHomeOverlay.ts` into it — they are separate concerns.

## Consequences

- A future review re-flagging these three files should read this first. The precedence
  is centralized in `configuration.ts`; the other two files are unrelated to it.
- If a **second** home-overlay consumer appears (e.g. another provider needing an
  auth-injected home dir), revisit `codexHomeOverlay.ts` — at two adapters the seam
  becomes real and generalizing is justified.
- If URL/path precedence ever needs to differ per-invocation (rather than per-process),
  the singleton assumption breaks and injection becomes worth reconsidering.
