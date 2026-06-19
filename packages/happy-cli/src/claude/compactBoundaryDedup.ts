/**
 * compactBoundaryDedup — uuid-keyed once-per-lifetime guard for
 * `compact_boundary` JSONL records.
 *
 * Why this exists
 * ---------------
 * Every cold restart, strand recovery, mode-change cold-swap, or isolate-slash
 * cold-swap re-spawns the Claude TUI with `--resume`. Claude rewrites the
 * session file with a fresh sessionId and `sessionScanner` then bursts every
 * historical record back into `onMessage` as if newly observed (see the
 * `coldRestartGraceUntil` declaration in claudeRemoteLauncherCore.ts for the
 * full rationale and the ~200-record/600ms burst observation).
 *
 * Without uuid-dedup the historical `compact_boundary` is re-surfaced on every
 * replay, producing duplicate "Context compacted" bubbles in the App — the
 * symptom motivating this guard was 4 identical events after one `/compact`
 * followed by 3 intervening cold restarts.
 *
 * Uuid identity is the only unambiguous discriminator: the
 * `coldRestartGraceUntil` 5s heuristic that protects `turnProducedOutput`
 * intentionally is NOT reused here because (a) a replay burst can land after
 * the window expires, and (b) a fresh user-issued `/compact` can land inside
 * it. Uuids never collide across either case.
 *
 * The helper is intentionally a one-liner with an explicit single
 * responsibility so the launcher-side call site remains a single function
 * call (greppable, refactor-safe) and the unit test pins the contract.
 */

/**
 * Record that a `compact_boundary` with the given uuid has been emitted.
 * Returns `true` exactly once per uuid (the first observation), `false`
 * on every subsequent observation of the same uuid.
 *
 * Mutates `seen` in place on a true return.
 */
export function tryRegisterCompactBoundaryEmission(
  seen: Set<string>,
  uuid: string,
): boolean {
  if (seen.has(uuid)) return false;
  seen.add(uuid);
  return true;
}
