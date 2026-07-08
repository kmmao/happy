/**
 * planExitClearPolicy — decide whether an approved ExitPlanMode should
 * run the "clear context & execute" path (Layer 0) or the classic
 * PLAN_FAKE_RESTART continuation.
 *
 * Background
 * ─────────
 * Exiting plan mode cold-restarts Claude TUI with `--resume`, whose
 * full-history replay is one fat request. On self-hosted mirrors a huge
 * context can trip the per-minute throughput cap and 429 — but the real
 * culprit we chased down was a profile misconfig (an Opus alias pointed
 * at sonnet-4.6 under a 1M window let plan exploration balloon to ~488K
 * and saturate the mirror's per-minute throughput), NOT the payload size
 * of an ordinary continuation (see `docs/investigations/plan-mode-429.md`).
 *
 * The clear path (`/clear` → inject plan body into a fresh session) drops
 * the continuation to just the plan text: `/clear` makes no model call,
 * so the continuation request never carries the replay. It stays as an
 * opt-in capability (explicit App button, or `HAPPY_PLAN_DEFAULT_CLEAR=1`)
 * for genuinely self-contained plans — but it is NOT the default, because
 * the default MUST preserve the full conversation context so plans that
 * lean on unstated history continue correctly.
 *
 * Default (all sessions, bypass included)
 * ───────────────────────────────────────
 * Keep the classic full-context continuation. A plain "Approve plan"
 * — even in bypass — resumes with the whole conversation intact, exactly
 * as it did before the 0.102.26 experiment.
 *
 * Opt-in to clear: `HAPPY_PLAN_DEFAULT_CLEAR=1` makes bypass sessions
 * default to the clear path (the old 0.102.26 default, retained as an
 * escape hatch). An explicit App "Clear context & execute" click always
 * clears, regardless of mode or env.
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
   * yolo). Only relevant together with the opt-in env flag below.
   */
  bypass: boolean;
  /**
   * `HAPPY_PLAN_DEFAULT_CLEAR` is set truthy — opt IN to the clear path
   * as the bypass default (the retired 0.102.26 default). Off by default
   * so a plain approval keeps the full context.
   */
  defaultClearEnv: boolean;
}

/**
 * True → route the approval through the `/clear` + plan-exec path.
 * False → route through the classic PLAN_FAKE_RESTART continuation.
 *
 * Precedence:
 *   1. explicit user click → clear (env/mode ignored)
 *   2. bypass + HAPPY_PLAN_DEFAULT_CLEAR=1 → clear (opt-in)
 *   3. otherwise → classic full-context continuation (the default)
 */
export function shouldClearOnPlanExit(state: PlanExitClearState): boolean {
  if (state.explicitClear) return true;
  if (state.bypass && state.defaultClearEnv) return true;
  return false;
}

/**
 * Parse `HAPPY_PLAN_DEFAULT_CLEAR` into a boolean. Accepts `1` / `true`
 * (case-insensitive); everything else is false so the safe default
 * (keep full context) holds unless the opt-in is explicit.
 */
export function parseDefaultClearEnv(raw: string | undefined): boolean {
  return /^(1|true)$/i.test((raw ?? "").trim());
}
