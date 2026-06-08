---
status: accepted
---

# Server-side SyncUpdate emission is one seam; the recipient set is a function of `body.t`, not a per-call parameter

A **SyncUpdate** (CONTEXT.md) is a typed, seq-ordered server→client broadcast that delivers a change to a domain entity (Session, Machine, Account, Project, Artifact, Feed entry, KV) to the Account-owned connections that need to know. Today every server-side mutation that needs to broadcast one performs the same 4-line dance:

```ts
const updSeq = await allocateUserSeq(uid);
const payload = buildXxxUpdate(args, updSeq, randomKeyNaked(12));
eventRouter.emitUpdate({
    userId: uid,
    payload,
    recipientFilter: { type: /* the right one — picked from a 4-variant union */ },
});
```

This dance encodes four invariants whose ownership is currently spread across ~30 emit sites in ~20 files:

1. **Seq**: every SyncUpdate carries a per-Account monotonic seq (ADR-0012). Today every call site re-runs `allocateUserSeq(uid)` and assumes nothing else races between allocation and emission.
2. **Update id**: `randomKeyNaked(12)` for client-side dedup. Length/charset is convention only.
3. **Recipient set**: `body.t` determines which connections receive the SyncUpdate — `update-machine` must reach the named Machine's Daemon; `update-session` must reach all session-scoped subscribers on that Session; `update-account` must reach only the App. The mapping today lives in reviewer memory: each call site picks a `recipientFilter` variant per body type, and there is no compile-time guarantee the choice is correct.
4. **Transactionality**: when the SyncUpdate accompanies a multi-step `inTx`, it must be wrapped in `afterTx(tx, …)` so emission only happens after commit. Single-row writes today emit directly after `await db.x.update(…)`, without an enclosing transaction — relying on the next line not throwing.

We surveyed all 30 emit-Update sites and found that **`body.t` → `recipientFilter` is in fact a pure function** today (verified by enumeration; no exception). The current parameterisation is therefore a redundant degree of freedom whose only realised use is to encode the function-table answer at the call site.

## Decision

**One seam owns SyncUpdate emission on the server side: `sources/app/events/syncUpdate.ts`.** The seam exposes a single entry point:

```ts
emitSyncUpdate(
    accountId: string,
    body: SyncUpdateBody,           // the 15-variant discriminated union
    options?: {
        tx?: Prisma.TransactionClient;
        skipSenderConnection?: ClientConnection;
    },
): Promise<void>
```

The seam hides — and owns — all four invariants:

- **Seq**: `allocateUserSeq(accountId)` is called inside the seam; callers never touch it.
- **Update id**: `randomKeyNaked(12)` is called inside the seam.
- **Recipient set**: `body.t` is mapped to `RecipientFilter` by an exhaustive switch private to the seam. Callers cannot override.
- **Transactionality**: when `options.tx` is provided, emission is wrapped in `afterTx(options.tx, …)`; when absent, emission fires immediately after the await. Both modes are explicit at the call site (passing `tx` or not), without the caller writing `afterTx` themselves.

`eventRouter` retreats to its true responsibility — connection management plus the `emit` multicast primitive plus `recipientMatches` routing — and stops exporting `emitUpdate` and the 15 `build*Update` payload constructors. The constructors move (physically, in PR 1.f) into `syncUpdate.ts` as private helpers.

### `RecipientFilter` is not a caller-facing knob

Phase 1 forbids overriding the recipient set per call. The empirical justification is the survey above (every body type today maps to exactly one filter variant). The structural justification: if a future SyncUpdate type genuinely needs context-dependent routing, that is evidence the body type is **under-discriminated** — split it into two `body.t` values and the function relation holds again. Adding a per-call override would re-open the same silent-bug class (a caller picks the wrong filter; nothing catches it) that the seam exists to close.

### `tx` is optional, not required (Q3=A); Q3=B left as a future tightening

The seam accepts `tx?` as an optional field rather than requiring callers to provide either a `TransactionClient` or an explicit `NO_TRANSACTION` token. This keeps the 12 today-non-transactional emit sites (e.g. `usernameUpdate`'s single-row update + emit) migratable without simultaneously forcing them into `inTx` wrappers. The lifecycle invariant *"emit only after the DB write commits"* therefore continues to depend on **call-site discipline** in the no-`tx` mode: callers must `await db.x.update(…)` before calling `emitSyncUpdate(…)`, just as they do today.

A future ADR may tighten this to **Q3=B (tx required)** once all 12 non-transactional emit sites have been lifted into `inTx` wrappers as part of normal hygiene work. That tightening would make "emit must follow a committed DB write" a compile-time invariant rather than a discipline one. Out of scope for Phase 1.

### Scope: Update only; Ephemeral parallel deferred to Phase 1.5

`emitEphemeral` (per ADR-0013, short-lived broadcasts with no seq and no reconciliation) shows the exact same shape problem: each call site chooses `body.t` and `recipientFilter` independently, with no compile-time guarantee they agree. We deliberately do **not** generalise `emitSyncUpdate` to cover ephemerals in Phase 1: their lifecycle differs (no seq, no afterTx, no client reconciliation), and bundling them would weaken the seam's invariants. A parallel **Phase 1.5** will introduce `emitSyncEphemeral` (or equivalent) with its own derived recipient mapping; the shape is expected to be a near-mirror but it is not assumed to be identical.

### `RecipientFilter` union stays unchanged in Phase 1 (Scope X over Scope Y)

The current four-variant `RecipientFilter` union (`user-scoped-only` | `all-interested-in-session` | `machine-scoped-only` | `all-user-authenticated-connections`) survives. A subsequent **Scope Y** review may revisit the taxonomy — for example, splitting "recipient set" (a function of `body.t`) from "echo policy" (today entangled in the variant naming, where `machine-scoped-only` in fact *also* sends to user-scoped). Scope Y is deferred until Phase 1 has been in production long enough to confirm no hidden per-call override case appears.

## Migration

The migration is staged across PRs 1.a–1.g, each independently shippable with **no observable behaviour change**:

- **1.a** — stand up `syncUpdate.ts` (this seam). No callers migrate.
- **1.b–1.e** — migrate the ~30 emit-Update call sites by body type, in low-risk-first order (account → machine → new/delete/kv/feed/artifact/project → session+message). Each PR is mechanical: replace the 4-line dance with a single `await emitSyncUpdate(…)` call.
- **1.f** — physically move the 15 `build*Update` payload constructors from `eventRouter.ts` into `syncUpdate.ts` as private helpers; update the ~30 spec files' `vi.mock(…)` paths.
- **1.g** — rename `eventRouter.emitUpdate` to `eventRouter._emitUpdateInternal` and mark it `@internal` in JSDoc, signalling that the only legitimate caller is `syncUpdate.ts`. (The original plan called for an ESLint rule; happy-server has no ESLint configuration today, so a naming-convention seal was chosen over introducing a new dev toolchain for a single rule. Spec files continue to stub the method by its new name through `vi.mock`. If ESLint ever lands on this package, a `no-restricted-syntax` rule against `eventRouter._emitUpdateInternal\(` outside `syncUpdate.ts` would mechanise this further.) After 1.g, the seam is **named-as-private**, not just available — a future grep for `_emitUpdateInternal` should match exactly one production caller.

The survey found **no behavioural drift** in the existing emission table — every body type today maps consistently to one filter. The migration therefore introduces no broadcast-scope change in production; reviewer attention is on call-shape correctness, not on visibility regression.

## Considered alternatives

- **Parameterised `recipientFilter` override on `emitSyncUpdate`.** Rejected. The survey verified `body.t → recipientFilter` is a function with no exceptions. Adding the parameter would preserve a degree of freedom whose only used value is "the function-table answer" — reopening the silent-bug class (wrong filter at a call site, nothing catches it) the seam exists to close. If a future SyncUpdate variant needs different routing in different contexts, the resolution is to split the `body.t` discriminator, not to reintroduce the override.
- **Ports-and-adapters with injected `EventEmitterAdapter` / `SeqAllocatorAdapter` / `IdGeneratorAdapter`.** Rejected for Phase 1. Per DEEPENING.md's two-adapter rule, the existing `vi.mock` pattern (production = Socket.IO multicast; test = `vi.fn`) *is* a 2-adapter implementation — it's structural injection rather than parameter injection. The ~30 spec files currently use `vi.mock("@/app/events/eventRouter", …)` successfully; switching to constructor-style port injection would re-paper every spec file's setup without changing what is testable. Switching reads as architecturally cleaner but exchanges no leverage for measurable migration cost. Revisit only if a non-test second adapter appears (e.g. a write-ahead audit log subscriber that observes every SyncUpdate before it ships).
- **Plugin registry / `SyncUpdateHook` observers / declaration-merging extension points.** Rejected. Each is a 1-adapter (hypothetical) seam today: there is no second consumer for any of them. DEEPENING.md: *"One adapter means a hypothetical seam. Two adapters means a real one."* If a real second observer appears (replay buffer for offline reconciliation, audit log for compliance, metrics tap), introduce the extension point at that time — the seam shape above admits any of them without breaking callers.
- **Per-entity emit modules: `app/session/sessionEmit.ts`, `app/social/accountEmit.ts`, `app/api/machine/machineEmit.ts` …** Rejected. The `body.t → recipientFilter` mapping is the unit of locality we are trying to concentrate; splitting it across entity-themed modules re-spreads exactly the rule we are collecting. Action files keep their entity-themed folders; only the SyncUpdate-emission concern lifts out.
- **Grow `eventRouter` itself with `emitSessionUpdate` / `emitAccountUpdate` / … domain methods.** Rejected. `eventRouter.ts` is already ~1500 lines mixing connection management, multicast routing, type definitions, and 38 payload constructors — already wide. Adding the SyncUpdate-lifecycle concerns would push it past coherent module size. Splitting into `syncUpdate.ts` (lifecycle owner) + `eventRouter.ts` (transport primitive) restores both modules to a single axis of change.
- **Generalise the seam to cover `emitEphemeral` in Phase 1.** Rejected. Ephemerals have a different lifecycle (no seq, no afterTx, fire-and-forget; ADR-0013); bundling them dilutes the SyncUpdate invariants the seam exists to enforce. A parallel `emitSyncEphemeral` arrives in Phase 1.5 with its own derived recipient mapping.
- **Tighten to `tx`-required immediately (Q3=B in Phase 1).** Rejected. The 12 today-non-transactional emit sites are correct as written (single-row write + emit), and lifting them into `inTx` wrappers as part of this migration would commingle two changes (deepening the seam and tightening the transactional model) in a single PR. The seam admits either policy; tightening can ship as an isolated future ADR once those 12 sites are in `inTx` for other reasons.

## Consequences

- New contributors learn one server-side concept for "server tells its clients something happened": **SyncUpdate**, with a single seam. CONTEXT.md already defines the term.
- The `body.t → recipientFilter` mapping is a single switch private to `syncUpdate.ts`. Adding a new variant is one case in the type union plus one case in the switch — both fail-closed (TypeScript's exhaustiveness check catches a missing case at compile time).
- `eventRouter` shrinks to transport: connection management, the `emit` multicast primitive, and `recipientMatches`. The `RecipientFilter` union remains exported from `eventRouter.ts` because Phase 1 leaves the variant set unchanged.
- The 12 today-non-transactional emit sites continue to work unchanged in shape; they just call `emitSyncUpdate(uid, body)` instead of the 4-line dance. A future ADR may move them inside `inTx` wrappers and tighten `tx` to required.
- A future architecture review that proposes "let callers override `recipientFilter` for special cases" or "inject the eventRouter as a port for testability" should read this ADR first — both are intentional non-choices, not oversights.
- ADR-0012 (single-per-account-monotonic-seq) and ADR-0017 (per-scope DEK wrapped with NaCl box) continue to apply unchanged; the seam routes through `allocateUserSeq` and inherits the per-Account scope. The seam does not perform encryption — payload bodies arrive at the seam either as plaintext (e.g. `username`) or as already-encrypted opaque bytes (e.g. `session.metadata`), and the wire emission preserves that encoding.
- App-side `syncUpdateHandlers.ts` continues to consume `UpdatePayload`-shaped messages over Socket.IO; the wire shape does not change in Phase 1. CONTEXT.md's flagged ambiguity ("`SyncUpdate` is the domain term; the wire-level type is still named `UpdatePayload`") survives until a future major bump of `@kmmao/happy-wire`.

## Open subordinate questions

- **`emitSyncEphemeral` parallel.** Phase 1.5 introduces the ephemeral mirror. Its `body.t → recipientFilter` table may or may not be a clean function (we have not surveyed); the same deepening pattern may need a different shape if ephemeral broadcasting picks recipients dynamically (e.g. presence ephemerals routed to followers).
- **Scope Y `RecipientFilter` taxonomy.** Splitting "recipient set" from "echo policy" inside the union, plus renaming variants whose current names mislead (`machine-scoped-only` includes user-scoped connections in practice). Out of scope until Phase 1 has burned in.
- **Tightening to `tx`-required.** Whether the 12 non-transactional emit sites should be lifted into `inTx` for transactional safety, and whether the seam should then require `tx`. Independent ADR if and when those sites are touched for other reasons.
- **Audit/replay observers.** If a real second consumer for the SyncUpdate stream appears (offline reconciliation buffer, audit log, metrics tap), the seam grows a hook at that time — but not as speculative scaffolding before the second consumer exists.
