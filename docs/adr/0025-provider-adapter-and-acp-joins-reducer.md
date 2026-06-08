---
status: accepted
---

# Every Provider integrates through a unified ProviderAdapter; ACP joins the Turn lifecycle reducer

CONTEXT.md's **Turn** entry claims:

> The CLI assembles Turns from the underlying provider's stream (Claude JSONL, Codex, ACP) through a single Turn lifecycle reducer rather than per-provider hand-rolled state.

Auditing the code surfaced a partial truth and one real drift:

- **`session-protocol/turnReducer.ts`** (235 lines, pure + injected clock) genuinely owns the Turn / Subagent lifecycle invariants — lazy turn-open, exactly-once Subagent `start` per Turn, auto-stop of dangling Subagents on `turn-end`. There is no shadow lifecycle living elsewhere.
- The **Claude mapper** (`claude/utils/sessionProtocolMapper.ts:432-456`) and the **Codex mapper** (`codex/utils/sessionProtocolMapper.ts:374-391`) both wrap `reduce()` correctly — but with **different wrapping shapes**: Claude's `applyIntent(state, intent, envelopes)` mutates a `ClaudeSessionProtocolState` in place; Codex's `apply` is a closure over a local `let protocol` that is synchronised back into a `CodexTurnState` at the end. The wrap is essentially the same shape (lift the three `ProtocolState` fields, call `reduce`, write them back), but expressed twice with subtly different invariants about who owns mutation and how envelopes are accumulated.
- The **ACP path** (`agent/acp/AcpSessionManager.ts`) does **not** call `reduce()` at all. `startTurn()` and `endTurn(status)` hand-roll the lifecycle — they create envelopes directly via `createEnvelope` + `turnOptions`. ACP today has no Subagent concept, so the absence of auto-stop is dormant; but the *invariant promise* CONTEXT.md makes about ACP is, today, a paper promise — there is no code path that enforces it.

The ACP gap is the load-bearing problem. It means a future ACP feature that introduces Subagents would either re-discover the auto-stop logic in a third place, or ship a silent leak.

## Decision

**Every Provider integrates with `turnReducer` through a single shape: a `ProviderAdapter` type contract + a single `applyToProvider` helper.** Both live alongside the reducer in `src/session-protocol/`.

```ts
type ProviderAdapter<T> = {
    liftProtocol(state: T): ProtocolState;
    writeProtocol(state: T, next: ProtocolState): T;
};

function applyToProvider<T>(
    adapter: ProviderAdapter<T>,
    state: T,
    intent: ProtocolIntent,
    clock?: ProtocolClock,
): { state: T; envelopes: SessionEnvelope[] };
```

Each Provider declares one `const XXX_ADAPTER: ProviderAdapter<TheirState> = { liftProtocol, writeProtocol }` and replaces its bespoke wrap with `applyToProvider(XXX_ADAPTER, state, intent, clock?)`. The reducer continues to own — and continues to be the only place that owns — Turn / Subagent ordering invariants.

**The Claude mapper is refactored from imperative-mutating to functional-snapshot** so all three Providers share a single wrap shape. The external public surface of `runMapper` / `mapMessage` is unchanged; only the internal `applyIntent` / `apply` is replaced.

**ACP joins the reducer.** `AcpSessionManager` keeps its class shape and its external API (`startTurn` / `endTurn` / `mapMessage`), but internally:

- carries `startedSubagents` / `activeSubagents` as ReadonlySet fields (always empty today; reserved for the eventual Subagent concept)
- defines `ACP_ADAPTER: ProviderAdapter<AcpInternalState>` for the three reducer fields
- `startTurn()` is now `applyToProvider(ACP_ADAPTER, state, { kind: "turnBegin" }, acpClock)`
- `endTurn(status)` is now `applyToProvider(ACP_ADAPTER, state, { kind: "turnEnd", status }, acpClock)` (the pre-flush stays as a separate flush call before applying the intent)
- `mapMessage`'s text / tool-call paths route through `applyToProvider(... { kind: "content", ev, … })` for the envelopes the reducer would stamp anyway

**ACP injects its own monotonic clock.** The existing `nextTime()` (`max(lastTime + 1, Date.now())`) and `createId()` from `@paralleldrive/cuid2` are wrapped into a `ProtocolClock` and threaded into `applyToProvider`. The reducer's default `realClock` is untouched; Claude and Codex continue to use it. The CLI does not pretend to give ACP wall-clock time; ACP keeps the monotonic semantic it chose for envelope ordering.

**An adapter-contract invariant test is added** (`session-protocol/providerAdapter.test.ts`). It is parameterised over all three adapters and asserts the load-bearing invariants — `turnEnd` emits `stop` for every Subagent in `activeSubagents` before `turn-end`; consecutive `content` intents on a closed Turn lazily open exactly one new Turn (where the Adapter's Provider permits lazy open); a `subagentStop` for an unknown Subagent is a no-op. The existing per-Provider mapper tests stay as they are — they test the **signal extraction**, which is genuinely Provider-specific. The new test covers the **lifecycle invariants**, which are not.

## Considered alternatives

- **Per-Provider hand-rolled lifecycle (status quo for ACP).** Rejected — that is exactly the drift this ADR fixes. CONTEXT.md's Turn entry promises a single reducer; allowing one Provider to opt out makes the promise vacuous.
- **Class-based `ProviderProtocolAdapter` base.** Rejected — happy-cli CLAUDE.md says "prefer better design over control flow changes" and avoid trivial getter/setter functions. A class hierarchy here adds inheritance ceremony for no observable benefit: the contract is two pure functions; expressing it as a type alias is shorter, easier to test in isolation, and easier to extend if a future Provider needs a third lift/write field.
- **Keep Claude's imperative `applyIntent` and only refactor Codex / add for ACP.** Rejected — leaves drift inside the very seam this ADR is collapsing. With three Providers about to share one helper, having one of them mutate while the others return new state is exactly the inconsistency that makes future contributors hesitate to add a fourth.
- **Move the monotonic clock into the reducer.** Rejected. The reducer's clock is `now() + newId()`; ACP's monotonic logic is `max(lastTime + 1, Date.now())`, which carries provider-specific state (`lastTime`). Pushing it into the reducer would force Claude and Codex to either share state with ACP or carry a dead `lastTime` field they do not need. The reducer's clock-injection seam already exists exactly to allow per-Provider clocks; the right move is to use that seam from ACP, not to widen the reducer.
- **Skip ACP integration; only extract `ProviderAdapter` for Claude+Codex.** Rejected — the whole point is the ACP drift. The adapter would still be useful but the load-bearing fix would be deferred, and ADR-0014's claim that we adopt ACP's lifecycle / content separation would still be a paper claim on the wire side too.
- **Drop ACP entirely from CONTEXT.md's Turn entry; declare reducer is for Claude+Codex only.** Rejected on a separate axis — ACP IS shipping. Choosing to document around the gap rather than fix it leaves a worse codebase. The fix is cheap (single mapper class refactor); the documentation walk-back is permanent.

## Consequences

- The orphan question "how does a fourth Provider plug in" has a one-line answer: implement `ProviderAdapter<YourState>` plus your signal extraction. A reviewer asking "did you call the reducer in the right places?" looks at one `applyToProvider` call site instead of three different wrap shapes.
- Subagent auto-stop now protects ACP. Today ACP has no Subagent concept, so the protection is dormant. When the eventual ACP Subagent ships, the dangling-Subagent bug class is closed before the first line of feature code lands.
- ACP keeps its monotonic timestamp semantic. Existing ACP envelopes' `time` ordering is unchanged.
- ACP's external API (`startTurn`, `endTurn`, `mapMessage`) is unchanged; `runAcp.ts` does not move.
- Claude's external `runMapper` surface is unchanged; the internal shape of `applyIntent` is gone, replaced by `applyToProvider(CLAUDE_ADAPTER, state, intent)`. State is no longer mutated in place; `runMapper` threads the state through (the change is local to one file).
- The wrapping pattern is now testable as a contract: one test exercises the invariants across all three adapters, rather than each Provider's tests re-establishing the same ones differently.
- A future architecture review that proposes "fold all Providers into one big switch in `turnReducer`" or "give each Provider its own reducer copy because ACP is special" should read this ADR first — both are intentional non-choices.

## Open subordinate questions

- **ACP Subagent.** ACP today has no Subagent concept (the protocol does not currently expose nested-agent activity to the CLI). When it does, the Adapter is in place, but provider-specific resolution (mapping ACP's nested-agent identifier to a session Subagent id) will need its own logic, just as Claude's sidechain-UUID and Codex's `parent_call_id` resolution do. Out of scope for this ADR.
- **Removing `applyIntent`'s envelope-array side-channel from Claude.** Today Claude's `applyIntent` writes to an `envelopes: SessionEnvelope[]` array passed by the caller. After `applyToProvider`, returning `{ state, envelopes }` is the right shape — but Claude's outer `runMapper` accumulates a flat `SessionEnvelope[]` that is built by many call sites. The minimum migration replaces the call site only; a future cleanup PR can return-thread the envelopes through `runMapper` rather than mutating a shared array.
- **Naming `ProviderAdapter` vs `SessionStreamAdapter`.** `ProviderAdapter` is shorter and reads symmetrically with the `Provider` term added to CONTEXT.md. The name is bound by this ADR; rejection of `SessionStreamAdapter` is recorded so future renames see the load-bearing reason.
