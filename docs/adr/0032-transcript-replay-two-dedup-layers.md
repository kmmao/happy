---
status: accepted
---

# 0032 — Transcript replay uses two dedup layers: per-(Session, localId) for idempotent envelopes, per-process record-key set for UUID-stability defense

When the Account triggers Resume from the App, the daemon spawns a fresh Happy Session and the CLI's `replayClaudeTranscriptToHappySession` walks the source Claude session's on-disk JSONL and re-emits each record as SessionEnvelopes into the new Session (see CONTEXT.md "Session" / Flagged ambiguities). The replay must be idempotent across CLI restarts AND robust against a Claude Code behavior we don't have a written contract on.

Two distinct invariants are at stake, so two distinct dedup keys back them:

- **`(Session.id, localId)` — server-side, persistent.** Replay derives each envelope's localId from `sha256("claude-replay:<sourceClaudeSessionId>:<messageKey(record)>:<envelopeIndex>")`. Server `v3SessionRoutes.ts` de-dupes by `(sessionId, localId)`. A replay re-run after a CLI crash produces the same key set; conflicting rows are dropped before INSERT. This is the only key the server sees.
- **`messageKey(record)` — per-process, in-memory.** The same Happy CLI process later starts a JSONL scanner against Claude's resume-rewritten session file. `sessionScanner.ts` dedupes its forwards by `messageKey(message)`, which for `user` / `assistant` / `system` records is `message.uuid`. **Claude Code does not document whether `--resume` preserves message UUIDs into the new session file.** If a future Claude version rewrites them, the scanner's dedup misses → it forwards historical records under fresh random `localId`s → server has nothing to dedup against → the entire chat history shows twice.

The replay path therefore also calls `ApiSessionClient.markClaudeMessageReplayed(messageKey(record))`; subsequent `sendClaudeSessionMessage` calls (typically the scanner) compute the same key on entry and early-return when it is in the set.

## Decision

Replay carries both layers. Specifically:

1. `sendClaudeSessionMessage` / `closeClaudeSessionTurn` accept a `replay: true` option that routes envelopes through localId-deduped channels only — the socket-emit `usage-report` (sendUsageData) and `usage-report` cost (sendTurnCostReport) paths are skipped because they have no localId and would double-attribute historical tokens / cost to the new Happy Session.
2. Replay records each `messageKey(record)` on the `ApiSessionClient` via `markClaudeMessageReplayed`; `sendClaudeSessionMessage` early-returns on a recorded key regardless of caller.

## Considered alternatives

- **A — single layer, push everything through `localId` only.** Reject. The scanner uses `randomUUID()` localIds for its forwards (`enqueueMessage` line in `apiSession.ts`); without an additional content-derived key, the server cannot tell the scanner's forward of an already-replayed record from a genuinely new one. To make this work we would have to either (a) make the scanner compute deterministic localIds too — which means baking the replay key scheme into a non-replay code path and conflating two distinct concepts (envelope idempotency vs. record-source identity), or (b) trust Claude UUID stability with no fallback. Either way the second layer is doing real work; collapsing it loses an invariant.
- **B — single layer, drop the localId determinism and dedup by record content hash server-side.** Reject. This pushes a Claude-specific dedup rule into the generic server message store. The `v3SessionRoutes` schema is provider-agnostic; adding a content-hash column for replay would make replay a special case in storage. The current design keeps replay invisible to the server.
- **C — drop the defensive layer entirely; trust Claude preserves message UUIDs across `--resume`.** Reject with the most weight: this is the natural default, and Claude probably does preserve UUIDs (CLAUDE.md notes only `sessionId` is rewritten). But the failure mode if we're wrong is "every Resume duplicates the entire chat", and there is no graceful degradation — the chat just shows two copies of itself. The cost of the defensive layer is one `Set<string>` per `ApiSessionClient` and one hash lookup per `sendClaudeSessionMessage` call; trivial against the failure cost.
- **D — pull dedup further upstream, into the JSONL reader.** Reject. The reader is shared by scanner and replay; baking replay state into it couples two code paths that should stay independent.

## Consequences

- Replay is idempotent across CLI restarts (gated by `Session.seq === 0` at start — see `runClaude.ts` comment).
- A future Claude Code release that changes resume-time UUID behavior cannot duplicate Resume sessions.
- New `sendClaudeSessionMessage` callers automatically inherit the dedup — the early-return runs before any side effect. Callers do NOT need to know replay exists.
- ~O(N) memory per replayed session in the CLI process, freed when the `ApiSessionClient` is closed. No persistence.
- A new socket-emit channel that is meaningful during replay (counter to current `usage-report`-only assumption) would need to be re-evaluated against the `replay: true` flag — the flag is currently a Boolean rather than a per-channel mask because the only two channels that needed gating happened to be both non-deduped.

## Open subordinate questions

- **Does the scanner's `processedMessageKeys` need the same priming?** Currently it does not — scanner is created later and pre-marks the OLD source-session JSONL at init (`sessionScanner.ts` `treatExistingAsProcessed` path is for a different case). If a regression appears where the scanner re-emits replayed content despite the client-side dedup, priming the scanner directly would be the next move; this is documented but not currently needed.
- **`Session.seq === 0` gate.** Today the only "should we replay?" signal is the per-Session SessionMessage counter (the `Session.seq` column, NOT the SyncUpdate seq or Account seq). A future replay caller that runs against a non-empty Session (e.g. mid-session re-attach) would need a different gate, not a generalised one — the determinism guarantees only hold for the empty-Session case.
