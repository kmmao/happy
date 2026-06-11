---
status: accepted
---

# App-side SyncUpdate / SyncEphemeral ingest is one seam each; side effects fan out as typed events

CONTEXT.md's **SyncUpdate** and **SyncEphemeral** entries define the server→client broadcast wire. ADR-0023 collapsed all server-side SyncUpdate emission behind `emitSyncUpdate` (one seam); ADR-0024 did the symmetric thing for SyncEphemeral. The App side — the consumer of both — never had the symmetric move.

Today the App's `Sync.handleUpdate` (`packages/happy-app/sources/sync/sync.ts:2240–2351`) is a 100-line `if-else` chain over 15 `body.t` variants. Six variants delegate to handlers in `syncUpdateHandlers.ts` (75–263 lines each); three (`new-machine` 62 lines, `new-account`, `new-project` switch) are inlined directly in `sync.ts`; the rest are one-liners. Every handler takes the same 24-field `UpdateHandlerContext` (`syncUpdateHandlers.ts:59–89`) containing encryption, six `*.invalidate()` sync triggers (some also exposing `awaitQueue`), cursor registry, storage adapter, deleted-session set, message-processor maps, outbox queues, and the artifact-data-key map.

Inside the handlers, UI / feature side effects are interleaved with state mutation:

- `voiceHooks.onPermissionRequested(...)` and `notifyPermissionRequest(...)` fire when `update-session` detects a new agentState request.
- `notifyTaskComplete(...)`, `issueHandleCompletion(link)`, `dispatchTerminalSignal(sid, content)` (a 47-line OSC switch), `gitStatusSync(sid).invalidate()`, and `clearNotifiedRequests(sid)` are all called from inside `new-message` / `delete-session` / `update-session` handlers.
- `kv-batch-update` already returns `researchConfigChanges` that `sync.ts` then re-iterates against `researchConfigListeners` — this single variant already practices the "handler returns events; outer loop fans out" pattern; the rest of the surface does not.

This shape encodes four invariants whose ownership is currently spread across the 15-variant chain plus the 6 handler files:

1. **Exhaustive `body.t` dispatch**: today's `if-else` has no compile-time guarantee a new variant is handled. A missing case is a silent no-op.
2. **Encryption-scope readiness**: three handlers (`new-message`, `update-session`, `update-machine`) call `resolveSessionEncryption` / `resolveMachineEncryption` (`syncEncryptionScope.ts`), which already owns the startup-race + refetch-recovery invariant. `new-machine` cannot — it must register the data encryption key into the `Encryption` module *before* applying the machine, which is why its 62 lines are inlined in `sync.ts` rather than extracted.
3. **Storage mutation**: each handler reaches into `storage.getState().applyXxx()` directly. Zustand is the store of record; that's correct, but every handler chooses its own subset.
4. **Downstream side effects**: voice cues, web notifications, terminal-signal dispatch, issue-session bookkeeping, git-status invalidation, and six `*.invalidate()` sync triggers all fire inline from the handler bodies. There is no compile-time guarantee a given event type triggers all of its subscribers; the coupling is reviewer-memory.

Continuing to evolve this shape means every new `body.t` variant, every new feature that needs to react to a SyncUpdate, and every change to the 89-field context costs touches in 3+ files with no compile-time check that they agree.

## Decision

**One seam owns SyncUpdate ingest on the App side: `packages/happy-app/sources/sync/ingest/syncUpdateIngest.ts`**, mirroring the server's `syncUpdate.ts`. The seam exposes a single entry point:

```ts
ingestSyncUpdate(
    update: ApiUpdateContainer,
    ctx: IngestContext,
): Promise<IngestEvent[]>;
```

The seam owns:

- **Exhaustive `body.t` dispatch**: a private switch over the 15-variant discriminated union, with TypeScript exhaustiveness check (`assertNever`) — adding a variant fails to compile until handled.
- **Encryption-scope readiness**: `new-machine`'s pre-step (register the data encryption key before any decryption attempt) is absorbed as the standard pre-mutation step for any variant that brings new keying material. The existing `resolveSessionEncryption` / `resolveMachineEncryption` invariant survives as an internal seam used by the per-variant cases.
- **Storage mutation**: variants call `storage.getState().applyXxx()` directly. Zustand stays the store of record; the seam does not introduce a "mutation IR" layer (rejected as over-abstraction below).
- **Event production**: each variant returns zero or more `IngestEvent` values describing the high-level domain events the mutation produced (e.g. `permission-requested`, `task-completed`, `terminal-signal`, `sessions-stale`).

**A second seam owns SyncEphemeral ingest: `packages/happy-app/sources/sync/ingest/syncEphemeralIngest.ts`**, parallel to SyncUpdate ingest and symmetric to the server's `syncEphemeral.ts`. It has no storage mutations (ephemerals do not reconcile) and returns events only.

**Side effects are subscribers, not callees.** A module-level dispatcher `ingestEvents` (in `dispatcher.ts`) fans typed events to listeners. `voiceHooks`, `notifyTaskComplete`, `notifyPermissionRequest`, `dispatchTerminalSignal`, `issueHandleCompletion`, `disposeSessionScopedState`, `clearNotifiedRequests`, `removeWorktree`, and the six `*.invalidate()` calls (`sessionsSync`, `machinesSync`, `artifactsSync`, `feedSync`, `friendsSync`, `projectsSync`) all become typed subscribers registered once at `Sync` construction. The seam emits `IngestEvent[]`; the dispatcher routes by `event.kind`. New features add a subscriber, not a seam edit.

**`IngestContext` shrinks to a small grouped shape**: `encryption`, `cursor.{get,delete}`, and the seam's own race-recovery primitives `sessionsSync.{awaitQueue,forceRefetch}` / `machinesSync.{awaitQueue,forceRefetch}`. The race-recovery primitives stay on the context because they are the seam's internal mechanism — `syncEncryptionScope.ts` (an internal seam shared across variants that need decryption) calls `awaitQueue` to block on an in-flight sync, then `forceRefetch` as a fallback. The other ~19 fields that today live on `UpdateHandlerContext` (5 of the 6 `*.invalidate()` triggers, deleted-session set, message-processor maps, outbox queues, `enqueueMessages` / `applySessions` / `releaseMessageProcessing` adapters, the `~11` listener `Set<Listener>` collections that live on the `Sync` class itself, `assumeUsers`, `onSessionVisible`, etc.) become subscriber concerns — they are no longer threaded through every handler signature.

### Decision A — Hybrid side-effect placement (events, not pure subscription on storage diffs)

We rejected two extremes:

- **A1 — Side effects stay inline in the seam.** Handler still calls `voiceHooks.onPermissionRequested(...)` etc. directly. Reduces dispatch chain to one file but leaves the seam interface bound to voice + notification + issue-session modules; test surface still requires mocking them. Locality improves; depth does not — the seam is shallow because its interface includes "knows about voice + notifications".
- **A2 — Side effects derive from Zustand storage subscriptions.** No event stream; voiceHooks subscribes to `state.sessions[*].agentState.requests` changes and diffs old-vs-new to detect new permission requests. Pure deepening, but the *detection* logic that today lives in the handler (free — the handler made the delta) gets scattered across N subscribers (each re-diffs the snapshot). Worse locality. Also a structural misfit for events that are not state-shaped: `terminal-signal` is a side-band signal embedded in a message, `task-completed` is a one-shot event — neither sits naturally in a Zustand diff.

We chose the **Hybrid**: seam owns the dispatch + applies storage mutations + produces a typed `IngestEvent[]`. Subscribers consume by `event.kind`. The detection logic stays where the delta naturally exists (inside the seam); subscribers stay simple. This matches the existing `kv-batch-update` → `researchConfigChanges` → outer loop pattern already present in `sync.ts:2338–2343` — we extend that pattern to the rest of the surface.

### Decision B — Two parallel seams (SyncUpdateIngest and SyncEphemeralIngest), not one

We mirror ADR-0024 decision E1. Even though the App's lifecycle differences between Update and Ephemeral are smaller than the server's (no seq, no `afterTx`), SyncUpdate ingest may grow invariants the ephemeral path will never have (cursor advance on per-session seq, gap-fill detection, post-mutation event ordering). Merging would gate every invariant on the variant and defeat the simplicity. The two seams **share** the `IngestEvent` union and the dispatcher; they do not share their own bodies of rules.

### Decision C — Naming: `SyncUpdateIngest` / `SyncEphemeralIngest`

These mirror the server's `emitSyncUpdate` / `emitSyncEphemeral`. CONTEXT.md gains two entries. Rejected alternatives:

- **`SyncUpdateApply`** — strong on "we mutate storage" but weak on "we produce events". The seam does both.
- **`SyncUpdateReducer`** — collides with `reducer.ts` (which folds message streams, not SyncUpdates). Misleading.
- **`SyncUpdateProjection`** — borrowed from CQRS; semantically defensible but unfamiliar in this codebase.
- **`SyncUpdateHandler`** — too narrow; the seam isn't just handler dispatch, it's also encryption pre-step + event production.

### Decision D — `IngestEvent` is typed-domain, not generic-state-change

Two shapes were considered:

- **F1 — Typed domain events** (chosen): `{ kind: 'permission-requested', sid, session }`, `{ kind: 'task-completed', sid, preview }`, etc. The seam emits domain-level facts; subscribers opt in by `kind`.
- **F2 — Generic state-change events**: `{ kind: 'session-changed', sid, changes: [...] }`. Subscribers re-derive domain meaning (permission added? new tool call?) from the change set.

F2 scatters the detection logic across subscribers — exactly the problem the seam exists to concentrate. F1 keeps detection inside the seam (the handler knows what just happened; it's free information) and lets subscribers consume domain language. The `IngestEvent` union grows only when a new event has a subscriber; emitting an event with zero subscribers is wasted work and not done.

### Decision E — `ingestEvents` is a module-level singleton; `createIngestEventDispatcher()` is also exported

Test isolation matters but not enough to force every component to receive a dispatcher injection. The App runs one `Sync` instance per process; subscribers (voiceHooks, notification, issue-session, sync invalidators) are themselves module-level. The singleton matches the gravity. Tests that need isolation call `createIngestEventDispatcher()` and inject explicitly.

### Migration

The migration is staged across 7 PRs, each independently shippable with no observable behavior change:

- **PR 1** — Stand up `sources/sync/ingest/` (`types.ts`, `ingestContext.ts`, `dispatcher.ts`, stub `syncUpdateIngest.ts` and `syncEphemeralIngest.ts`). Tests for the dispatcher (`.on`, `.emit`, unsubscribe). No callers migrate.
- **PR 2** — Migrate `new-machine` first (the today-inlined 62 lines in `sync.ts:2263–2324`). Smallest blast radius; lets the encryption pre-step shape be validated on a single variant before generalizing. `sync.ts` keeps its `if-else` chain for the remaining 14 variants but the `new-machine` arm now routes through `ingestSyncUpdate`.
- **PR 3** — Migrate the one-liners and small handlers: `new-session`, `new-feed-post`, `relationship-updated`, `kv-batch-update`, `new-project` / `update-project` / `delete-project`. Each emits a `*-stale` or domain event; subscribers wire `*.invalidate()` and existing listener sets.
- **PR 4** — Migrate per-entity medium handlers: `delete-session` (75 L), `update-session` (123 L), `update-machine` (65 L), `new-artifact` / `update-artifact` / `delete-artifact` (75–90 L each), `update-account`. Each handler's side effects (voiceHooks, notifyXxx, disposeSessionScopedState, removeWorktree, etc.) become events; subscribers register.
- **PR 5** — Migrate `new-message` (the 263-line handler). Split: decrypt + normalize → emit `message-appended`, `mutable-tool-observed`, `terminal-signal`, `task-completed`, `permission-requested` (when applicable). The `dispatchTerminalSignal` 47-line switch moves to a `terminal-signal` subscriber. Git-status invalidation, web notifications, issue-session completion all become subscribers.
- **PR 6** — Mirror for SyncEphemeral. Stand up `ingestSyncEphemeral`; migrate the ~10 listener-Set patterns in `sync.ts` (taskLogListeners, taskStatusListeners, supervisorLoopStatusListeners, supervisorLoopBriefListeners, autoLoopFiredListeners, inboxNewItemListeners, inboxUnreadCountListeners, sessionEventCreatedListeners, interAgentMessageListeners, supervisorStatusListeners, researchConfigListeners) to subscribers.
- **PR 7** — Cleanup: delete `syncUpdateHandlers.ts` (now empty), delete `handleEphemeralUpdateAction` if absorbed, shrink `UpdateHandlerContext` to just `IngestContext`, delete legacy ctx fields from `Sync` class, document the seam in CONTEXT.md flagged ambiguities if any survive.

The migration introduces no behavioral change in production; reviewer attention is on event-shape correctness, not on visibility / dispatch regression. Each PR adds tests at the seam interface (`ingestSyncUpdate(body, ctx) → [events]` is table-drivable) and deletes the old per-handler tests that mocked side-effect modules (per DEEPENING.md: "old unit tests on shallow modules become waste once tests at the deepened module's interface exist — delete them").

## Considered alternatives

- **Inline subscribers (A1).** Rejected — the seam interface still binds to voiceHooks / notifications / issueSessionStore; test surface unchanged; depth shallow. Concentrates dispatch but does not deepen.
- **Pure Zustand-subscription side effects (A2).** Rejected — scatters delta detection across N subscribers; structurally misfits event-shaped signals (terminal-signal, task-completed); rebuilds for free in the seam the information that subscribers must then re-derive.
- **One merged ingest seam covering both Update and Ephemeral (B-merged).** Rejected — same reasoning as ADR-0024 E1. SyncUpdate ingest may grow per-seq invariants (cursor advance, gap fill); ephemeral path will never have them. Merging would gate every invariant on the variant.
- **Generic state-change events (F2).** Rejected — moves detection from the seam (where the delta is free) to subscribers (where it must be diffed); worse locality. The seam exists to concentrate exactly this kind of rule.
- **Per-entity ingest seams (`sessionIngest.ts`, `machineIngest.ts`, `artifactIngest.ts`).** Rejected for the same reason ADR-0023 rejected per-entity emit modules: the `body.t → mutation + events` rule is the unit of locality we are trying to concentrate; splitting by entity re-spreads exactly the rule we are collecting.
- **Dispatcher-as-injected-port (constructor injection on every component).** Rejected — the App has one Sync process; subscribers are themselves singletons (voiceHooks, notifications). DEEPENING.md two-adapter rule fails — there is no second production dispatcher. `createIngestEventDispatcher()` stays exported for test isolation; that is the only second adapter and it is structural, not parameterised.
- **Mutation IR ("`ingestSyncUpdate` returns `{ mutations, events }`; outer applies mutations").** Rejected — Zustand is the store of record; introducing an intermediate mutation representation that later gets applied adds a layer without benefit. The seam applies to storage directly; only events leave the seam.
- **Defer migration until happy-wire majors and renames `UpdatePayload` → `SyncUpdate`.** Rejected — the wire rename is independent and unlikely soon; this seam unblocks App-side maintainability today without waiting.

## Consequences

- New contributors learn one App-side concept for "App reacts to a server broadcast": **SyncUpdateIngest** / **SyncEphemeralIngest**, with a single seam each, mirroring the server's emit seams. CONTEXT.md defines both terms.
- Adding a `body.t` variant is: one case in the discriminated union + one case in the exhaustive switch + (if it has side effects) one new `IngestEvent` variant + one subscriber. Each step fail-closed by TypeScript exhaustiveness.
- The 24-field `UpdateHandlerContext` reduces to a small grouped `IngestContext` (encryption + cursor + sessions/machines race-recovery primitives). Every handler signature shrinks; tests no longer carry mock fields they do not use.
- `voiceHooks`, `notifyTaskComplete`, `notifyPermissionRequest`, `dispatchTerminalSignal`, `issueHandleCompletion`, the 6 `*.invalidate()` triggers, and the 11+ `*Listeners` sets all become typed subscribers visible at one place (`Sync` constructor). A grep for `ingestEvents.on(` lists every App-side reaction to a server broadcast.
- `syncUpdateHandlers.ts` is deleted at PR 7. `sync.ts:2240–2351`'s 100-line `if-else` and its 62-line inline `new-machine` block collapse to a 5-line `handleUpdate`.
- `syncEncryptionScope.ts` survives as an internal seam of `ingestSyncUpdate` — `resolveSessionEncryption` / `resolveMachineEncryption` are called from inside per-variant cases; their startup-race + refetch invariant is unchanged.
- App-side `apiTypes.ts` continues to own the `body.t` discriminator union. A future wire major (CONTEXT.md flagged ambiguity: `UpdatePayload` → `SyncUpdate` rename) will align naming; this ADR does not depend on that.
- A future architecture review that proposes "let subscribers call back into the seam to drive mutations", "merge the two ingest seams", or "let handlers reach into voiceHooks directly because it's simpler" should read this ADR first — all three are intentional non-choices.

## Open subordinate questions

- **Subscriber error policy.** If `voiceHooks.onPermissionRequested` throws inside an event listener, today the seam swallows it (events are fan-out). Should the dispatcher catch + log per subscriber, or fail the whole batch? This ADR picks catch + log per subscriber implicitly; a future ADR may tighten if a subscriber's failure should block downstream consumers.
- **Event ordering across subscribers.** Today subscribers fire in registration order. If a subscriber depends on an earlier subscriber's side effect (e.g. terminal-signal storing the title before notification reads it), ordering matters. We bet on no such cross-subscriber dependencies in the current event set; if one emerges, the dispatcher can grow a `priority` or replace registration-order with explicit dependency.
- **SyncUpdate dedup-by-id.** Today `sync.ts` dedups by `update.id`; this should move into `ingestSyncUpdate` as a pre-step. PR 4 absorbs it.
- **Cursor advancement seam.** `SessionMessageCursor` owns per-session seq + dedup independently today. After PR 5, `new-message` ingest will call into the cursor explicitly; the cursor itself stays an internal seam (it is already deep).
