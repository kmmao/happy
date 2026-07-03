/**
 * Pure decision logic for the SupervisorAction fix lifecycle (fixStatus).
 *
 * A SupervisorAction's fix moves through
 *   null → pending → running → completed | failed | analyzed
 * (the reset back to null is owned by the approval state machine in
 * supervisorActionLogic — restoring/dismissing an action clears fix tracking).
 *
 * This module is the single owner of:
 *   - the status vocabulary (which statuses are "active", which "terminal"),
 *   - what follows from a CLI fix-status report (archive the session? request
 *     a kill? notify? progress the loop?) — shared by the socket handler and
 *     the HTTP callback route so the two transports cannot drift silently,
 *   - the auto-approve-and-queue-fix transition used by auto/semi-auto mode
 *     and by the loop engine's iteration,
 *   - the "may a new fix be triggered?" guard,
 *   - the action list view → query-filter mapping,
 *   - the watchdog rule for selecting truly-stale fix actions.
 *
 * Callers apply these decisions to Prisma / sockets / push themselves; they
 * must not re-derive the rules inline.
 */

import { DISMISSED_APPROVALS } from "@/modules/supervisorActionLogic";

/** Every value fixStatus can hold once a fix has been queued. */
export type SupervisorFixStatus =
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "analyzed";

/** Statuses a CLI daemon may report for a fix session. */
export type ReportedFixStatus = "running" | "completed" | "failed" | "analyzed";

/** Terminal statuses — the fix session's work is over. */
export type TerminalFixStatus = "completed" | "failed" | "analyzed";

/** Fix statuses that mean a fix is actively in flight and must not be disturbed. */
export const ACTIVE_FIX_STATUSES = ["pending", "running"] as const;

/** Fix statuses after which no further fix activity happens for this queue entry. */
export const TERMINAL_FIX_STATUSES = ["completed", "failed", "analyzed"] as const;

export function isActiveFixStatus(
    status: SupervisorFixStatus | null,
): boolean {
    return status !== null
        && (ACTIVE_FIX_STATUSES as readonly string[]).includes(status);
}

export function isTerminalFixStatus(
    status: SupervisorFixStatus | null,
): status is TerminalFixStatus {
    return status !== null
        && (TERMINAL_FIX_STATUSES as readonly string[]).includes(status);
}

/**
 * May a new fix be triggered for an action currently in `current`?
 * Refused while a fix is pending/running (the POST /fix 409 guard);
 * allowed from null and from any terminal status (re-fix after failure
 * or after an analyze-first pass is legitimate).
 */
export function canTriggerFix(current: SupervisorFixStatus | null): boolean {
    return !isActiveFixStatus(current);
}

/**
 * The auto-approve-and-queue-fix transition (auto / semi-auto mode and the
 * loop engine's iteration): approve a pending action and mark its fix queued
 * in one write. `allowedFrom` is the CAS guard — apply as
 * `updateMany({ where: { approval: allowedFrom }, data })` so a concurrent
 * human dismissal cannot be overwritten.
 */
export function decideAutoApproveAndQueueFix(): {
    allowedFrom: "pending";
    data: { approval: "approved"; fixStatus: "pending" };
} {
    return {
        allowedFrom: "pending",
        data: { approval: "approved", fixStatus: "pending" },
    };
}

export type FixStatusNotification = {
    type: "fix_complete" | "error";
    title: string;
    body: string;
};

export type FixStatusReportDecision = {
    /** The fix session's work is over (completed | failed | analyzed). */
    isTerminal: boolean;
    /**
     * Archive the fix Session row (active: false) — completed | failed only.
     * "analyzed" is intentionally excluded: the analyze-first session must
     * remain accessible so the user can review the analysis results before
     * deciding whether to proceed with a fix.
     */
    archiveSessionInDb: boolean;
    /**
     * Ask the daemon to kill the fix session process
     * (supervisor-fix-kill-session ephemeral). Historically the HTTP callback
     * transport killed on ALL terminal statuses including "analyzed", while
     * the socket transport's archive rule deliberately spares "analyzed"
     * (see archiveSessionInDb). The divergence is preserved here verbatim and
     * made visible: unifying the two rules is a product decision, not a
     * refactor.
     */
    requestSessionKill: boolean;
    /** Feed the report into loop progression (onFixCompleted). */
    progressLoop: boolean;
    /** Push-notification content, or null when the report is not notable. */
    notification: FixStatusNotification | null;
};

/**
 * Decide everything that follows from a CLI fix-status report. Both report
 * transports (socket `supervisor-fix-status` and the HTTP fix-status
 * callback) consume this one decision; they only differ in which fields they
 * act on (socket archives in DB, HTTP requests a process kill).
 */
export function decideFixStatusReport(
    reported: ReportedFixStatus,
    actionTitle: string,
): FixStatusReportDecision {
    if (reported === "running") {
        return {
            isTerminal: false,
            archiveSessionInDb: false,
            requestSessionKill: false,
            progressLoop: false,
            notification: null,
        };
    }

    const notification: FixStatusNotification =
        reported === "completed"
            ? {
                type: "fix_complete",
                title: "Fix Applied Successfully",
                body: `Fixed: ${actionTitle}`,
            }
            : reported === "analyzed"
                ? {
                    type: "fix_complete",
                    title: "Analysis Complete",
                    body: `Analyzed: ${actionTitle}`,
                }
                : {
                    type: "error",
                    title: "Fix Failed",
                    body: `Failed to fix: ${actionTitle}`,
                };

    return {
        isTerminal: true,
        archiveSessionInDb: reported === "completed" || reported === "failed",
        requestSessionKill: true,
        progressLoop: true,
        notification,
    };
}

/** Action list views whose filter involves the fix lifecycle or dismissal. */
export type SupervisorActionView =
    | "approved"
    | "fixing"
    | "analyzing"
    | "analyzed"
    | "done"
    | "failed"
    | "dismissed";

/**
 * Map an action list view to its query filter. Returned fragments are plain
 * data the route spreads into its Prisma `where` — this module stays pure.
 *
 * - approved: approved, no fix queued yet
 * - fixing / analyzing: approved with an active fix, split by fixMode
 * - analyzed / done / failed: approved at that terminal status
 * - dismissed: skipped or ignored (approval-only view)
 */
export function supervisorActionViewFilter(
    view: SupervisorActionView,
): Record<string, unknown> {
    switch (view) {
        case "approved":
            return { approval: "approved", fixStatus: null };
        case "fixing":
            return {
                approval: "approved",
                fixStatus: { in: [...ACTIVE_FIX_STATUSES] },
                fixMode: { not: "analyze-first" },
            };
        case "analyzing":
            return {
                approval: "approved",
                fixStatus: { in: [...ACTIVE_FIX_STATUSES] },
                fixMode: "analyze-first",
            };
        case "analyzed":
            return { approval: "approved", fixStatus: "analyzed" };
        case "done":
            return { approval: "approved", fixStatus: "completed" };
        case "failed":
            return { approval: "approved", fixStatus: "failed" };
        case "dismissed":
            return { approval: { in: [...DISMISSED_APPROVALS] } };
    }
}

/**
 * Views that sort by updatedAt (latest status change first) rather than
 * createdAt — the fix-progress views, where recency of movement matters.
 */
export function isUpdatedAtOrderedView(
    view: SupervisorActionView | undefined,
): boolean {
    return view === "done"
        || view === "fixing"
        || view === "analyzing"
        || view === "analyzed";
}

/** The status a watchdog forces onto a stale fix action. */
export const STALE_FIX_RESOLUTION = "failed" as const;

/**
 * Watchdog rule: an active-fix action is truly stale when it has no fix
 * session at all, or its fix session is no longer active. Shared by the
 * machine-level watchdog (daemon reconnect sweep) and the loop engine's
 * per-iteration watchdog so the two cannot drift.
 */
export function selectTrulyStaleFixActions<
    T extends { fixSessionId: string | null },
>(actions: readonly T[], activeSessionIds: ReadonlySet<string>): T[] {
    return actions.filter(
        (a) => !a.fixSessionId || !activeSessionIds.has(a.fixSessionId),
    );
}
