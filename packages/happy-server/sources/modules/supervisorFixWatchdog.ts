/**
 * Global watchdog for stale fix sessions.
 *
 * When a daemon reconnects (machine-alive heartbeat), check for any
 * "running" or "pending" fix actions whose sessions are no longer active.
 * Force-fail them and trigger loop progression if applicable.
 *
 * This catches cases where:
 * - The daemon crashed and restarted (losing in-memory session tracking)
 * - The fix session process was killed externally
 * - The CLI's onChildExited handler failed to report status
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";
import {
    eventRouter,
    buildSupervisorStatusEphemeral,
} from "@/app/events/eventRouter";
import { activityCache } from "@/app/presence/sessionCache";
import { pushSupervisorNotification } from "@/modules/pushSend";
import { onFixCompleted as loopOnFixCompleted } from "@/modules/supervisorLoopEngine";

/** Only process actions that have been stuck for at least this long. */
const STALE_THRESHOLD_MS = 5 * 60_000; // 5 minutes

/**
 * Find and force-fail fix actions that are stuck in "running" or "pending"
 * for a given machine's projects.
 */
export async function cleanupStaleFixActions(
    userId: string,
    machineId: string,
): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    // Find projects on this machine
    const projects = await db.project.findMany({
        where: { accountId: userId, machineId },
        select: { id: true },
    });

    if (projects.length === 0) return;

    const projectIds = projects.map((p) => p.id);

    // Find all stuck fix actions across these projects
    const staleActions = await db.supervisorAction.findMany({
        where: {
            projectId: { in: projectIds },
            accountId: userId,
            approval: "approved",
            fixStatus: { in: ["running", "pending"] },
            updatedAt: { lt: cutoff },
        },
        select: {
            id: true,
            projectId: true,
            fixSessionId: true,
            fixStatus: true,
            title: true,
            runId: true,
        },
        take: 50, // safety limit
    });

    if (staleActions.length === 0) return;

    // Check which fix sessions are still active
    const sessionIds = [
        ...new Set(
            staleActions
                .map((a) => a.fixSessionId)
                .filter(Boolean) as string[],
        ),
    ];

    const activeSessions =
        sessionIds.length > 0
            ? await db.session.findMany({
                where: { id: { in: sessionIds }, active: true },
                select: { id: true },
            })
            : [];

    const activeSessionIds = new Set(activeSessions.map((s) => s.id));

    // Filter to truly stale actions (no active session)
    const trueStale = staleActions.filter(
        (a) => !a.fixSessionId || !activeSessionIds.has(a.fixSessionId),
    );

    if (trueStale.length === 0) return;

    log(
        { module: "supervisor", level: "warn" },
        `Fix watchdog: found ${trueStale.length} stale fix action(s) on machine ${machineId}`,
    );

    // Process each stale action
    for (const action of trueStale) {
        await db.supervisorAction.update({
            where: { id: action.id },
            data: { fixStatus: "failed" },
        });

        // Archive the fix session if present
        if (action.fixSessionId) {
            const now = Date.now();
            await db.session.updateMany({
                where: { id: action.fixSessionId, active: true },
                data: { lastActiveAt: new Date(now), active: false },
            });
            activityCache.invalidateSession(action.fixSessionId);
        }

        log(
            { module: "supervisor", level: "warn" },
            `Fix watchdog: force-failed stale action ${action.id} ("${action.title}") — fixStatus was "${action.fixStatus}"`,
        );

        // Notify App clients
        eventRouter.emitEphemeral({
            userId,
            payload: buildSupervisorStatusEphemeral(
                action.runId,
                action.projectId,
                "fix-failed",
            ),
            recipientFilter: { type: "user-scoped-only" },
        });

        // Send push notification
        await pushSupervisorNotification(userId, {
            projectId: action.projectId,
            runId: action.runId,
            type: "error",
            title: "Fix Session Stale",
            body: `Auto-failed: ${action.title}`,
        });

        // Trigger loop progression if applicable — the engine absorbs its
        // own errors.
        await loopOnFixCompleted(userId, action.id, action.projectId, "failed");
    }
}
