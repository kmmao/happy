/**
 * roleCollaboration — pure-function collaboration graph builder.
 * No direct DB access; all inputs are passed in.
 */

export interface RoleActivityEntry {
    roleName: string;
    roleType: string;
    activeTasks: number;
    pendingMessages: number;         // unread messages TO this role
    blockedOn: Array<{
        waitingFor: string;          // role name blocked on
        reason: string;              // msgType
        messageId: string;
        relatedGoalId: string | null;
        since: number;               // timestamp ms
    }>;
    pendingHandoffs: number;
    pendingReviews: number;
}

export interface CollaborationSummary {
    roles: RoleActivityEntry[];
    openConflicts: number;
    pendingDecisions: number;
    blockedChains: Array<{ chain: string[]; rootCause: string }>;
}

// ---------------------------------------------------------------------------
// Input shapes (raw DB data)
// ---------------------------------------------------------------------------

export interface RawAgentRole {
    name: string;
    type: string;
}

export interface RawTask {
    roleType: string | null;
    status: string;
}

export interface RawAgentMessage {
    id: string;
    fromRole: string;
    toRole: string | null;
    msgType: string;
    status: string;
    relatedGoalId: string | null;
    createdAt: Date;
}

export interface RawDecision {
    status: string;
}

// ---------------------------------------------------------------------------
// Core builder
// ---------------------------------------------------------------------------

export function buildCollaborationSummary(input: {
    roles: RawAgentRole[];
    tasks: RawTask[];
    messages: RawAgentMessage[];
    decisions: RawDecision[];
}): CollaborationSummary {
    const { roles, tasks, messages, decisions } = input;

    const unresolvedMessages = messages.filter((m) => m.status !== "resolved");

    // Active task count per role
    const activeTasksByRole = new Map<string, number>();
    for (const task of tasks) {
        if (task.roleType && ["dispatching", "queued", "running"].includes(task.status)) {
            activeTasksByRole.set(task.roleType, (activeTasksByRole.get(task.roleType) ?? 0) + 1);
        }
    }

    // Unread messages by toRole
    const pendingByToRole = new Map<string, RawAgentMessage[]>();
    for (const msg of unresolvedMessages) {
        if (msg.toRole && msg.status === "unread") {
            const list = pendingByToRole.get(msg.toRole) ?? [];
            list.push(msg);
            pendingByToRole.set(msg.toRole, list);
        }
    }

    // Build role entries
    const roleEntries: RoleActivityEntry[] = roles.map((role) => {
        const pending = pendingByToRole.get(role.name) ?? [];
        const depBlocked = unresolvedMessages.filter(
            (m) => m.msgType === "dependency_blocked" && m.fromRole === role.name,
        );

        return {
            roleName: role.name,
            roleType: role.type,
            activeTasks: activeTasksByRole.get(role.name) ?? 0,
            pendingMessages: pending.length,
            blockedOn: depBlocked.map((m) => ({
                waitingFor: m.toRole ?? "unknown",
                reason: m.msgType,
                messageId: m.id,
                relatedGoalId: m.relatedGoalId,
                since: m.createdAt.getTime(),
            })),
            pendingHandoffs: pending.filter((m) => m.msgType === "handoff").length,
            pendingReviews: pending.filter((m) => m.msgType === "review_request").length,
        };
    });

    // Blocked chains: transitive follow from dependency_blocked messages
    const blockedChains = buildBlockedChains(unresolvedMessages);

    // Open conflicts
    const openConflicts = unresolvedMessages.filter((m) => m.msgType === "conflict").length;

    // Pending decisions
    const pendingDecisions = decisions.filter((d) => d.status === "pending").length;

    return {
        roles: roleEntries,
        openConflicts,
        pendingDecisions,
        blockedChains,
    };
}

// ---------------------------------------------------------------------------
// Chain detection
// ---------------------------------------------------------------------------

function buildBlockedChains(
    messages: RawAgentMessage[],
): Array<{ chain: string[]; rootCause: string }> {
    const depBlocked = messages.filter(
        (m) => m.msgType === "dependency_blocked" && m.toRole,
    );

    if (depBlocked.length === 0) {
        return [];
    }

    // Build adjacency: fromRole -> toRole for dependency_blocked
    // A role is "root" if it's a toRole that is NOT itself a fromRole
    const fromRoles = new Set(depBlocked.map((m) => m.fromRole));
    const toRoles = new Set(depBlocked.map((m) => m.toRole!));

    // Root causes: toRoles that aren't themselves blocked on something
    const rootCauses = [...toRoles].filter((r) => !fromRoles.has(r));

    // Only trace chains from roles that are NOT themselves a toRole
    // (i.e., the real start of each blocked chain, not mid-chain nodes)
    const chainStarts = [...fromRoles].filter((r) => !toRoles.has(r));
    const chains: Array<{ chain: string[]; rootCause: string }> = [];

    for (const start of chainStarts) {
        const chain = traceChain(start, depBlocked, new Set());
        if (chain.length > 1) {
            const root = rootCauses.find((r) => chain[chain.length - 1] === r)
                ?? chain[chain.length - 1];
            chains.push({ chain, rootCause: root });
        }
    }

    // Deduplicate by chain string
    const seen = new Set<string>();
    return chains.filter((c) => {
        const key = c.chain.join(" → ");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function traceChain(
    start: string,
    messages: RawAgentMessage[],
    visited: Set<string>,
): string[] {
    if (visited.has(start)) {
        return [start]; // cycle guard
    }
    visited.add(start);

    const next = messages.find((m) => m.fromRole === start);
    if (!next?.toRole) {
        return [start];
    }

    return [start, ...traceChain(next.toRole, messages, visited)];
}
