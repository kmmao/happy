---
status: accepted
---

# AutoOptionSend keeps per-session state in one record; option scores stay a global cache

## Context

`packages/happy-app/sources/sync/autoOptionSendService.ts` is a deep module behind a
small interface (`toggle` / `dispatch` / `getState` / `subscribe` / `updateUIContext` /
`recordManualSend` / the `trigger*` scoring+generation entry points). Its *implementation*,
however, kept all per-session state in **17 parallel `Map<string, …>` fields** keyed by a
bare string. Two failure modes followed from that shape:

1. **Disposal was a manual checklist.** `disposeSession` had to remember to `.delete(sessionId)`
   from every map; a new per-session map silently leaked until someone noticed.
2. **Key drift was invisible.** Nothing said *which* string each map used. Two of them —
   `semanticScores` and `semanticMeta` — are actually keyed by **optionsHash** (a
   cross-session option-set identity), not sessionId. Their per-session `delete(sessionId)`
   in `disposeSession` never matched a key, so it was dead code and the caches grew unbounded.

## Decision

**Collapse the 15 genuinely per-session maps into one `Map<sessionId, SessionAosRecord>`,
and keep `semanticScores` / `semanticMeta` as explicitly-labelled global caches keyed by
optionsHash.** The external interface is unchanged — this is an internal seam.

- A record is created lazily by `ensure(sessionId)` on first write; read paths use
  `peek(sessionId)` (no create) so a message arriving for an untracked session never
  allocates a record (preserving the old per-map create-on-write semantics).
- `disposeSession` aborts the record's in-flight controllers, stops its timer, and deletes
  the one record — no per-field checklist. A new per-session field added to
  `SessionAosRecord` is cleaned up automatically and is enforced by the compiler to live in
  the one place.
- `semanticScores` / `semanticMeta` are NOT part of `SessionAosRecord` and are deliberately
  never cleared per-session. A header comment marks them as optionsHash-keyed so the old
  drift cannot recur silently.

## Considered options

- *Leave the parallel maps; just make `disposeSession` iterate a registered list.* Rejected:
  it fixes leak-on-dispose but not the invisible-key-drift problem, and a read/write across
  17 maps still has no single owner of "this session's state".
- *Also move `semanticScores`/`semanticMeta` into the per-session record.* Rejected: they are
  legitimately cross-session (the same option set scored once is reused wherever it appears).
  Forcing them per-session would re-score identical option sets and re-introduce the
  mismatched-key delete. They are a different concept and stay a separate cache.
- *Bound the global caches (LRU/cap) in this change.* Deferred: the caches are unbounded
  today and that is a separate concern from the state-consolidation seam. The header comment
  now makes the unbounded growth visible; bounding it is a follow-up if it proves to matter.

## Consequences

- `disposeSession` is correct-by-construction; adding per-session state can no longer leak.
- The sessionId-vs-optionsHash distinction is now structural, not a convention a reader has
  to reverse-engineer from call sites.
- Tests that reached into the old `semanticControllers` / `…Controllers` maps now address the
  single `sessions` record map (`autoOptionSendService.test.ts` "aborts and removes session
  controllers").
- A future review eyeing "AutoOptionSend has too much state" should note the state is now in
  one record with a small public interface; the remaining depth is intrinsic to the feature.
