---
status: accepted
---

# Guardian and tracked-session registries stay separate, not one `SessionLifecyclePolicy`

## Context

The CLI keeps two persisted session registries, and a recurring architecture-
review suggestion is to unify them behind a single `SessionLifecyclePolicy`
interface (or a shared `SessionRegistry<T>` base) because both are
"a `Map<string, entry>` persisted atomically to a JSON file, keyed by session".

On inspection the two registries encode genuinely different domains — different
keys, different value shapes, different lifespans, different consumers, and they
live in different subsystems:

- **`GuardianSessionRegistry`** (`packages/happy-cli/src/automation/GuardianSessionRegistry.ts`)
  maps automation **continuity keys** to a reusable `sessionId`, so a supervisor
  or agent-loop trigger reuses the same session across runs. Keys are derived by
  `buildGuardianKeys` — `loop:<loopId>` and `project:<projectId>:<trigger>:<agent>`
  — and **one session can be reached by several keys**. Its value
  (`GuardianSessionEntry = { key, projectId, sessionId, updatedAt, loopId?,
  lastRunId? }`) is a *continuity pointer*, not a process record. Its eviction
  verbs are continuity-shaped: `forgetByProjectAndTrigger`, `forgetLoop`,
  `forgetKey`, `resolveForSupervisor(data)`. Lifespan = as long as the loop /
  project-trigger continuity is wanted; **not tied to a live process**.

- **`TrackedSessionRegistry`** (`packages/happy-cli/src/daemon/TrackedSessionRegistry.ts`)
  tracks **live** daemon-spawned and externally-started sessions for the daemon
  control server, `/session-started` webhook, crash recovery, and the automation
  watchdog. Keys are process identifiers — `spawn:<spawnId>` (present from the
  moment the child is forked, before the server assigns an id) or
  `sess:<happySessionId>`, with `pickPrimaryKey` preferring `spawnId` so an entry
  keeps one stable key across the pre-/post-`/session-started` phases. Its value
  (`PersistedTrackedSession`) is a full **process record**: `pid`, `startedBy`,
  `startedAt`, `lastActivityAt`, `lastOutputAt`, `lastHeartbeatAt`, `activity`,
  `automationContext`, `tmuxSessionId`, `directoryCreated`. Its verbs are
  process-lifecycle-shaped: `upsert`, `recoverBySpawnId` (rebuild a live session
  after a daemon crash), `getBySpawnId`, `forgetSpawn`. Lifespan = a running
  process — created at fork, refreshed by heartbeats, removed at exit, and
  deliberately survives a daemon crash so the entry can be reattached.

The only thing the two literally share is the persistence idiom — an in-memory
`Map` snapshotted (sorted) and written through `atomicFileWrite`. That idiom is
~15 lines each and is already realized independently in both classes
(`GuardianSessionRegistry.flush` / `getSnapshot`; `TrackedSessionRegistry.flush`
/ `getAll`, the latter additionally serializing bursts behind a `writeLock`).

## Decision

**Keep the two registries separate. Do not introduce a `SessionLifecyclePolicy`
(or a shared `SessionRegistry<T>` base) over them.**

A unifying interface would have to grow options for every axis on which they
differ — key derivation (multi-key continuity vs single stable process key),
value shape (pointer vs process record), eviction triggers (loop/project vs
process-exit + crash-recovery), and recovery semantics — until the shared
interface was as complex as the two classes it hides. That is precisely the
shallow-module / premature-abstraction anti-pattern the codebase rejects: **the
surface similarity ("both persist a session-keyed Map") is not a shared
invariant.** The registries also sit in different subsystems (`automation/` vs
`daemon/`) with different consumers, so co-locating them behind one seam would
couple two independently-evolving lifecycles.

## Consequences

- Each registry owns the exact key namespace, value shape, and lifecycle its
  subsystem needs; changes to guardian continuity do not ripple into daemon
  process-tracking and vice versa.
- The duplicated part is only the ~15-line atomic-JSON-flush idiom. Two
  independent uses of `atomicFileWrite` is **not** drift worth an abstraction.
  If a THIRD persisted session-keyed registry appears needing the same
  `Map + snapshot-sort + atomicFileWrite` idiom, extract *only that persistence
  helper* — not a "lifecycle policy" — and only then (two = a real seam).
- A future review proposing "unify the session registries" or a
  `SessionLifecyclePolicy` should read this first: they are two domains, not one
  duplicated invariant.
</content>
</invoke>
