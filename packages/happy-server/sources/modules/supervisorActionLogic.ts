/**
 * Pure decision logic for the SupervisorAction approval lifecycle.
 *
 * A SupervisorAction moves through an approval state machine
 * (pending → approved / skipped / ignored, and back to pending on restore)
 * that is interlocked with its fix lifecycle: restoring an action to pending,
 * or dismissing it, must also clear any fix tracking, and a restore must be
 * refused while a fix is actively running. Those rules are one invariant, so
 * this is the single place that owns "which current approval states a
 * transition is allowed from, whether the active-fix guard applies, and whether
 * the fix fields reset". The PATCH route consumes the decision and is the only
 * place that touches Prisma — it spreads the decision into ONE atomic
 * updateMany (compare-and-swap on `allowedFrom`) so the transition stays
 * race-safe. Callers must not re-derive these rules inline.
 */

export type SupervisorApproval = "pending" | "approved" | "skipped" | "ignored";

/** Approval states that count as "dismissed" (hidden from the active queue). */
export const DISMISSED_APPROVALS = ["skipped", "ignored"] as const;

/** Fix statuses that mean a fix is actively in flight and must not be disturbed. */
export const ACTIVE_FIX_STATUSES = ["pending", "running"] as const;

export type ApprovalTransitionDecision = {
    /** Current approval states this transition may be applied from (CAS guard). */
    allowedFrom: SupervisorApproval[];
    /** Refuse the transition while a fix is pending/running (restore-to-pending only). */
    blockWhileActivelyFixing: boolean;
    /** Clear fixStatus / fixSessionId / fixMode as part of the transition. */
    resetFix: boolean;
};

/**
 * Decide a single SupervisorAction approval transition.
 *
 * - approved: forward from the pending queue only; keeps any fix state.
 * - skipped / ignored: dismiss from pending, or dismiss after analysis from
 *   approved; clears fix tracking.
 * - pending: restore from a dismissed or approved action; clears fix tracking
 *   and is refused while a fix is actively running.
 *
 * Returns the from-state set (`allowedFrom`) for the caller's atomic CAS, plus
 * the two interlock flags — the caller never re-derives them.
 */
export function decideApprovalTransition(
    target: SupervisorApproval,
): ApprovalTransitionDecision {
    if (target === "approved") {
        return {
            allowedFrom: ["pending"],
            blockWhileActivelyFixing: false,
            resetFix: false,
        };
    }
    if (target === "pending") {
        return {
            allowedFrom: ["skipped", "ignored", "approved"],
            blockWhileActivelyFixing: true,
            resetFix: true,
        };
    }
    // skipped | ignored — dismiss from the active queue or after analysis.
    return {
        allowedFrom: ["pending", "approved"],
        blockWhileActivelyFixing: false,
        resetFix: true,
    };
}
