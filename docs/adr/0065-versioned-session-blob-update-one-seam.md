---
status: accepted
---

# The optimistic-concurrency update loop for versioned session blobs is one seam

## Context

The CLI's `SessionClient` (`packages/happy-cli/src/api/apiSession.ts`) syncs two
independently-versioned encrypted blobs to the server: session **metadata** and
**agentState**. Each had its own update method (`updateMetadata`,
`updateAgentState`) that re-implemented the identical optimistic-concurrency
control flow inline:

- take the blob's `AsyncLock` (one in-flight update per blob),
- inside `backoff(...)`: apply the caller's handler, `emitWithAck` the encrypted
  payload with `expectedVersion`,
- on `success`: decode + store value and version,
- on `version-mismatch`: adopt the server's value+version **only if strictly
  newer** than what we hold, then `throw` so `backoff` re-attempts,
- on hard `error`: give up silently.

The only real differences between the two methods were type-specific glue: the
lock, the socket event name, the version field, the encrypt/decode functions,
and the answer's payload key. The invariant-bearing part — the
adopt-if-newer-then-retry loop — was duplicated verbatim, byte-for-byte modulo
those names. A third versioned blob (e.g. a future `daemonState`) would have
copied the lock + version + retry triad a third time, and the retry/adopt rule
had no single test surface: verifying it meant driving a live socket.

## Decision

`packages/happy-cli/src/api/versionedUpdate.ts` owns the loop as a standalone,
generic `runVersionedUpdate<T>(driver)`. The driver supplies only the
type-specific pieces:

- `lock` — the blob's serialization lock,
- `currentVersion()` — read the locally-known version,
- `attempt(expectedVersion)` — do the one emit + decode, returning a normalized
  `VersionedUpdateOutcome<T>` (`success` / `version-mismatch` / `error`),
- `commit(version, value)` — write the accepted pair to local state.

`runVersionedUpdate` owns the invariant: run in lock, retry under backoff, commit
on success, adopt-if-strictly-newer then throw-to-retry on mismatch, stop on
error. It stays fire-and-forget (queues on the lock, returns void), matching the
prior callers. `updateMetadata` and `updateAgentState` keep their strongly-typed
`emitWithAck` calls inside their own `attempt` closures — no type erasure of the
event→payload linkage.

## Consequences

- The retry/adopt rule is unit-tested in isolation (`versionedUpdate.test.ts`)
  with a fake lock + scripted attempts — no socket, no cipher. The interface is
  the test surface: the four behaviors (success, adopt-newer-retry,
  ignore-not-newer, hard-error-stop) are pinned directly.
- A new versioned blob adds a driver, not a re-implementation of the loop; the
  concurrency invariant is applied by construction.
- `backoff` is no longer imported by `apiSession.ts` — the retry lives behind the
  seam. `delay` remains (used elsewhere).
- The real `backoff` (imported by the seam) is exercised by the retry tests;
  they terminate because the scripted `attempt` eventually returns success.
