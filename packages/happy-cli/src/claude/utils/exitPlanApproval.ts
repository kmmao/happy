/**
 * exitPlanApproval — single-source truth for "should Yolo/bypass sessions
 * auto-approve ExitPlanMode?"
 *
 * Historical default (prior to the plan-mode 429 mitigation): TRUE. The
 * App picker was skipped to honour Yolo's "no prompts" contract. This
 * routed ExitPlanMode into the PLAN_FAKE_RESTART cold-restart path
 * immediately, and for large sessions on self-hosted mirrors the
 * resulting `--resume` storm tripped the mirror's TPM ceiling and
 * produced the 429 that filed this whole investigation.
 *
 * New default: FALSE. Even Yolo sessions route ExitPlanMode through the
 * App picker (blocking-hook IPC bridge — see
 * `scripts/exit_plan_approval_forwarder.cjs` and the
 * `ExitPlanApproval` branch of `startHookServer.ts`). The user's
 * manual review time IS the mirror-TPM cooldown; they can also pick
 * "Reject with Feedback" so Claude iterates on the plan instead of
 * paying the full cold-restart cost every round.
 *
 * Opt back into the old behaviour with `HAPPY_YOLO_EXIT_PLAN_AUTO_APPROVE=1`
 * (also accepts `"true"`). Required for automation contexts
 * (agent_loop / webhook / scheduled runs) where no human is available
 * to click the picker.
 *
 * Two production consumers read this flag:
 *   1. `mergeExitPlanAutoApproveIntoSettings.ts` — decides WHICH hook
 *      script to inject: the classic auto-approve script (opt-in) or
 *      the new blocking approval-forwarder script (default).
 *   2. `claudeRemoteLauncherCore.ts` — the ExitPlanMode observer branch
 *      only unshifts PLAN_FAKE_RESTART immediately when the classic
 *      auto-approve hook is in effect. Under the new default the
 *      hookServer's `onExitPlanApproval` callback owns the unshift.
 *
 * Both must read the SAME flag so the injected hook and the launcher
 * agree on who is driving continuation.
 */

/**
 * Returns true when a Yolo/bypass session should auto-approve
 * ExitPlanMode without showing the App picker. See file-level docstring
 * for the rationale and the env-var opt-in.
 */
export function shouldAutoApproveExitPlanInBypass(): boolean {
  const raw = process.env.HAPPY_YOLO_EXIT_PLAN_AUTO_APPROVE;
  if (!raw) return false;
  // Accept only the two canonical truthy tokens. Reject anything else
  // (including "0", "false", "no", garbage) as the safer default —
  // matches the "explicit opt-in" contract advertised above.
  return raw === "1" || raw.toLowerCase() === "true";
}

/**
 * Timeout (ms) for waiting on the App user to approve/reject an
 * ExitPlanMode picker. Read from `HAPPY_EXIT_PLAN_APPROVAL_TIMEOUT_MS`
 * with sane bounds; falls back to a 10-minute default that comfortably
 * covers "user is thinking / on a call" without letting a dead App
 * session freeze a Claude turn forever.
 *
 * The timeout is enforced server-side by `permissionHandler.
 * registerExitPlanApproval`. On timeout the request is resolved as
 * denied with reason `"Approval timeout"` — Claude sees an error
 * tool_result and stays in plan mode; the user can resubmit.
 *
 * Bounds:
 *   min = 10 000 ms  (10 s — anything shorter defeats the point)
 *   max = 3 600 000  (1 h  — beyond this the shell-level TCP keepalive
 *                     becomes the reliability bottleneck, not this cap)
 */
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 3_600_000;

export function readExitPlanApprovalTimeoutMs(): number {
  const raw = process.env.HAPPY_EXIT_PLAN_APPROVAL_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(raw)) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, parsed));
}
