/**
 * Handle supervisor-fix-status events from CLI daemons.
 * Updates SupervisorAction fixStatus, sends push notifications,
 * and broadcasts status to App clients.
 */

import { Socket } from "socket.io";
import { z } from "zod";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import {
    eventRouter,
    buildSupervisorStatusEphemeral,
} from "@/app/events/eventRouter";
import { pushSupervisorNotification } from "@/modules/pushSend";

const supervisorFixStatusSchema = z.object({
    actionId: z.string().min(1),
    projectId: z.string().min(1),
    fixStatus: z.enum(["running", "completed", "failed"]),
    fixSessionId: z.string().min(1).optional(),
});

export function supervisorFixStatusHandler(
    socket: Socket,
    userId: string,
): void {
    socket.on("supervisor-fix-status", async (rawData: unknown) => {
        try {
            const parsed = supervisorFixStatusSchema.safeParse(rawData);
            if (!parsed.success) {
                log(
                    { module: "supervisor", level: "warn" },
                    `supervisor-fix-status: invalid data: ${parsed.error.message}`,
                );
                return;
            }
            const data = parsed.data;

            // Verify the action belongs to this user and is approved
            const action = await db.supervisorAction.findFirst({
                where: {
                    id: data.actionId,
                    projectId: data.projectId,
                    accountId: userId,
                    approval: "approved",
                },
                select: { id: true, fixStatus: true, runId: true, title: true },
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

            log(
                { module: "supervisor" },
                `supervisor-fix-status: action ${data.actionId} → ${data.fixStatus}`,
            );

            // Notify App clients about fix status change
            eventRouter.emitEphemeral({
                userId,
                payload: buildSupervisorStatusEphemeral(
                    action.runId,
                    data.projectId,
                    `fix-${data.fixStatus}`,
                ),
                recipientFilter: { type: "user-scoped-only" },
            });

            // Send push notification on fix completion/failure
            if (
                data.fixStatus === "completed" ||
                data.fixStatus === "failed"
            ) {
                const title =
                    data.fixStatus === "completed"
                        ? "Fix Applied Successfully"
                        : "Fix Failed";
                const body =
                    data.fixStatus === "completed"
                        ? `Fixed: ${action.title}`
                        : `Failed to fix: ${action.title}`;

                await pushSupervisorNotification(userId, {
                    projectId: data.projectId,
                    runId: action.runId,
                    type:
                        data.fixStatus === "completed"
                            ? "fix_complete"
                            : "error",
                    title,
                    body,
                });
            }
        } catch (error) {
            log(
                { module: "supervisor", level: "error" },
                `supervisor-fix-status handler error: ${error}`,
            );
        }
    });
}
