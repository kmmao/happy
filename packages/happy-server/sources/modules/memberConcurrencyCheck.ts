/**
 * Member-centric concurrency enforcement.
 * Replaces role-centric roleConcurrencyCheck — capacity belongs to people, not templates.
 *
 * Active task statuses that occupy a concurrency slot:
 *   dispatching | running | waiting_decision
 */

import { db } from "@/storage/db";
import { eventRouter, buildTaskTriggerEphemeral } from "@/app/events/eventRouter";
import { log } from "@/utils/log";

const ACTIVE_STATUSES = ["dispatching", "running", "waiting_decision"] as const;

/** Default concurrency for implicit owner (no explicit WorldMember record) */
const IMPLICIT_OWNER_MAX_CONCURRENCY = 10;

async function countActiveTasksForMember(memberId: string): Promise<number> {
    return db.task.count({
        where: {
            assignedMemberId: memberId,
            status: { in: [...ACTIVE_STATUSES] },
        },
    });
}

/**
 * Count active tasks for implicit owner (no assignedMemberId — legacy tasks).
 */
async function countActiveTasksForImplicitOwner(accountId: string, projectId: string): Promise<number> {
    return db.task.count({
        where: {
            accountId,
            projectId,
            assignedMemberId: null,
            status: { in: [...ACTIVE_STATUSES] },
        },
    });
}

/**
 * Check available slots for a member.
 */
export async function availableSlotsForMember(opts: {
    memberId: string;
    alreadyActive?: number;
}): Promise<number> {
    const member = await db.worldMember.findUnique({
        where: { id: opts.memberId },
        select: { maxConcurrency: true },
    });
    if (!member) return 0;

    const active = await countActiveTasksForMember(opts.memberId);
    return Math.max(0, member.maxConcurrency - active - (opts.alreadyActive ?? 0));
}

/**
 * Check available slots for implicit owner (single-user fallback).
 */
export async function availableSlotsForImplicitOwner(opts: {
    accountId: string;
    projectId: string;
    alreadyActive?: number;
}): Promise<number> {
    const active = await countActiveTasksForImplicitOwner(opts.accountId, opts.projectId);
    return Math.max(0, IMPLICIT_OWNER_MAX_CONCURRENCY - active - (opts.alreadyActive ?? 0));
}

/**
 * After a task completes, dispatch the next queued task(s) for the same member.
 */
export async function dispatchQueuedTasksForMember(opts: {
    memberId: string;
    accountId: string;
    machineId: string;
}): Promise<void> {
    const { memberId, accountId, machineId } = opts;

    const member = await db.worldMember.findUnique({
        where: { id: memberId },
        select: { maxConcurrency: true, agentType: true, modelOverride: true, projectId: true },
    });
    if (!member) return;

    const active = await countActiveTasksForMember(memberId);
    const slots = member.maxConcurrency - active;
    if (slots <= 0) return;

    const queuedTasks = await db.task.findMany({
        where: { assignedMemberId: memberId, status: "queued" },
        orderBy: { createdAt: "asc" },
        take: slots,
    });

    // Batch-load roles for all unique roleTypes to avoid N+1
    const uniqueRoleTypes = [...new Set(queuedTasks.map((t) => t.roleType).filter(Boolean))] as string[];
    const roleMap = new Map<string, { agentType: string | null; modelOverride: string | null }>();
    if (uniqueRoleTypes.length > 0 && (!member.agentType || !member.modelOverride)) {
        const roles = await db.agentRole.findMany({
            where: { accountId, projectId: member.projectId, type: { in: uniqueRoleTypes }, enabled: true },
            select: { type: true, agentType: true, modelOverride: true },
        });
        for (const r of roles) roleMap.set(r.type, { agentType: r.agentType, modelOverride: r.modelOverride });
    }

    for (const task of queuedTasks) {
        // Resolve execution env: member override > role override > null
        const roleCtx = task.roleType ? roleMap.get(task.roleType) : null;
        const agentType = member.agentType ?? roleCtx?.agentType ?? null;
        const modelOverride = member.modelOverride ?? roleCtx?.modelOverride ?? null;

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
                agentType,
                modelOverride,
            }),
            recipientFilter: {
                type: "machine-scoped-only",
                machineId: task.machineId ?? machineId,
            },
        });

        log({ module: "concurrency" }, `Dispatched queued task ${task.id} (member=${memberId})`);
    }
}

/**
 * Dispatch queued tasks for implicit owner (legacy single-user path).
 */
export async function dispatchQueuedTasksForImplicitOwner(opts: {
    accountId: string;
    projectId: string;
    machineId: string;
    roleType?: string;
}): Promise<void> {
    const { accountId, projectId, machineId, roleType } = opts;

    const active = await countActiveTasksForImplicitOwner(accountId, projectId);
    const slots = IMPLICIT_OWNER_MAX_CONCURRENCY - active;
    if (slots <= 0) return;

    const where: Record<string, unknown> = {
        accountId,
        projectId,
        assignedMemberId: null,
        status: "queued",
    };
    if (roleType) where.roleType = roleType;

    const queuedTasks = await db.task.findMany({
        where,
        orderBy: { createdAt: "asc" },
        take: slots,
    });

    // Batch-load roles for all unique roleTypes to avoid N+1
    const implicitRoleTypes = [...new Set(queuedTasks.map((t) => t.roleType).filter(Boolean))] as string[];
    const implicitRoleMap = new Map<string, { agentType: string | null; modelOverride: string | null }>();
    if (implicitRoleTypes.length > 0) {
        const roles = await db.agentRole.findMany({
            where: { accountId, projectId, type: { in: implicitRoleTypes }, enabled: true },
            select: { type: true, agentType: true, modelOverride: true },
        });
        for (const r of roles) implicitRoleMap.set(r.type, { agentType: r.agentType, modelOverride: r.modelOverride });
    }

    for (const task of queuedTasks) {
        const roleCtx = task.roleType ? implicitRoleMap.get(task.roleType) : null;

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
                agentType: roleCtx?.agentType ?? null,
                modelOverride: roleCtx?.modelOverride ?? null,
            }),
            recipientFilter: {
                type: "machine-scoped-only",
                machineId: task.machineId ?? machineId,
            },
        });

        log({ module: "concurrency" }, `Dispatched queued task ${task.id} (implicit owner)`);
    }
}
