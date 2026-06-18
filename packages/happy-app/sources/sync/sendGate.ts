/**
 * sendGate — pure eligibility decision for one pending-queue dispatch.
 *
 * Why a gate
 * ----------
 * `pendingQueueDispatcher.dispatchIfReady` previously interleaved three
 * concerns into one ~60-line method:
 *
 *   1. is the Session eligible to receive a message RIGHT NOW?
 *   2. queue mechanics (shift, restore, in-flight tracking, fallback)
 *   3. ack handling on success / rejection
 *
 * Eligibility was buried inside (1) as a 5-branch cascade that callers
 * had no typed way to introspect — the `schedule({ ignorePaused: true })`
 * escape hatch in `SessionView.tsx` was the eligibility-logic leak made
 * user-visible. When **SessionController** (CONTEXT.md) lands it injects
 * this dispatcher; the leak follows it in without intervention.
 *
 * This module factors the eligibility decision out as a pure function
 * over a typed state snapshot. Dispatch becomes:
 *
 *   const verdict = checkSendEligibility(snapshot);
 *   if (!verdict.eligible) { applySideEffectForReason(verdict.reason); return; }
 *   // proceed to send
 *
 * Five blocker reasons are pinned by the typed `SendBlockReason` union;
 * adding a new one fails typecheck across every consumer. The precedence
 * between blockers — no-session > session-running > in-flight > paused
 * (sans override) > empty-queue — is the contract every dispatcher must
 * preserve and is the load-bearing invariant the test suite locks down.
 *
 * Pure: no storage reads, no timers, no Promises. Caller builds the
 * `SendGateState` snapshot from storage / dispatcher internals once per
 * decision.
 */

/**
 * Reasons a dispatch may be blocked. Each value carries a clear side
 * effect contract the caller acts on (see `pendingQueueDispatcher.ts`):
 *
 *   - `no-session`       → caller should dispose the session
 *   - `session-running`  → caller should drop any held in-flight latch
 *                          (the running session will deliver its own ack)
 *   - `in-flight`        → caller no-ops; the in-flight cycle will finish
 *                          and re-schedule
 *   - `paused`           → caller no-ops; an `ignorePaused` schedule call
 *                          will lift the override
 *   - `empty-queue`      → caller should clear any standing override so a
 *                          future paused schedule doesn't auto-bypass
 */
export type SendBlockReason =
  | "no-session"
  | "session-running"
  | "in-flight"
  | "paused"
  | "empty-queue";

/**
 * Typed verdict — the surface every dispatcher branches on.
 */
export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: SendBlockReason };

/**
 * Snapshot of the world the gate needs to decide. The caller (the
 * dispatcher) builds this from storage + its private in-flight /
 * forceUnpaused sets. The gate reads only this snapshot — never the
 * storage singleton, never timer state — which makes it deterministic
 * and pinnable per-case.
 */
export interface SendGateState {
  /** Session entry exists in storage. */
  readonly sessionExists: boolean;
  /** Session is currently mid-turn / waiting on tool result / etc. */
  readonly isSessionRunning: boolean;
  /** Dispatcher already has a send in flight for this session. */
  readonly isInFlight: boolean;
  /** Queue is paused (manual user pause) for this session. */
  readonly isPaused: boolean;
  /** A prior `schedule({ ignorePaused: true })` armed an override. */
  readonly hasOverride: boolean;
  /** Current pending-queue length for this session. */
  readonly queueLength: number;
}

/**
 * Eligibility check — deterministic, pure, total.
 *
 * Precedence is the dispatcher's existing behaviour, locked here so
 * future refactors don't subtly reorder it:
 *
 *   no-session > session-running > in-flight > paused (no override) > empty
 *
 * `paused + hasOverride` is the "force-send" path; the gate yields
 * `eligible: true` and the dispatcher will clear the override after the
 * send completes.
 */
export function checkSendEligibility(state: SendGateState): EligibilityResult {
  if (!state.sessionExists) return { eligible: false, reason: "no-session" };
  if (state.isSessionRunning)
    return { eligible: false, reason: "session-running" };
  if (state.isInFlight) return { eligible: false, reason: "in-flight" };
  if (state.isPaused && !state.hasOverride)
    return { eligible: false, reason: "paused" };
  if (state.queueLength === 0)
    return { eligible: false, reason: "empty-queue" };
  return { eligible: true };
}
