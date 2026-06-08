---
status: accepted
---

# Server-side SyncEphemeral emission is a parallel seam to SyncUpdate; the recipient set is a function of `body.t`

A **SyncEphemeral** (CONTEXT.md, introduced here) is a typed server→client broadcast that is **not** seq-ordered and **not** reconciled by clients. ADR-0013 already established the persistent (SyncUpdate, seq + dedup) vs ephemeral (no seq, fire-and-forget) split. ADR-0023 collapsed the 32 SyncUpdate emit sites behind a single seam (`emitSyncUpdate` in `syncUpdate.ts`). This ADR is the symmetric move for the 78 SyncEphemeral emit sites.

## Survey

Enumerating every `eventRouter.emitEphemeral` call in production code:

- **78 emit sites** across ~30 files
- **32 distinct body types**: 22 today implemented via `build*Ephemeral` functions in `eventRouter.ts`, 10 today emitted as inline `payload: { type: "...", ... }` literals
- **0 sites use the eventRouter default filter** (`all-user-authenticated-connections`) — every site explicitly sets a `recipientFilter`
- **`body.type → recipientFilter` is a function for 31 / 32 body types**. The one exception is `inter-agent-message`, which is deliberately fanned out twice from `interAgentMessageHandler.ts` — once to the destination Session and once back to the sender's user-scoped App. Decision below.

The shape problem mirrors SyncUpdate's: every call site re-decides `body.type ↔ recipientFilter`; nothing catches a wrong choice; adding a new body type requires touching N call sites' reviewer-knowledge.

## Decision

**One seam owns SyncEphemeral emission on the server side: `sources/app/events/syncEphemeral.ts`**, parallel to `syncUpdate.ts`. The seam exposes a single entry point:

```ts
emitSyncEphemeral(
    accountId: string,
    body: SyncEphemeralBody,           // the ~32-variant discriminated union
    options?: { skipSenderConnection?: ClientConnection },
): Promise<void>
```

The seam owns:

- **Recipient set**: `body.t` is mapped to `RecipientFilter` by an exhaustive switch private to the seam. Callers cannot override.
- **Wire payload assembly**: the 22 `build*Ephemeral` functions move into `syncEphemeral.ts` as private helpers (PR 1.5.e, mirroring PR 1.f); the 10 today-inline payload shapes are absorbed as direct cases in `buildPayload`.

The seam does **not** own:

- **Seq allocation** — ephemerals carry no seq (ADR-0013).
- **Update id generation** — clients do not dedup ephemerals.
- **`afterTx` coordination** — ephemerals are fire-and-forget and can ship before any surrounding transaction commits. Callers that want commit-ordered delivery already wrap their emit in `afterTx(tx, …)` themselves; the seam does not internalise that pattern for ephemerals because most ephemeral emits are not tx-adjacent.

`eventRouter` retreats further: after PR 1.5.e it owns only connection management, the `emit` multicast primitive, `recipientMatches`, and the orphan `buildRelationshipUpdatedEvent` (still without a production caller).

### Decision E1 — Separate file from `syncUpdate.ts`

`syncEphemeral.ts` is its own file rather than a section inside `syncUpdate.ts`. The two seams share a vocabulary (RecipientFilter union, transport call) but not their lifecycle invariants (SyncUpdate has seq + id + afterTx; SyncEphemeral has none of those). Merging would put the union of both rule sets behind one entry point and make "which invariants apply" depend on which variant the caller picked. Keeping them split lets each evolve independently: a future ADR can tighten SyncUpdate's tx policy without touching SyncEphemeral, and vice versa.

### Decision E2 — Inline body shapes absorbed directly into the discriminated union, no builder layer

The 10 today-inline payload shapes (`session-terminate`, `terminal-input`, `terminal-output`, `terminal-exit`, `task-log`, `webhook-trigger`, `webhook-issue-linked`, `webhook-pr-merged`, `supervisor-run-complete`, `supervisor-fix-kill-session`) become direct variants in `SyncEphemeralBody`. No new `buildXxxEphemeral` wrapper is introduced for them — those shapes are simple (2–3 fields each), and adding builder functions would be ceremony without leverage. The 22 existing `build*Ephemeral` functions move into `syncEphemeral.ts` as private helpers and are called by `buildPayload`'s switch for the variants that have meaningful payload transformation (avatar URL hydration, base64 encoding, Date.getTime() conversion, etc.); the 10 inline variants get tiny inline construction in the same switch.

### Decision E3 — `inter-agent-message` is split into `inter-agent-message-deliver` and `inter-agent-message-echo` at the **seam discriminator** level, with the **wire `type` field unchanged**

`interAgentMessageHandler.ts` emits the same payload twice: once with `recipientFilter: { type: "all-interested-in-session", sessionId: toSessionId }` (the receiving Session sees the message) and once with `recipientFilter: { type: "user-scoped-only" }` (the sender's own App dashboard shows the outbound message). This is genuine fan-out — two recipient sets, same payload.

Both wire emissions continue to carry `type: "inter-agent-message"` so connected clients see no event-type change. Internally the seam carries two `SyncEphemeralBody` variants — `inter-agent-message-deliver` and `inter-agent-message-echo` — that share the wire `type` but differ in `recipientFilterFor`'s output. The caller emits twice, once per variant, and the seam's `t → recipientFilter` function relation holds.

This is the SyncUpdate ADR's principle re-applied: *"if a future variant needs context-dependent routing, that is evidence the body type is under-discriminated — split it."* `inter-agent-message` was under-discriminated at the seam level; we discriminate inside the seam without breaking the wire.

## Migration

The migration is staged in three PRs after the seam stands up:

- **1.5.a** — stand up `syncEphemeral.ts` (this seam) + tests. No callers migrate.
- **1.5.b–d** — migrate the 78 emit sites by region (terminal/usage/activity ~10 → webhook/inbox/knowledge ~8 → task ~14 → supervisor ~16 → preview/session/interAgent ~10 → misc ~10), each PR independently shippable.
- **1.5.e** — seal `eventRouter.emitEphemeral` → `eventRouter._emitEphemeralInternal` + JSDoc `@internal` (mirroring PR 1.g). Updates the ~10 spec files' `vi.mock` stubs to the new name.
- **1.5.f** — physical move (the originally-deferred cleanup). The 21 active `build*Ephemeral` payload constructors move out of `eventRouter.ts` into `syncEphemeral.ts` as private `*Payload` helpers; `buildMachineStatusEphemeral` is deleted outright as dead code (no production caller). The 4 supervisor / autoloop Options interfaces (`SupervisorTriggerOptions`, `SupervisorLoopStatusOptions`, `SupervisorLoopBriefOptions`, `AutoLoopFiredOptions`) follow them in. `eventRouter.spec.ts` drops the now-dead unit tests for the moved builders (DEEPENING.md: "old unit tests on shallow modules become waste once tests at the deepened module's interface exist — delete them"); the 6 caller specs that asserted directly on `expect(buildXxxEphemeral).toHaveBeenCalledWith(…)` are reshaped to assert on the wire payload that reaches `_emitEphemeralInternal` instead (`expect(emitMock).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ type: "…", … }) }))`). One spec — `supervisorFixStatusHandler.spec.ts` — had a wire-shape drift bug masked by a wrong-shape builder stub (it asserted `type: "session-activity"` while the wire is `type: "activity"`, per the legacy CONTEXT.md ephemeral naming); the physical move surfaced and fixes this. After 1.5.f the only remaining `build*Ephemeral` export is `buildRelationshipUpdatedEvent`, which despite its name actually produces an `UpdatePayload`, is dead, and is left in place for a future hygiene PR alongside `buildMachineStatusEphemeral`'s sibling. The dead `socket.ts` direct-emit catch-up path that used `buildRpcReadyEphemeral` is rewritten inline (it deliberately bypasses the seam — it targets one specific socket, not the broadcast set the seam would cover, so it cannot route through `emitSyncEphemeral`).

The interAgentMessageHandler.ts migration in 1.5.d also splits the two existing emits into two `emitSyncEphemeral` calls with the new `-deliver` / `-echo` variants — the wire shape is unchanged.

## Considered alternatives

- **Generalise `syncUpdate.ts` to cover ephemerals (E1=B).** Rejected. The lifecycle invariants differ: SyncUpdate enforces seq monotonicity, id generation, optional tx coordination; SyncEphemeral has none. A single seam covering both would have to gate every invariant on the variant, defeating the simplicity gain. The two seams **share the transport adapter** (`eventRouter`) and the `RecipientFilter` union, which is enough cohesion; they do not share their own bodies of rules.
- **Promote the 10 inline payload shapes to dedicated `build*Ephemeral` functions (E2=A).** Rejected. Each inline shape is 2–3 fields with no derived transformation; a builder function around them is ceremony with no compile-time or runtime benefit. The discriminated-union case in `buildPayload` provides the same compile-time exhaustiveness check the builders would have.
- **Wire-level rename `inter-agent-message` → `inter-agent-message-deliver` / `inter-agent-message-echo` (E3=B).** Rejected. The wire is observable by App clients today; renaming would force a coordinated server+app release for what is internally a re-discrimination. Splitting only at the seam discriminator keeps the wire stable and contains the change to the server.
- **Accept the `inter-agent-message` fan-out as a per-call `recipientFilter` override on the seam.** Rejected for the same reason ADR-0023 rejected `recipientFilter` parameterisation on `emitSyncUpdate`: it reopens the silent-bug class the seam exists to close (a future caller picks the wrong filter; nothing catches it). The "two variants, same wire type" model preserves the function relation that makes the seam load-bearing.
- **Skip Phase 1.5 and leave ephemerals on the direct `eventRouter` path.** Rejected. ADR-0023 explicitly identified this as Phase 1.5; the same shape problem (78 sites manually re-deciding `body.type ↔ recipientFilter`, no compile-time check) exists for ephemerals. Leaving it means the SyncUpdate deepening lesson stops at the persistent half of the broadcast pipe.

## Consequences

- New contributors learn one persistent broadcast (SyncUpdate) and one ephemeral broadcast (SyncEphemeral), each with its own seam — a deliberately symmetric vocabulary that matches the ADR-0013 split.
- `eventRouter.emitEphemeral` is renamed to `_emitEphemeralInternal` after PR 1.5.e, sealing it like `_emitUpdateInternal` was sealed in PR 1.g.
- After Phase 1.5 completes, **all server→client broadcast** flows through one of two seams; the only escape hatch into `eventRouter._emit*` is reserved for the seams themselves. A grep for either `_emit*Internal\(` should match exactly one production caller each.
- ADR-0023's "Phase 1.5 — emitSyncEphemeral parallel" item is closed by this ADR.
- The orphan `buildRelationshipUpdatedEvent` in `eventRouter.ts` was deleted in PR 1.5.g hygiene cleanup alongside its spec; the wire `relationship-updated` type itself survives in `UpdateEvent` for backward compatibility with any client still listening for it.
- A future architecture review that proposes "merge `syncUpdate.ts` and `syncEphemeral.ts` into one seam" should read the E1 alternative above; the lifecycle-invariant split is the load-bearing reason for keeping them separate.

## Open subordinate questions

- **Scope Y (RecipientFilter taxonomy revisit).** Still deferred to a future ADR per ADR-0023, but now affects both seams.
- **Compile-time discrimination of the seam's `t` from the wire `type`.** Today `SyncUpdateBody`'s `t` and the wire `body.t` are identical strings; `SyncEphemeralBody`'s `t` diverges for `inter-agent-message-deliver` / `echo` (both wire-emit `type: "inter-agent-message"`). This asymmetry is mild but worth flagging — a future ADR may revisit whether other variants should also separate the seam-discriminator from the wire-discriminator.
- **`buildRelationshipUpdatedEvent` deletion** — closed by PR 1.5.g.
