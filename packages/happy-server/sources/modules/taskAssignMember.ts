/**
 * Assign a task to the best-matching WorldMember based on role bindings and available capacity.
 *
 * Flow:
 *   1. Find all active WorldMembers who have the suggestedRole in their assignedRoleIds
 *   2. Pick the least busy member (most available slots)
 *   3. If no members have the role → fallback to implicit owner
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";

const ACTIVE_STATUSES = ["dispatching", "running", "waiting_decision"] as const;

export interface MemberAssignment {
    memberId: string | null;    // null = implicit owner (single-user)
    accountId: string;
    maxConcurrency: number;
    availableSlots: number;
    agentType: string | null;   // member-level override
    modelOverride: string | null;
}

/**
 * Find the best member to assign a task to, given a suggested role.
 */
export async function assignMemberForTask(opts: {
    accountId: string;
    projectId: string;
    roleType: string;
    alreadyActive?: number;
}): Promise<MemberAssignment> {
    const { accountId, projectId, roleType } = opts;

    // Find members who have this role in their assignedRoleIds
    const allMembers = await db.worldMember.findMany({
        where: {
            projectId,
            availability: { not: "away" },
        },
        select: {
            id: true,
            accountId: true,
            maxConcurrency: true,
            assignedRoleIds: true,
            availability: true,
            delegateTo: true,
            agentType: true,
            modelOverride: true,
        },
    });

    // Filter to members who have this roleType bound
    const candidates = allMembers.filter((m) => {
        let roleIds: string[] = [];
        try { roleIds = JSON.parse(m.assignedRoleIds); } catch { /* empty */ }
        // Match by role ID or role type name (flexible matching)
        return roleIds.includes(roleType) || roleIds.some((id) => id === roleType);
    });

    // Also check by role type → role ID mapping if roles are bound by ID
    if (candidates.length === 0) {
        // Try matching by role type: find the AgentRole.id for this roleType, then check members
        const role = await db.agentRole.findFirst({
            where: { accountId, projectId, type: roleType, enabled: true },
            select: { id: true },
        });

        if (role) {
            const byId = allMembers.filter((m) => {
                let roleIds: string[] = [];
                try { roleIds = JSON.parse(m.assignedRoleIds); } catch { /* empty */ }
                return roleIds.includes(role.id);
            });
            if (byId.length > 0) {
                return pickLeastBusy(byId, opts.alreadyActive);
            }
        }
    }

    if (candidates.length > 0) {
        return pickLeastBusy(candidates, opts.alreadyActive);
    }

    // No members with this role → fallback to implicit owner
    log({ module: "task-assign" }, `No member with role "${roleType}" in project ${projectId}, using implicit owner`);

    const implicitActive = await db.task.count({
        where: { accountId, projectId, assignedMemberId: null, status: { in: [...ACTIVE_STATUSES] } },
    });

    return {
        memberId: null,
        accountId,
        maxConcurrency: 10,
        availableSlots: Math.max(0, 10 - implicitActive - (opts.alreadyActive ?? 0)),
        agentType: null,
        modelOverride: null,
    };
}

async function pickLeastBusy(
    members: Array<{
        id: string;
        accountId: string;
        maxConcurrency: number;
        agentType: string | null;
        modelOverride: string | null;
        availability: string;
        delegateTo: string | null;
    }>,
    alreadyActive?: number,
): Promise<MemberAssignment> {
    // Count active tasks per member in one query
    const memberIds = members.map((m) => m.id);
    const activeCounts = await db.task.groupBy({
        by: ["assignedMemberId"],
        where: {
            assignedMemberId: { in: memberIds },
            status: { in: [...ACTIVE_STATUSES] },
        },
        _count: true,
    });

    const countMap = new Map(activeCounts.map((c) => [c.assignedMemberId, c._count]));

    // Build availability map for all members (including "delegate")
    const allScored = members.map((m) => {
        const active = countMap.get(m.id) ?? 0;
        const available = Math.max(0, m.maxConcurrency - active);
        return { ...m, active, available };
    });

    // Prefer active members, sorted by available slots (higher = better)
    const scored = allScored
        .filter((m) => m.availability === "active")
        .sort((a, b) => b.available - a.available);

    let best = scored[0];
    if (!best) {
        // No active members — try resolving delegates
        const delegating = allScored.filter((m) => m.availability === "delegate" && m.delegateTo);
        for (const d of delegating) {
            const target = allScored.find((m) => m.id === d.delegateTo && m.availability === "active");
            if (target && target.available > 0) {
                best = target;
                break;
            }
        }
    }

    if (!best) {
        // All members away/busy — pick any member (they'll get notified)
        const fallback = allScored[0] ?? members[0];
        const active = countMap.get(fallback.id) ?? 0;
        return {
            memberId: fallback.id,
            accountId: fallback.accountId,
            maxConcurrency: fallback.maxConcurrency,
            availableSlots: Math.max(0, fallback.maxConcurrency - active - (alreadyActive ?? 0)),
            agentType: fallback.agentType,
            modelOverride: fallback.modelOverride,
        };
    }

    // Follow delegation chain on best candidate (max 3 hops, symmetric with decisionRoute)
    let hops = 0;
    while (best.availability === "delegate" && best.delegateTo && hops < 3) {
        const delegate = allScored.find((m) => m.id === best!.delegateTo);
        if (!delegate) break;
        best = delegate;
        hops++;
    }

    return {
        memberId: best.id,
        accountId: best.accountId,
        maxConcurrency: best.maxConcurrency,
        availableSlots: Math.max(0, best.available - (alreadyActive ?? 0)),
        agentType: best.agentType,
        modelOverride: best.modelOverride,
    };
}
