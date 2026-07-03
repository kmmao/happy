---
status: accepted
---

# CLI file watchers keep their own debounce — the strategies genuinely differ

## Context

Three CLI file watchers each pair `fs.watch` with a timer:

- `src/modules/taskLog/taskLogWatcher.ts`
- `src/automation/ProjectTodoWatcher.ts`
- `src/automation/AgentLoopFileWatcher.ts`

An architecture review flagged the debounce + cleanup lifecycle as duplicated and
proposed a shared `FileWatcherBase` / `Debouncer` seam.

Reading the three shows the timer logic is NOT the same behaviour wearing three
coats — the debounce *strategies* differ:

- **taskLogWatcher** — leading-edge + throttle. `scheduleRead` returns early when a
  timer is already pending (`if (entry.debounceTimer !== null) return`) and computes
  its wait as `max(DEBOUNCE_MS, MIN_PUSH_INTERVAL_MS - elapsed)`, i.e. it fires once
  per window AND rate-limits pushes. It also drives an incremental byte-offset read,
  not a whole-file flush.
- **ProjectTodoWatcher** — trailing-edge reset. Every change does
  `clearTimeout(t); t = setTimeout(flush, 2_000)`; only the last change in a burst
  fires, over a single todo file.
- **AgentLoopFileWatcher** — trailing-edge reset too, but over a **recursive** watch
  with per-`filename` filtering, at a 5_000 ms window.

So the watch shape (single-file+offset vs single-file vs recursive+filter) and the
timer semantics (leading+throttle vs trailing-reset) both differ. The only genuinely
common fragment is the two-line `clearTimeout; setTimeout` idiom shared by the two
trailing-reset watchers.

## Decision

**No shared watcher/debounce abstraction.** Each watcher keeps its own timer logic.

A `FileWatcherBase` that covered all three would need mode flags for leading-vs-
trailing, throttle-vs-plain, and offset-vs-flush — a leaky seam that is harder to
read than the three focused implementations. Extracting only the two-line
trailing-reset idiom shared by two watchers trades a trivial idiom for import
indirection with no invariant concentrated behind it (by the deletion test, deleting
such a helper would concentrate nothing).

## Consequences

- A future review re-flagging "three watchers duplicate debounce" should read this
  first: they implement three different debounce strategies over three different
  watch shapes; the similarity is superficial.
- If a fourth watcher appears that genuinely needs trailing-reset over a single file,
  revisit — three trailing-reset adapters would make a shared helper worth its keep.
- If `taskLogWatcher`'s throttle/offset logic ever needs to be reused, extract *that*
  (a rate-limited incremental reader), not a generic watcher base.
