/**
 * Concurrency enforcement for AgentRole task dispatch.
 *
 * Active task statuses that occupy a concurrency slot:
 *   dispatching | running | waiting_decision
 */

import { db } from "@/storage/db";
import { eventRouter, buildTaskTriggerEphemeral } from "@/app/events/eventRouter";
import { log } from "@/utils/log";

const ACTIVE_STATUSES = ["dispatching", "running", "waiting_decision"] as const;

async function countActiveTasksForRole(opts: {
    accountId: string;
    projectId: string;
    roleType: string;
}): Promise<number> {
    return db.task.count({
        where: {
            accountId: opts.accountId,
            projectId: opts.projectId,
            roleType: opts.roleType,
            status: { in: [...ACTIVE_STATUSES] },
        },
    });
}

/**
 * Check how many concurrency slots are available for a role.
 * Returns Infinity if role not found (unlimited).
 */
export async function availableSlotsForRole(opts: {
    accountId: string;
    projectId: string;
    roleType: string;
    alreadyActive?: number; // Optimistic counter for batch dispatches
}): Promise<number> {
    const role = await db.agentRole.findFirst({
        where: {
            accountId: opts.accountId,
            projectId: opts.projectId,
            type: opts.roleType,
            enabled: true,
        },
        select: { maxConcurrency: true },
    });

    if (!role) return Infinity;

    const activeCount = await countActiveTasksForRole(opts);
    return Math.max(0, role.maxConcurrency - activeCount - (opts.alreadyActive ?? 0));
}

/**
 * After a task reaches a terminal or waiting state, dispatch the oldest queued
 * task(s) for the same role if concurrency slots are available.
 */
export async function dispatchQueuedTasksForRole(opts: {
    accountId: string;
    projectId: string;
    roleType: string;
    machineId: string;
}): Promise<void> {
    const { accountId, projectId, roleType, machineId } = opts;

    const role = await db.agentRole.findFirst({
        where: { accountId, projectId, type: roleType, enabled: true },
        select: { maxConcurrency: true, agentType: true, modelOverride: true },
    });

    if (!role) return;

    const activeCount = await countActiveTasksForRole({ accountId, projectId, roleType });
    const slots = role.maxConcurrency - activeCount;
    if (slots <= 0) return;

    const queuedTasks = await db.task.findMany({
        where: { accountId, projectId, roleType, status: "queued" },
        orderBy: { createdAt: "asc" },
        take: slots,
    });

    for (const task of queuedTasks) {
        await db.task.update({
            where: { id: task.id },
            data: { status: "dispatching" },
        });

        eventRouter.emitEphemeral({
            userId: accountId,
            payload: buildTaskTriggerEphemeral({
                taskId: task.id,
                prompt: task.prompt,
                directory: task.directory ?? "",
                priority: task.priority,
                projectId: task.projectId ?? undefined,
                agentType: role.agentType,
                modelOverride: role.modelOverride,
            }),
            recipientFilter: {
                type: "machine-scoped-only",
                machineId: task.machineId ?? machineId,
            },
        });

        log({ module: "concurrency" }, `Dispatched queued task ${task.id} (role=${roleType})`);
    }
}
