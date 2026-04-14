/**
 * Update a WorldMember's role, expertise, notification preference, or availability.
 */

import { db } from "@/storage/db";

interface WorldMemberUpdateInput {
    memberId: string;
    role?: string;
    displayName?: string | null;
    expertise?: string[];
    maxConcurrency?: number;
    assignedRoleIds?: string[];
    agentType?: string | null;
    modelOverride?: string | null;
    lawAuthority?: string;
    decisionScope?: string;
    goalAuthority?: string;
    notifyLevel?: string;
    availability?: string;
    delegateTo?: string | null;
}

export async function worldMemberUpdate(input: WorldMemberUpdateInput) {
    const data: Record<string, unknown> = {};

    if (input.role !== undefined) data.role = input.role;
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.expertise !== undefined) data.expertise = JSON.stringify(input.expertise);
    if (input.maxConcurrency !== undefined) data.maxConcurrency = input.maxConcurrency;
    if (input.assignedRoleIds !== undefined) data.assignedRoleIds = JSON.stringify(input.assignedRoleIds);
    if (input.agentType !== undefined) data.agentType = input.agentType;
    if (input.modelOverride !== undefined) data.modelOverride = input.modelOverride;
    if (input.lawAuthority !== undefined) data.lawAuthority = input.lawAuthority;
    if (input.decisionScope !== undefined) data.decisionScope = input.decisionScope;
    if (input.goalAuthority !== undefined) data.goalAuthority = input.goalAuthority;
    if (input.notifyLevel !== undefined) data.notifyLevel = input.notifyLevel;
    if (input.availability !== undefined) data.availability = input.availability;
    if (input.delegateTo !== undefined) data.delegateTo = input.delegateTo;

    return await db.worldMember.update({
        where: { id: input.memberId },
        data,
    });
}
