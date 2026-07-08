---
status: accepted
---

# The server-side optimistic-concurrency update loop is one seam

## Context

Several server records carry a monotonic `*Version` integer guarding a mutable
payload and are written under compare-and-swap (optimistic concurrency control):
`AccessKey.dataVersion`, `Session.metadataVersion`, `Session.agentStateVersion`,
`Session.preferencesVersion`, `Machine.metadataVersion`,
`Machine.daemonStateVersion`, and `Account.settingsVersion`. Every writer must run
the identical dance: read the current version, reject if the caller's
`expectedVersion` no longer matches, update *guarded by* that version so a
concurrent writer who slipped in between loses the race (the guarded `updateMany`
matches zero rows), then re-read to report whoever actually won. The `count === 0`
re-read and the `version + 1` off-by-one are the bug-prone steps.

`modules/versionedUpdate.ts` (`versionedUpdate<V>`) already owns this dance —
callers pass a `read`/`write` closure pair over their own Prisma model and consume
a discriminated result (`applied` / `not-found` / `version-mismatch` with the
current version+value). It is the server-side sibling of the CLI's
`runVersionedUpdate<T>` (ADR-0065); the two are independent because they live in
different processes over different transports.

Two call sites had drifted into hand-rolled copies of the loop instead of using
the seam:

- `sessionPreferencesHandler` re-implemented the read → check → guarded write →
  `count === 0` inline, and on a lost race reported the **stale pre-read version**
  rather than re-reading the winner — a latent correctness gap the seam does not
  have.
- The `PUT /v1/account/settings` route re-implemented the same loop for
  `Account.settingsVersion`.

An architecture review re-suggested "extract the versioned update" as if it did
not exist, because the drifted copies made the seam look absent. This ADR records
the seam so that does not recur.

## Decision

`versionedUpdate<V>` is the single owner of the server CAS loop. All versioned
writers delegate to it and keep only their own *outward* shape (HTTP status,
socket ack, `emitSyncUpdate` body slot):

- `AccessKey` — `accessKeysRoutes`.
- `Session` — `sessionVersionedFieldUpdate`, whose `SessionVersionedField`
  discriminant now covers **all three** session blobs (`metadata` | `agentState`
  | `preferences`). `preferences` was folded in from the inline copy;
  `sessionPreferencesHandler` and `sessionUpdateHandler` are thin
  validate-then-delegate adapters.
- `Machine` — `machineVersionedUpdate` (`metadata` | `daemonState`).
- `Account` — `accountRoutes` settings update calls `versionedUpdate<string | null>`
  directly.

A new versioned record adds a `read`/`write` driver, never a re-implementation of
the loop.

## Consequences

- The retry/adopt rule is unit-tested once (`versionedUpdate.spec.ts`) plus per
  adapter (`machineVersionedUpdate.spec.ts`, `sessionVersionedFieldUpdate.spec.ts`)
  with a mocked Prisma layer — no live DB.
- Folding `preferences` into the seam fixed its lost-race report to re-read the
  winner, matching metadata/agentState.
- `sessionPreferencesHandler` no longer imports `db`/`emitSyncUpdate`; the CAS and
  broadcast live behind the seam.
- Future reviews should treat a fresh inline `*Version` `updateMany` guarded by
  `expectedVersion` as the smell that this ADR is being re-litigated.
