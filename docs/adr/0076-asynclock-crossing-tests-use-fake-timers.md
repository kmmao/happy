---
status: accepted
---

# Tests that cross an AsyncLock never wait on the wall clock

## Context

`AsyncLock.unlock()` does not hand the lock to the next waiter synchronously —
it schedules the handoff:

```ts
// utils/lock.ts:34
setTimeout(() => { nextResolver(true); }, 0);
```

All three copies of the lock (`happy-cli/src/utils/lock.ts`,
`happy-app/sources/utils/lock.ts`, `happy-server/sources/utils/lock.ts`) are
identical in this respect. So **every contended lock acquisition costs one
macrotask turn**, and a chain of N queued waiters costs N of them.

`OutgoingMessageQueue` compounds this. One `enqueue()` reaches "sent" through:

1. `lock.inLock()` inside `enqueue()` — fire-and-forget, not awaited
2. `scheduleProcessing()` → `setTimeout(0)`
3. `processQueue()` → a *second* lock acquisition, itself possibly a handoff

Three consecutive enqueues therefore need several macrotask turns before the
first message is observable. On an idle loop that is a couple of milliseconds.
Under `vitest` running 184 test files in parallel, a congested event loop
routinely stretches a nominal `setTimeout(0)` far beyond that.

`OutgoingMessageQueue.test.ts` bet a fixed `await wait(20)` on that chain and
went intermittently red during the 2026-07 release runs — a different case each
time (FIFO order, head-of-line blocking, auto-release), always green in
isolation, always green on re-run. The worst case asserted in BOTH directions
around a 30ms delay ("nothing sent at 10ms" AND "sent by 60ms"), so jitter on
either side flipped it. The `destroy()` case already carried the tell in prose:
`await wait(5); // let enqueue's async lock register the delay timer first`.

Two mitigation styles were already in the codebase, unlabelled:

- `sessionMessageProcessor.test.ts:6` — `const flush = () => new Promise(r => setTimeout(r, 0))`,
  with the comment "Drain the microtask queue and the AsyncLock's setTimeout(0)
  handoff." This queues *behind* the pending handoff rather than betting on a
  duration, and is sound for its use.
- `OutgoingMessageQueue.test.ts` — `wait(20)`, a duration bet. Not sound.

## Decision

**A test that crosses an AsyncLock must never assert after a fixed wall-clock
wait.** Pick by what the test is actually pinning:

| The test pins | Use |
|---|---|
| "the lock handoff has settled" — no real duration in the assertion | `await new Promise(r => setTimeout(r, 0))`, repeated once per expected handoff |
| **any real timing semantics** — a delay elapsing, a timer firing, a timeout not firing | `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(n)` |

`OutgoingMessageQueue.test.ts` is the second kind: it pins "a 30ms delay
auto-releases", which a drain-one-turn helper cannot express — you cannot
fast-forward with it, only yield. It now runs on fake timers.

**Fake timers have one trap here.** Methods that `await` the lock
(`flush()`, `releaseToolCall()`) may need a timer to hand it over. Awaiting
them directly under fake timers deadlocks: the test is blocked, so nothing
advances the clock, so the handoff never fires. Race the call against a clock
advance instead:

```ts
async function resolveWithTimers<T>(operation: Promise<T>, ms = 50): Promise<T> {
    const advanced = vi.advanceTimersByTimeAsync(ms);
    const result = await operation;
    await advanced;
    return result;
}
```

**Fake timers must be proven non-vacuous.** They make it easy to write a test
that no longer exercises anything and passes regardless. When converting a
timing test, mutate the implementation and confirm the suite goes red. The
`OutgoingMessageQueue` conversion was validated against three mutations:
disabling the head-of-line guard (4 failures), reversing the FIFO sort
(4 failures), and making the delay timer never fire (exactly 1 failure, the
auto-release case).

## Considered options

- *Raise the wall-clock waits (20ms → 200ms).* Rejected: it lowers the failure
  rate without removing the race, and multiplies suite runtime across every
  timing test. A slower machine or a busier CI box re-opens it.
- *Run the affected file with `--no-threads` / `sequential`.* Rejected: it
  hides the flake by removing the contention that exposes it, leaves the
  duration bet in the code, and gives up parallelism for the whole file.
- *Make `AsyncLock.unlock()` hand over via `queueMicrotask` instead of
  `setTimeout(0)`.* Rejected as out of scope and riskier than the flake:
  the macrotask handoff is load-bearing for re-entrancy (it guarantees the
  releasing caller's stack fully unwinds before the next holder runs), it is
  duplicated across three packages that cannot import each other, and changing
  it would alter interleaving for every AsyncLock consumer — `apiSession`,
  `sessionMessageProcessor`, `syncMessageFetch`, `issueSessionStore`,
  `usageHandler`, `sessionUpdateHandler` and others — to fix a test problem.
- *Assert via polling (`waitFor`-style) instead of a fixed wait.* Rejected as
  a general rule: polling is fine for "eventually X", but useless for the
  negative half of a timing assertion ("nothing sent BEFORE the delay"), which
  is exactly where this file broke.

## Consequences

- `OutgoingMessageQueue.test.ts` runs ~11ms instead of ~247ms, and survived
  three consecutive full-suite runs (184 files in parallel) after the change.
- New timing tests over `OutgoingMessageQueue`, or over any other AsyncLock
  consumer, start from the table above rather than from a `wait(n)` copy-paste.
- The `setTimeout(0)` handoff in `AsyncLock` stays. This ADR records it as a
  known, deliberate cost paid at the test layer — not a defect to be fixed in
  the lock.
- A future flake in a lock-crossing test should be read as a duration bet
  first, before suspecting the implementation.
