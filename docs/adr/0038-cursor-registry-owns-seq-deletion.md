---
status: accepted
---

# The cursor registry owns seq deletion; the message-delivery seams stay separate

## Context

An architecture review proposed unifying the App's "message delivery lifecycle" — the
`SessionMessageCursor` (per-session seq + live dedup), the `SessionMessageProcessor`
(queue / lock / rAF batching), and the outgoing `pendingOutbox` — under one owner, on the
theory that they "must mutate in lockstep with no single owner."

On reading, most of that premise does not hold:

- `sessionMessageCursor.ts` and `sessionMessageProcessor.ts` are **already deep, deliberately
  consolidated seams** (each file's header documents the parallel Sync-class state it
  replaced). They cover *orthogonal* concerns — ordering/dedup vs batching/concurrency — and
  reading both to understand "a message arrives" is inherent, not fragmentation.
- The outgoing `pendingOutbox` is the **opposite direction** (client→server sends with
  retry/ack) from the cursor/processor's incoming server→client path. Folding them into one
  "lifecycle" would merge two unrelated concerns.
- Per-session *teardown* is already concentrated: the LRU-eviction path
  (`releaseSessionResources`) and the deletion path (the `session-deleted` ingest subscriber)
  each enumerate their collaborators in one place, and they diverge **by deliberate policy** —
  eviction calls `cursor.releaseDedup()` to KEEP the seq for incremental refetch, deletion
  forgets it. That divergence is load-bearing, not a bug, so a single unified dispose is wrong
  (cf. ADR-0036's caller-owned variance).

One genuine, policy-free coupling did remain: every `cursors.delete(sessionId)` call site
also had to remember to call the separate persistence function `deleteLastSeq(sessionId)`,
because the registry owned seq *persistence on write* (`advanceTo` saves) but not *on delete*.
The two were split across files — the ingest delete handler called `ctx.cursor.delete` while a
separate Sync subscriber called `deleteLastSeq` — and the asymmetry had already drifted (the
ingest cursor adapter deleted the in-memory cursor without the persisted seq, and vice versa).

## Decision

**Give `SessionMessageCursorRegistry.delete()` ownership of the persisted seq too**, by
injecting `deleteLastSeq` as a `deleteSaved` callback (mirroring the `saveLastSeq` it already
holds). `delete` now forgets the in-memory cursor, the seed, AND the persisted seq in one
call; the four scattered standalone `deleteLastSeq` calls are removed. The keep-seq policy is
unaffected because eviction never calls `delete` — it uses `releaseDedup()`. Do **not** merge
the cursor, processor, and outbox into one module — they are already-deep seams covering
distinct, sometimes opposite-direction, concerns.

## Considered options

- *One "SessionMessageLifecycle" module owning cursor + processor + outbox.* Rejected: it
  would fuse orthogonal (and opposite-direction) concerns behind one interface that would be
  as complex as the three it replaced — a shallow seam — and would have to encode the
  deliberate evict-keeps-seq / delete-forgets-seq policy split as flags.
- *Leave `deleteLastSeq` paired at each call site.* Rejected: the pairing is an unwritten
  invariant ("never delete the cursor without its persisted seq") that had already drifted.
  The registry already owns seq on the write side; owning it on the delete side makes the
  invariant structural.

## Consequences

- `cursors.delete` is now self-complete: no caller pairs it with `deleteLastSeq`, and the
  in-memory/persisted asymmetry across the ingest handler and the Sync subscriber is closed.
- The cursor/processor/outbox seams stay separate by design; a future review proposing to
  merge them should read this first.
- Pinned by `sessionMessageCursor.test.ts` ("delete also deletes the persisted seq").
