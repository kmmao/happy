/**
 * planContinueRetryPolicy — reactive auto-retry for ExitPlanMode
 * continuation turns that die on mirror-side 429.
 *
 * Background
 * ─────────
 * After ExitPlanMode we cold-restart Claude TUI with `--resume` and
 * unshift `PLAN_FAKE_RESTART = "PlEaZe Continue with plan."`. On self-
 * hosted mirrors this first `--resume` call carries the whole session
 * history + system prompt + tools list + the just-emitted plan body in
 * a single request — routinely tripping the mirror's per-request or
 * per-minute cap. Claude TUI's internal 10-retry backoff burns down
 * quickly and the turn ends with `assistant.error === "rate_limit"`.
 * The user then has to interrupt and type "Continue" by hand; the next
 * turn opens a fresh HTTP connection past the mirror's cooldown and
 * succeeds. This module drives that recovery in-CLI so the user does
 * not need to intervene.
 *
 * Detection is delegated to the launcher (which reads the structured
 * `assistant.error === "rate_limit"` field from JSONL — see
 * `jsonlMessageTypes.ts:ClaudeJsonlAssistantMessageError`). This file
 * is a pure decision function: given the current turn's state, decide
 * whether to retry, give up, or do nothing. Kept side-effect-free so it
 * can be exhaustively unit-tested without pulling in timers, queue
 * state, or a real session.
 *
 * Scope guards baked into the policy
 * ──────────────────────────────────
 * - Non-continuation turn → no-op. Ordinary user prompts hitting 429
 *   are left to Claude TUI's native backoff; double-retrying would
 *   duplicate work and confuse the model with two "continue" prompts.
 * - Turn already produced non-rate-limit output → no-op. If the model
 *   emitted any real text / tool_use this turn before the rate_limit
 *   error arrived, the user has already seen a partial response.
 *   Silently re-issuing PLAN_FAKE_RESTART would double-consume. Mirrors
 *   the `rearmRedeliverBudget` semantics in strand recovery
 *   (see `strandPolicy.ts` for the pattern).
 * - Budget exhausted → give-up. Surface an App notice suggesting
 *   `/compact` rather than looping indefinitely.
 *
 * Full write-up: `docs/investigations/plan-mode-429.md` (Layer 3).
 */

export const MAX_PLAN_CONTINUE_RETRIES = 3;

/**
 * Backoff ladder for auto-retry (1-indexed attempt).
 *   attempt 1 → 30 s
 *   attempt 2 → 60 s
 *   attempt 3 → 120 s
 * Aligned with Anthropic's 60 s rolling window while giving mirrors
 * room to breathe. Total worst-case wait: 210 s ≈ 3.5 min — well under
 * the user's manual "wait then send continue" turnaround.
 */
export function planContinueBackoffMs(attempt: number): number {
  if (attempt <= 1) return 30_000;
  if (attempt === 2) return 60_000;
  return 120_000;
}

export interface PlanContinueRetryState {
  /**
   * True when the current turn was triggered by a
   * `source: "exit-plan-continue"` or `"exit-plan-retry"` unshift.
   * Only continuation turns are eligible for auto-retry — normal user
   * prompts are left alone.
   */
  isPlanContinuationTurn: boolean;
  /**
   * How many auto-retries have already fired for this
   * continuation chain. 0 on the first rate_limit hit; ++ before each
   * re-unshift. Reset to 0 when the chain succeeds (see rearm).
   */
  retryCount: number;
  /**
   * True if this turn's model has already emitted any real (non-rate-
   * limit) output — text, tool_use, thinking. Once true, further
   * rate_limit errors on the same turn are NOT auto-retried; the
   * partial response the user saw is authoritative.
   */
  turnProducedNonRateLimitOutput: boolean;
}

export type PlanContinueRetryDecision =
  | { action: "no-op"; reason: string }
  | { action: "retry"; attempt: number; delayMs: number; reason: string }
  | { action: "give-up"; reason: string };

/**
 * Given a rate-limit hit on the current turn, decide what to do. Pure
 * function of `state` — no I/O, no timers.
 *
 * Returned `attempt` is 1-indexed and equals `state.retryCount + 1`,
 * i.e. the ordinal of the retry that would fire if the caller acts on
 * "retry". The caller is expected to `++retryCount` *after* the sleep
 * (before re-unshift) so a mid-sleep abort doesn't leak the increment.
 */
export function decidePlanContinueRetry(
  state: PlanContinueRetryState,
): PlanContinueRetryDecision {
  if (!state.isPlanContinuationTurn) {
    return {
      action: "no-op",
      reason: "not a plan-continuation turn — leaving to TUI native backoff",
    };
  }
  if (state.turnProducedNonRateLimitOutput) {
    return {
      action: "no-op",
      reason: "turn already produced real output — auto-retry disarmed",
    };
  }
  if (state.retryCount >= MAX_PLAN_CONTINUE_RETRIES) {
    return {
      action: "give-up",
      reason: `budget exhausted (${MAX_PLAN_CONTINUE_RETRIES} retries) — surfacing App notice`,
    };
  }
  const attempt = state.retryCount + 1;
  return {
    action: "retry",
    attempt,
    delayMs: planContinueBackoffMs(attempt),
    reason: `rate_limit on continuation turn — attempt ${attempt}/${MAX_PLAN_CONTINUE_RETRIES}`,
  };
}
