---
status: accepted
---

# ACP's Turn lifecycle stays local; only Claude and Codex share the Turn reducer

The session-protocol producers (Claude JSONL, Codex MCP, ACP) each used to hand-roll the same Turn + Subagent lifecycle: opening a Turn, emitting a Subagent's `start` exactly once, stamping turn/subagent on every envelope, and closing the Turn. We distilled that into one deep module — `packages/happy-cli/src/session-protocol/turnReducer.ts`, a pure reducer `(state, intent, clock) -> {state, envelopes}` (see CONTEXT.md: **Turn**, **Subagent**) — and migrated the **Claude** and **Codex** mappers onto it. We deliberately did **not** migrate the **ACP** producer (`agent/acp/AcpSessionManager.ts`).

ACP is a genuinely different shape, not a third instance of the same one:

- **It has no Subagents.** The seam the reducer concentrates — Subagent `start`/`stop` dedup plus auto-stop-on-turn-end — does not exist for ACP. Two adapters (Claude, Codex) make that a real seam; ACP would be a third adapter that uses none of it.
- **Its Turn boundaries are explicit and externally driven.** `startTurn()`/`endTurn()` are called by the ACP driver, are idempotent, and emit turn-start/turn-end directly. There is nothing to infer and therefore nothing to share.
- **It owns ACP-specific stream glue** — pending model-output/thinking text accumulated and flushed on a type change or on `endTurn()`, including a flush that fires even with no active Turn. That logic has no analogue in Claude/Codex.

Forcing ACP onto the reducer would union three divergent views behind one interface for ~zero shared behavior — the same shallow over-abstraction ADR-0001 (spawnsession) and ADR-0004 (encryption scope) warn against. The deletion test agrees: ACP's `startTurn`/`endTurn` cannot be deleted in favor of the reducer (the driver still needs explicit, idempotent boundaries), and routing ACP through it would only add impedance-matching glue.

## Turn opening: lazy vs. explicit

Claude infers Turn boundaries from its JSONL content, so the reducer lazily opens a Turn on the first `content` intent. Codex and ACP have explicit provider turn-start signals. The reducer supports both rather than picking one:

- an idempotent `turnBegin` intent for explicit producers (Codex `task_started`), and
- a per-`content` `openTurn: false` opt-out so Codex content arriving outside a Turn (e.g. early app-server notifications) stays Turn-less instead of forcing a Turn open.

This is why the reducer is intentionally not "lazy-open only."

## Considered alternatives

- **Migrate all three producers onto the reducer.** Rejected: ACP would need its public `startTurn`/`endTurn` contract rewritten and its ~30 lifecycle tests changed, plus a Turn-start timing change, all for a producer with no Subagents. High churn, contradicts ADR-0001.
- **Migrate only Claude.** Rejected: the Subagent lifecycle is shared by Claude *and* Codex; capturing only one leaves the seam at a single adapter (hypothetical, not real).

## Consequences

- The Turn/Subagent ordering invariants — turn-start before content, `start` once before `stop`, turn-end auto-stops every still-active Subagent, no dangling open Turn — live in one place with property tests, instead of being re-derived in each mapper.
- ACP's lifecycle stays in `AcpSessionManager` with its own tests. A future architecture review that proposes "migrate ACP onto the Turn reducer too" should read this first — the non-migration is intentional, not an oversight.
- If ACP ever gains Subagents or loses its explicit, externally-driven Turn boundaries, revisit this: the shared seam would then actually fit.
