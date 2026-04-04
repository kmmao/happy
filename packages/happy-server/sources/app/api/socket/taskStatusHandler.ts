/**
 * Handle task-status events from CLI daemons.
 * Updates Task records with status changes and notifies the App.
 */

import { Socket } from "socket.io";
import { z } from "zod";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { eventRouter, buildTaskStatusChangedEphemeral } from "@/app/events/eventRouter";
import { inboxCreate } from "@/modules/inboxCreate";

const taskStatusSchema = z.object({
    taskId: z.string().min(1),
    status: z.enum(["queued", "dispatching", "running", "completed", "failed", "cancelled"]),
    sessionId: z.string().min(1).optional(),
    errorMessage: z.string().optional(),
});

export function taskStatusHandler(socket: Socket, userId: string): void {
    socket.on("task-status", async (rawData: unknown) => {
        try {
            const parsed = taskStatusSchema.safeParse(rawData);
            if (!parsed.success) {
                log(
                    { module: "task", level: "warn" },
                    `task-status: invalid data: ${parsed.error.message}`,
                );
                return;
            }
            const data = parsed.data;

            const task = await db.task.findFirst({
                where: { id: data.taskId, accountId: userId },
            });

            if (!task) {
                log(
                    { module: "task", level: "warn" },
                    `task-status: task ${data.taskId} not found for user ${userId}`,
                );
                return;
            }

            const isTerminal = ["completed", "failed", "cancelled"].includes(data.status);

            const updated = await db.task.update({
                where: { id: data.taskId },
                data: {
                    status: data.status,
                    sessionId: data.sessionId ?? task.sessionId,
                    errorMessage: data.errorMessage ?? task.errorMessage,
                    dispatchedAt: data.status === "running" && !task.dispatchedAt ? new Date() : task.dispatchedAt,
                    completedAt: isTerminal ? new Date() : task.completedAt,
                },
            });

            // Create inbox item for terminal statuses
            if (isTerminal) {
                void inboxCreate({
                    accountId: userId,
                    category: "task",
                    eventType: `task.${data.status}`,
                    severity: data.status === "failed" ? "error" : "info",
                    title: data.status === "completed"
                        ? "Task completed"
                        : data.status === "failed"
                            ? "Task failed"
                            : "Task cancelled",
                    body: data.status === "failed" ? data.errorMessage : undefined,
                    refType: "task",
                    refId: data.taskId,
                    groupKey: `task:${data.taskId}:${data.status}`,
                });
            }

            // Notify App
            eventRouter.emitEphemeral({
                userId,
                payload: buildTaskStatusChangedEphemeral({
                    taskId: data.taskId,
                    status: data.status,
                    sessionId: updated.sessionId ?? undefined,
                    errorMessage: updated.errorMessage ?? undefined,
                    completedAt: updated.completedAt?.getTime(),
                }),
                recipientFilter: { type: "user-scoped-only" },
            });

            log({ module: "task" }, `task-status: task ${data.taskId} → ${data.status}`);
        } catch (error) {
            log(
                { module: "task", level: "error" },
                `task-status handler error: ${error}`,
            );
        }
    });
}
