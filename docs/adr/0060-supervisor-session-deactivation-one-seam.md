---
status: accepted
---

# Presence-only session deactivation is owned by one seam (sessionDeactivate)

## Context

ADR-0054 gave the Supervisor fix-status lifecycle a single owner for the
*decision* "should this session be archived?" (`decideFixStatusReport` →
`archiveSessionInDb: boolean`). The *mechanic* that applies that decision — flip
the session inactive and refresh presence — had no owner and was hand-rolled at
three call sites:

- **A** `supervisorRunStatusApply.ts` — on run completion.
- **B** `supervisorFixStatusHandler.ts` — on a CLI fix-status report (archive branch).
- **C** `supervisorActionRoutes.ts` — on manual fix resolve.

A and B were byte-identical:

```ts
const now = Date.now();
await db.session.updateMany({ where: { id, active: true },
                             data: { lastActiveAt: new Date(now), active: false } });
activityCache.invalidateSession(id);
await emitSyncEphemeral(userId, { t: "session-activity", sessionId: id, active: false, activeAt: now });
```

C had **drifted**: it did only the `updateMany`, skipping the cache invalidation
and the `session-activity(false)` ephemeral. The result was a latent
inconsistency — after a manual fix-resolve the App's presence view stayed stale
until the next heartbeat timeout, whereas the A/B paths flipped it immediately.

The existing `sessionArchive()` (`app/session/sessionArchive.ts`) could not be
reused: it additionally sends `session-terminate` (the Supervisor flows must NOT
— the kill signal is a separate decision, emitted as
`supervisor-fix-kill-session` / `requestSessionKill`), and it runs inside a
`Context` / `inTx` flow, while the Supervisor completion handlers operate on the
raw `db` client + a `userId` string.

## Decision

`app/session/sessionDeactivate.ts` owns the presence-only deactivation mechanic:
guarded `updateMany` (active:true → active:false, lastActiveAt) + heartbeat cache
invalidation + `session-activity(false)` ephemeral. The kill signal stays
caller-owned. Callers pass `(userId, sessionId)`.

A and B are replaced verbatim (pure dedup, zero behavior change). **C is
normalized** onto the same seam — this deliberately adds the missing cache
invalidation + `session-activity` ephemeral to the manual-resolve path, healing
the drift so all three completion paths signal presence identically. The
separate `supervisor-fix-kill-session` emit at C is unchanged and still follows
the deactivation.

This is the mechanic-level companion to ADR-0054's decision-level seam: the
decision lives in `supervisorFixStatusLogic`, the mechanic lives in
`sessionDeactivate`, and callers wire the two together.

## Consequences

- A change to how a Supervisor session is deactivated (fields written, cache
  eviction, presence signal) is one edit in one seam; the three paths pick it up.
- The manual-resolve path (C) now updates App presence immediately, matching the
  automated paths — a small correctness fix folded into the consolidation.
- `sessionDeactivate` and `sessionArchive` remain distinct on purpose:
  deactivate = presence only; archive = presence **plus** daemon terminate. The
  seam's doc comment records the distinction so future readers do not merge them.
- Existing coverage (`supervisorFixStatusHandler.spec.ts`, which pins
  `invalidateSession` called on archive / not on non-archive) passes unchanged,
  because the seam imports `db`, `activityCache`, and the ephemeral transport
  from the same module boundaries the spec already mocks.
