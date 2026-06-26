/**
 * Handle supervisor-fix-status events from CLI daemons.
 * Updates SupervisorAction fixStatus, sends push notifications,
 * and broadcasts status to App clients.
 */

import { Socket } from "socket.io";
import { z } from "zod";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { activityCache } from "@/app/presence/sessionCache";
import { pushSupervisorNotification } from "@/modules/pushSend";
import { onFixCompleted as loopOnFixCompleted } from "@/modules/supervisorLoopEngine";
import { registerSocketEvent } from "./registerSocketEvent";

const supervisorFixStatusSchema = z.object({
    actionId: z.string().min(1),
    projectId: z.string().min(1),
    fixStatus: z.enum(["running", "completed", "failed", "analyzed"]),
    fixSessionId: z.string().min(1).optional(),
    parentSessionId: z.string().min(1).optional(),
});

export function supervisorFixStatusHandler(
    socket: Socket,
    userId: string,
): void {
    registerSocketEvent({
        socket,
        userId,
        event: "supervisor-fix-status",
        schema: supervisorFixStatusSchema,
        module: "supervisor",
        handler: async (data) => {
            // Verify the action belongs to this user and is approved
            const action = await db.supervisorAction.findFirst({
                where: {
                    id: data.actionId,
                    projectId: data.projectId,
                    accountId: userId,
                    approval: "approved",
                },
                select: { id: true, fixStatus: true, fixSessionId: true, runId: true, title: true },
            });

            if (!action) {
                log(
                    { module: "supervisor", level: "warn" },
                    `supervisor-fix-status: action ${data.actionId} not found for user ${userId}`,
                );
                return;
            }

            // Build update data
            const updateData: Record<string, unknown> = {
                fixStatus: data.fixStatus,
            };
            if (data.fixSessionId !== undefined) {
                updateData.fixSessionId = data.fixSessionId;
            }

            // Update the action
            await db.supervisorAction.update({
                where: { id: data.actionId },
                data: updateData,
            });

            // When the fix session starts running and a parent session is known, record the hierarchy
            if (
                data.fixStatus === "running" &&
                data.fixSessionId &&
                data.parentSessionId
            ) {
                await db.session.updateMany({
                    where: { id: data.fixSessionId, accountId: userId },
                    data: { parentSessionId: data.parentSessionId },
                });
            }

            log(
                { module: "supervisor" },
                `supervisor-fix-status: action ${data.actionId} → ${data.fixStatus}`,
            );

            // Archive fix session on truly terminal statuses only.
            // "analyzed" is intentionally excluded: the analyze-first session should
            // remain accessible so the user can review the analysis results before
            // deciding whether to proceed with a fix.
            if (
                data.fixStatus === "completed" ||
                data.fixStatus === "failed"
            ) {
                // Archive the fix session first (before broadcasting status)
                // so clients see active: false when they query after the status event.
                const resolvedFixSessionId =
                    data.fixSessionId ?? action.fixSessionId;
                if (resolvedFixSessionId) {
                    const now = Date.now();
                    await db.session.updateMany({
                        where: {
                            id: resolvedFixSessionId,
                            active: true,
                        },
                        data: {
                            lastActiveAt: new Date(now),
                            active: false,
                        },
                    });
                    activityCache.invalidateSession(resolvedFixSessionId);
                    await emitSyncEphemeral(userId, {
                        t: "session-activity",
                        sessionId: resolvedFixSessionId,
                        active: false,
                        activeAt: now,
                    });
                }
            }

            // Send push notification for all notable statuses (including analyzed).
            if (
                data.fixStatus === "completed" ||
                data.fixStatus === "failed" ||
                data.fixStatus === "analyzed"
            ) {
                const notifTitle =
                    data.fixStatus === "completed"
                        ? "Fix Applied Successfully"
                        : data.fixStatus === "analyzed"
                            ? "Analysis Complete"
                            : "Fix Failed";
                const notifBody =
                    data.fixStatus === "completed"
                        ? `Fixed: ${action.title}`
                        : data.fixStatus === "analyzed"
                            ? `Analyzed: ${action.title}`
                            : `Failed to fix: ${action.title}`;

                await pushSupervisorNotification(userId, {
                    projectId: data.projectId,
                    runId: action.runId,
                    type:
                        data.fixStatus === "completed" || data.fixStatus === "analyzed"
                            ? "fix_complete"
                            : "error",
                    title: notifTitle,
                    body: notifBody,
                });
            }

            // Notify App clients about fix status change.
            await emitSyncEphemeral(userId, {
                t: "supervisor-status",
                runId: action.runId,
                projectId: data.projectId,
                status: `fix-${data.fixStatus}`,
            });

            // Loop progression: if this fix belongs to a loop, check if all fixes are done
            if (
                data.fixStatus === "completed" ||
                data.fixStatus === "failed" ||
                data.fixStatus === "analyzed"
            ) {
                try {
                    await loopOnFixCompleted(
                        userId,
                        data.actionId,
                        data.projectId,
                        data.fixStatus,
                    );
                } catch (loopError) {
                    log(
                        { module: "supervisor", level: "error" },
                        `Loop fix progression error for action ${data.actionId}: ${loopError}`,
                    );
                }
            }
        },
    });
}
