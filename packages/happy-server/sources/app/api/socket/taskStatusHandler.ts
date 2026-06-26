/**
 * Handle task-status events from CLI daemons.
 * Updates Task records with status changes and notifies the App.
 */

import { Socket } from "socket.io";
import { z } from "zod";
import { log } from "@/utils/log";
import { inboxCreate } from "@/modules/inboxCreate";
import { normalizeTaskStatusReport } from "@/modules/taskStatusLogic";
import { taskStatusApply } from "@/app/api/task/taskStatusApply";
import { registerSocketEvent } from "./registerSocketEvent";

const taskStatusSchema = z.object({
    taskId: z.string().min(1),
    status: z.enum(["queued", "dispatching", "running", "completed", "failed", "cancelled"]),
    outcome: z.enum(["completed", "failed", "blocked"]).optional(),
    sessionId: z.string().min(1).optional(),
    errorMessage: z.string().optional(),
});



export function taskStatusHandler(socket: Socket, userId: string): void {
    registerSocketEvent({
        socket,
        userId,
        event: "task-status",
        schema: taskStatusSchema,
        module: "task",
        handler: async (data) => {
            const normalized = normalizeTaskStatusReport({
                status: data.status,
                outcome: data.outcome,
            });
            const resolvedStatus = normalized.status;

            const result = await taskStatusApply({
                userId,
                taskId: data.taskId,
                resolvedStatus,
                sessionId: data.sessionId,
                errorMessage: data.errorMessage,
            });

            if (!result.ok) {
                if (result.reason === "not-found") {
                    log(
                        { module: "task", level: "warn" },
                        `task-status: task ${data.taskId} not found for user ${userId}`,
                    );
                } else if (result.reason === "stale") {
                    log(
                        { module: "task", level: "warn" },
                        `task-status: ignored stale transition for ${data.taskId}: ${result.task.status} -> ${resolvedStatus}`,
                    );
                }
                return;
            }

            const updated = result.task;

            // Create inbox item for terminal statuses
            if (result.isTerminal) {
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
                    referenceUrl: updated.sessionId
                        ? `/session/${updated.sessionId}`
                        : `/machine/${updated.machineId}/tasks`,
                    refType: "task",
                    refId: data.taskId,
                    groupKey: `task:${data.taskId}:${resolvedStatus}`,
                });
            }

            log({ module: "task" }, `task-status: task ${data.taskId} → ${resolvedStatus}`);
        },
    });
}
