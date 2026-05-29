---
status: accepted
---

# Update-handler encryption readiness is one seam over the session + machine scopes; artifacts stay out

Every scope-encrypted sync update handler must, before decrypting, guarantee the scope's encryption is ready — and recover when a push loses the startup race against the in-flight sync (the push arrives before the sync has registered that id's encryptor). This invariant used to be copy-pasted into each handler in `happy-app`'s `sources/sync/syncUpdateHandlers.ts`, and it had silently drifted:

- `handleNewMessageUpdate` (#84) and `handleUpdateSessionUpdate` (#80) did `getSessionEncryption → awaitQueue → re-read → fetchSessions`.
- `handleUpdateMachineUpdate` did none of it — no `awaitQueue`, no refetch — so a machine update that raced its sync was silently dropped. This was a latent bug, not a deliberate exemption: `machinesSync.awaitQueue()` already existed (`sync.ts`), it had just never been threaded into the handler context.

We distilled the invariant into a single owner — `sources/sync/syncEncryptionScope.ts`, `resolveScope` — exposed as `resolveSessionEncryption` and `resolveMachineEncryption`. Each handler now reads a ready encryptor in two lines, or gets `null` (recovery already triggered) and returns. The recovery policy lives in exactly one place, and the machine scope gets the race fix for free.

## Artifacts are deliberately NOT covered

`handleNewArtifactUpdate` resolves a **per-Artifact data key** (`decryptEncryptionKey` + `ArtifactEncryption`), not a scope encryptor fetched from `ctx.encryption`. Per ADR-0001 (E2E encryption) and the domain model, an Artifact "is a generic encrypted data container with its own encryption key." Folding it into `resolveScope` would union two unrelated "obtain an encryptor" shapes behind one interface — the same shallow over-abstraction ADR-0001 (spawnsession) warns against. Artifact readiness stays in its own handler.

## Considered alternatives

- **Include artifacts in the unified resolver.** Rejected: different key model (per-artifact data key vs. per-scope encryptor); a forced union with no shared consumer.
- **Push readiness into the dispatcher** (the `sync.ts` switch resolves the scope before calling the handler; handlers take a guaranteed-ready `scope` argument). More leverage — the precondition leaves every handler entirely — but it costs changing the dispatcher, every handler signature, and maintaining a `body.t → scope kind` map. Not adopted now; revisit if the handler count grows enough that per-handler `resolve*` calls become the friction.

## Consequences

- `UpdateHandlerContext` now carries `machinesSync` and `fetchMachines` alongside the session equivalents.
- A future architecture review that proposes "merge artifact decryption into the encryption-scope resolver," or asks "why do machine and session share one readiness path," should read this first — the scope set (session + machine, not artifact) is intentional.
- New scope-encrypted update types should call `resolveSessionEncryption` / `resolveMachineEncryption` rather than re-implementing the race + recover dance.
