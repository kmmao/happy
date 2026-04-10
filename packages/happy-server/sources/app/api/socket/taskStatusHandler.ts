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
import { goalProgressUpdate } from "@/modules/goalProgressUpdate";
import {
    normalizeTaskStatusReport,
    shouldApplyTaskStatus,
} from "@/modules/taskStatusLogic";

const taskStatusSchema = z.object({
    taskId: z.string().min(1),
    status: z.enum(["queued", "dispatching", "running", "completed", "failed", "cancelled"]),
    outcome: z.enum(["completed", "failed", "blocked"]).optional(),
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
            const normalized = normalizeTaskStatusReport({
                status: data.status,
                outcome: data.outcome,
            });
            const resolvedStatus = normalized.status;

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

            if (task.status === resolvedStatus && ["completed", "failed", "cancelled"].includes(task.status)) {
                return;
            }

            if (!shouldApplyTaskStatus(task.status, resolvedStatus)) {
                log(
                    { module: "task", level: "warn" },
                    `task-status: ignored stale transition for ${data.taskId}: ${task.status} -> ${resolvedStatus}`,
                );
                return;
            }

            const isTerminal = ["completed", "failed", "cancelled"].includes(resolvedStatus);

            const updated = await db.task.update({
                where: { id: data.taskId },
                data: {
                    status: resolvedStatus,
                    sessionId: data.sessionId ?? task.sessionId,
                    errorMessage: data.errorMessage ?? task.errorMessage,
                    dispatchedAt: resolvedStatus === "running" && !task.dispatchedAt ? new Date() : task.dispatchedAt,
                    completedAt: isTerminal ? new Date() : task.completedAt,
                },
            });

            // Create inbox item for terminal statuses
            if (isTerminal) {
                const taskLabel = updated.title ?? `Task ${data.taskId.slice(-6)}`;
                void inboxCreate({
                    accountId: userId,
                    category: "task",
                    eventType: `task.${resolvedStatus}`,
                    severity: resolvedStatus === "failed" ? "error" : "info",
                    title: resolvedStatus === "completed"
                        ? `${taskLabel}: completed`
                        : resolvedStatus === "failed"
                            ? `${taskLabel}: failed`
                            : `${taskLabel}: cancelled`,
                    body: resolvedStatus === "failed" ? data.errorMessage : undefined,
                    referenceUrl: updated.sessionId ? `/session/${updated.sessionId}` : undefined,
                    refType: "task",
                    refId: data.taskId,
                    groupKey: `task:${data.taskId}:${resolvedStatus}`,
                });
            }

            // Notify App
            eventRouter.emitEphemeral({
                userId,
                payload: buildTaskStatusChangedEphemeral({
                    taskId: data.taskId,
                    machineId: task.machineId,
                    status: resolvedStatus,
                    sessionId: updated.sessionId ?? undefined,
                    errorMessage: updated.errorMessage ?? undefined,
                    completedAt: updated.completedAt?.getTime(),
                }),
                recipientFilter: { type: "user-scoped-only" },
            });

            // Update goal progress when task reaches terminal state
            if (isTerminal && updated.goalId) {
                void goalProgressUpdate({
                    goalId: updated.goalId,
                    accountId: userId,
                });
            }

            log({ module: "task" }, `task-status: task ${data.taskId} → ${resolvedStatus}`);
        } catch (error) {
            log(
                { module: "task", level: "error" },
                `task-status handler error: ${error}`,
            );
        }
    });
}
