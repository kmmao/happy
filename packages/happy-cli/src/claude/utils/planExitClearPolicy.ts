/**
 * planExitClearPolicy — decide whether an approved ExitPlanMode should
 * run the "clear context & execute" path (Layer 0) or the classic
 * PLAN_FAKE_RESTART continuation.
 *
 * Background
 * ─────────
 * Exiting plan mode cold-restarts Claude TUI with `--resume`, whose
 * full-history replay is one fat request. On self-hosted mirrors that
 * single burst trips the per-request / per-minute cap and 429s, even
 * with a tiny (~50K) context — the burst, not the total size, is the
 * problem (see `docs/investigations/plan-mode-429.md`).
 *
 * The clear path (`/clear` → inject plan body into a fresh session)
 * removes the burst entirely: `/clear` makes no model call, so the
 * continuation request never carries the replay and structurally can't
 * 429. The cost is that the executing session starts with only the plan
 * text — which is exactly what a self-contained plan (the intended
 * output of plan mode) needs.
 *
 * Why default this on for bypass sessions
 * ───────────────────────────────────────
 * Bypass (`--dangerously-skip-permissions`) is the 429 hot path: it is
 * the mode where the plan-mode lockdown teardown forces the burst-y
 * cold restart, and its verified alternatives are only Layer 0 (this
 * clear path) or a full SDK rewrite — keeping the burst AND avoiding the
 * 429 is impossible under PTY (the lockdown is load-bearing because
 * bypass makes plan-mode read-only merely advisory; it cannot be
 * dropped). So for bypass sessions we make Layer 0 the default rather
 * than a button the user must remember to click.
 *
 * Escape hatch: `HAPPY_PLAN_KEEP_CONTEXT=1` keeps the classic
 * full-context continuation for plans that lean on unstated
 * conversation history (accepts the 429 risk — sensible only on the
 * official API or a mirror without a tight burst cap).
 *
 * Pure function of its inputs — no env reads, no I/O — so it can be
 * exhaustively unit-tested. The caller resolves the env flag and passes
 * it in.
 */

export interface PlanExitClearState {
  /**
   * The App user explicitly picked "Clear context & execute"
   * (`clearContext: true` on the permission RPC). Always wins — an
   * explicit click is never overridden by env or mode.
   */
  explicitClear: boolean;
  /**
   * The session runs with `--dangerously-skip-permissions` (bypass /
   * yolo). The 429 hot path and where the plan is expected to be
   * self-contained.
   */
  bypass: boolean;
  /**
   * `HAPPY_PLAN_KEEP_CONTEXT` is set truthy — opt out of the bypass
   * default and keep the classic full-context continuation. Does NOT
   * override an explicit clear click.
   */
  keepContextEnv: boolean;
}

/**
 * True → route the approval through the `/clear` + plan-exec path.
 * False → route through the classic PLAN_FAKE_RESTART continuation.
 *
 * Precedence:
 *   1. explicit user click → clear (env/mode ignored)
 *   2. bypass + not opted out → clear (the new default)
 *   3. otherwise → classic
 */
export function shouldClearOnPlanExit(state: PlanExitClearState): boolean {
  if (state.explicitClear) return true;
  if (state.bypass && !state.keepContextEnv) return true;
  return false;
}

/**
 * Parse `HAPPY_PLAN_KEEP_CONTEXT` (or any opt-out flag) into a boolean.
 * Accepts `1` / `true` (case-insensitive); everything else is false so
 * a stray value degrades to the safe default (clear on) rather than
 * silently disabling the fix.
 */
export function parseKeepContextEnv(raw: string | undefined): boolean {
  return /^(1|true)$/i.test((raw ?? "").trim());
}
