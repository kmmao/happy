/**
 * Resolve the effective WorldMember for a given account+project.
 * When no explicit WorldMember record exists, the project owner
 * gets an implicit "owner" with full permissions (zero-config compat).
 */

import { db } from "@/storage/db";

export interface EffectiveMember {
    id: string | null;          // null for implicit owner
    accountId: string;
    projectId: string;
    displayName: string | null;
    role: string;
    expertise: string[];
    lawAuthority: string;
    decisionScope: string;
    goalAuthority: string;
    notifyLevel: string;
    availability: string;
    delegateTo: string | null;
    isImplicit: boolean;        // true = no WorldMember record, inferred from project ownership
}

const IMPLICIT_OWNER: Omit<EffectiveMember, "accountId" | "projectId"> = {
    id: null,
    displayName: null,
    role: "owner",
    expertise: [],
    lawAuthority: "create",
    decisionScope: "all",
    goalAuthority: "create",
    notifyLevel: "all",
    availability: "active",
    delegateTo: null,
    isImplicit: true,
};

const NO_ACCESS: Omit<EffectiveMember, "accountId" | "projectId"> = {
    id: null,
    displayName: null,
    role: "none",
    expertise: [],
    lawAuthority: "readonly",
    decisionScope: "none",
    goalAuthority: "readonly",
    notifyLevel: "none",
    availability: "active",
    delegateTo: null,
    isImplicit: true,
};

function parseExpertise(raw: string): string[] {
    try { return JSON.parse(raw); } catch { return []; }
}

export async function resolveEffectiveMember(
    accountId: string,
    projectId: string,
): Promise<EffectiveMember> {
    const member = await db.worldMember.findUnique({
        where: { accountId_projectId: { accountId, projectId } },
    });

    if (member) {
        return {
            id: member.id,
            accountId: member.accountId,
            projectId: member.projectId,
            displayName: member.displayName,
            role: member.role,
            expertise: parseExpertise(member.expertise),
            lawAuthority: member.lawAuthority,
            decisionScope: member.decisionScope,
            goalAuthority: member.goalAuthority,
            notifyLevel: member.notifyLevel,
            availability: member.availability,
            delegateTo: member.delegateTo,
            isImplicit: false,
        };
    }

    // No explicit record — check project ownership
    const project = await db.project.findUnique({
        where: { id: projectId },
        select: { accountId: true },
    });

    if (project?.accountId === accountId) {
        return { ...IMPLICIT_OWNER, accountId, projectId };
    }

    return { ...NO_ACCESS, accountId, projectId };
}

/**
 * Check if accountId has at least the given role level on the project.
 * Role hierarchy: owner > admin > member > observer > none
 */
const ROLE_LEVELS: Record<string, number> = {
    none: 0,
    observer: 1,
    member: 2,
    admin: 3,
    owner: 4,
};

export async function requireRole(
    accountId: string,
    projectId: string,
    minRole: string,
): Promise<EffectiveMember> {
    const member = await resolveEffectiveMember(accountId, projectId);
    const memberLevel = ROLE_LEVELS[member.role] ?? 0;
    const requiredLevel = ROLE_LEVELS[minRole] ?? 0;

    if (memberLevel < requiredLevel) {
        throw Object.assign(
            new Error(`Insufficient role: need ${minRole}, have ${member.role}`),
            { statusCode: 403 },
        );
    }

    return member;
}
