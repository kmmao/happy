/**
 * Create a WorldMember record.
 * When the first member is invited, auto-creates an "owner" record
 * for the project creator if one doesn't exist yet.
 */

import { db } from "@/storage/db";
import { inboxCreate } from "./inboxCreate";

interface WorldMemberCreateInput {
    accountId: string;          // The user being added
    projectId: string;
    invitedBy: string;          // Account ID of the inviter
    role?: string;              // owner | admin | member | observer — default: member
    displayName?: string;
    expertise?: string[];
    // Optional overrides — if omitted, role-based defaults apply
    lawAuthority?: string;
    decisionScope?: string;
    goalAuthority?: string;
    notifyLevel?: string;
    availability?: string;
    maxConcurrency?: number;
    assignedRoleIds?: string[];
}

interface WorldMemberRecord {
    id: string;
    accountId: string;
    projectId: string;
    displayName: string | null;
    role: string;
    expertise: string;
    lawAuthority: string;
    decisionScope: string;
    goalAuthority: string;
    notifyLevel: string;
    availability: string;
    delegateTo: string | null;
    joinedAt: Date;
    updatedAt: Date;
}

const ROLE_DEFAULTS: Record<string, { lawAuthority: string; decisionScope: string; goalAuthority: string; notifyLevel: string }> = {
    owner:    { lawAuthority: "create",   decisionScope: "all",      goalAuthority: "create",  notifyLevel: "all" },
    admin:    { lawAuthority: "create",   decisionScope: "all",      goalAuthority: "create",  notifyLevel: "all" },
    member:   { lawAuthority: "suggest",  decisionScope: "assigned", goalAuthority: "create",  notifyLevel: "assigned" },
    observer: { lawAuthority: "readonly", decisionScope: "none",     goalAuthority: "readonly", notifyLevel: "critical" },
};

export async function worldMemberCreate(input: WorldMemberCreateInput): Promise<WorldMemberRecord> {
    const role = input.role ?? "member";
    const defaults = ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.member;

    // Ensure the inviter has an explicit owner record when first member is added
    const project = await db.project.findUnique({
        where: { id: input.projectId },
        select: { accountId: true },
    });

    if (!project) {
        throw Object.assign(new Error("Project not found"), { statusCode: 404 });
    }

    // Verify the invited account exists
    const account = await db.account.findUnique({
        where: { id: input.accountId },
        select: { id: true, username: true },
    });

    if (!account) {
        throw Object.assign(new Error("Account not found"), { statusCode: 404 });
    }

    // Auto-create owner record for project creator if not yet explicit
    if (project.accountId !== input.accountId) {
        await db.worldMember.upsert({
            where: { accountId_projectId: { accountId: project.accountId, projectId: input.projectId } },
            create: {
                accountId: project.accountId,
                projectId: input.projectId,
                role: "owner",
                ...ROLE_DEFAULTS.owner,
            },
            update: {}, // no-op if already exists
        });
    }

    const member = await db.worldMember.create({
        data: {
            accountId: input.accountId,
            projectId: input.projectId,
            role,
            displayName: input.displayName ?? null,
            expertise: JSON.stringify(input.expertise ?? []),
            lawAuthority: input.lawAuthority ?? defaults.lawAuthority,
            decisionScope: input.decisionScope ?? defaults.decisionScope,
            goalAuthority: input.goalAuthority ?? defaults.goalAuthority,
            notifyLevel: input.notifyLevel ?? defaults.notifyLevel,
            availability: input.availability ?? "active",
            ...(input.maxConcurrency !== undefined ? { maxConcurrency: input.maxConcurrency } : {}),
            ...(input.assignedRoleIds !== undefined ? { assignedRoleIds: JSON.stringify(input.assignedRoleIds) } : {}),
        },
    });

    // Notify the invited user
    void inboxCreate({
        accountId: input.accountId,
        category: "system",
        eventType: "member.added",
        severity: "info",
        title: `You've been added to a project as ${role}`,
        referenceUrl: `/project/${input.projectId}`,
        refType: "project",
        refId: input.projectId,
        groupKey: `member:${member.id}:added`,
    });

    return member;
}
