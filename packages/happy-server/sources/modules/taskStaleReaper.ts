/**
 * Server-side safety net: periodically reap tasks stuck in non-terminal states.
 *
 * Covers two failure modes the CLI watchdog cannot:
 *   1. CLI daemon was offline / restarted and never reported back
 *   2. Socket "task-status" event was lost (fire-and-forget, no ACK)
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { goalProgressUpdate } from "./goalProgressUpdate";
import { eventRouter, buildTaskStatusChangedEphemeral } from "@/app/events/eventRouter";
import { inboxCreate } from "./inboxCreate";
import { worldSuggestionRefresh } from "./worldSuggestionGenerate";

const REAP_INTERVAL_MS = 5 * 60_000; // 5 minutes
const RUNNING_TIMEOUT_MS = parseInt(process.env.TASK_RUNNING_TIMEOUT_MS ?? `${60 * 60_000}`, 10); // 60 min
const DISPATCHING_TIMEOUT_MS = parseInt(process.env.TASK_DISPATCHING_TIMEOUT_MS ?? `${10 * 60_000}`, 10); // 10 min

let timer: ReturnType<typeof setInterval> | null = null;

async function reapStaleTasks(): Promise<void> {
    const now = new Date();

    try {
        const staleRunning = await db.task.findMany({
            where: {
                status: "running",
                updatedAt: { lt: new Date(now.getTime() - RUNNING_TIMEOUT_MS) },
            },
            select: { id: true, machineId: true, accountId: true, projectId: true, goalId: true, title: true },
        });

        const staleDispatching = await db.task.findMany({
            where: {
                status: "dispatching",
                createdAt: { lt: new Date(now.getTime() - DISPATCHING_TIMEOUT_MS) },
            },
            select: { id: true, machineId: true, accountId: true, projectId: true, goalId: true, title: true },
        });

        const staleTasks = [
            ...staleRunning.map((t) => ({ ...t, reason: "running" as const })),
            ...staleDispatching.map((t) => ({ ...t, reason: "dispatching" as const })),
        ];

        if (staleTasks.length === 0) return;

        log(
            { module: "task-reaper" },
            `Reaping ${staleTasks.length} stale tasks (${staleRunning.length} running, ${staleDispatching.length} dispatching)`,
        );

        for (const task of staleTasks) {
            const errorMessage =
                task.reason === "running"
                    ? `Server timeout: task exceeded ${Math.round(RUNNING_TIMEOUT_MS / 60_000)}m running limit`
                    : `Server timeout: task stuck in dispatching for ${Math.round(DISPATCHING_TIMEOUT_MS / 60_000)}m`;

            await db.task.update({
                where: { id: task.id },
                data: {
                    status: "failed",
                    errorMessage,
                    completedAt: now,
                },
            });

            eventRouter.emitEphemeral({
                userId: task.accountId,
                payload: buildTaskStatusChangedEphemeral({
                    taskId: task.id,
                    machineId: task.machineId,
                    status: "failed",
                    errorMessage,
                    completedAt: now.getTime(),
                }),
                recipientFilter: { type: "user-scoped-only" },
            });

            const taskLabel = task.title ?? `Task ${task.id.slice(-6)}`;
            void inboxCreate({
                accountId: task.accountId,
                category: "task",
                eventType: "task.failed",
                severity: "error",
                title: `${taskLabel}: timed out`,
                body: errorMessage,
                refType: "task",
                refId: task.id,
                groupKey: `task:${task.id}:failed`,
            });

            if (task.goalId) {
                void goalProgressUpdate({
                    goalId: task.goalId,
                    accountId: task.accountId,
                });
            }
            if (task.projectId) {
                void worldSuggestionRefresh(task.accountId, task.projectId);
            }
        }
    } catch (err) {
        log({ module: "task-reaper", level: "error" }, `Reaper error: ${err}`);
    }
}

export function startTaskStaleReaper(): void {
    timer = setInterval(() => {
        void reapStaleTasks();
    }, REAP_INTERVAL_MS);
    timer.unref();
    log(
        { module: "task-reaper" },
        `Stale task reaper started (interval: ${REAP_INTERVAL_MS / 1000}s, running timeout: ${RUNNING_TIMEOUT_MS / 60_000}m, dispatching timeout: ${DISPATCHING_TIMEOUT_MS / 60_000}m)`,
    );
}

export function stopTaskStaleReaper(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    log({ module: "task-reaper" }, "Stale task reaper stopped");
}
