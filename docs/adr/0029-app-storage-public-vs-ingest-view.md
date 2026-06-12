# 0029 — App storage exposes a public view; ingest mutations are sync-only

## Decision

`sources/sync/storage.ts` exports the same zustand store under two types:

- **`storage: StoragePublicState`** — queries plus local-intent mutations
  (drafts, settings, pending queues, per-session preferences). This is what
  everything outside `sources/sync/` imports.
- **`ingestStorage: StorageState`** — adds the `apply*` mutations that land
  server-reported state (`applyMessages`, `applyMachines`, `applyProfile`,
  `applyArtifacts`, …). Only `sources/sync/` may use it; per ADR-0026 those
  calls live in the ingest seams and the sync engine.

The split is type-level (one store instance, narrowed export), so it costs no
runtime and is enforced by tsc: a component calling an ingest applier fails to
compile.

## Deliberately still public

`applySessions`, `applyFriends`, and the settings appliers (`applySettings`,
`applySettingsLocal`, `applyLocalSettings`) are called by components today as
optimistic local updates. They stay on the public view until each call site
gets an intent-named mutation; do not widen the public view with new `apply*`
methods.
