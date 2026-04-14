/**
 * Expire pending Decisions that have passed their expiresAt deadline.
 */

import { db } from "@/storage/db";
import { inboxCreate } from "./inboxCreate";
import { log } from "@/utils/log";
import { truncateText, TEXT_LIMITS, TIME_MS } from "./worldConstants";
import { worldSuggestionRefresh } from "./worldSuggestionGenerate";
import { reassignDecision } from "./decisionRoute";

/**
 * Reassign stale pending Decisions before expiring them.
 *
 * Flow:
 * 1. If a decision has an assignedTo and is >50% through its TTL → try reassign to next member
 * 2. If fully expired → mark as expired
 */
export async function expireDecisions(): Promise<number> {
    const now = new Date();

    // Phase 1: Reassign stale decisions (>50% TTL elapsed, still assigned)
    await reassignStaleDecisions(now);

    // Phase 2: Expire fully expired decisions
    const expiring = await db.decision.findMany({
        where: {
            status: "pending",
            expiresAt: { lte: now },
        },
        select: { id: true, accountId: true, projectId: true, question: true },
        take: 100,
    });

    if (expiring.length === 0) return 0;

    await db.decision.updateMany({
        where: {
            id: { in: expiring.map((d) => d.id) },
            status: "pending",
        },
        data: { status: "expired" },
    });

    // Notify for each expired decision
    for (const d of expiring) {
        void inboxCreate({
            accountId: d.accountId,
            category: "decision",
            eventType: "decision.expired",
            severity: "info",
            title: `Decision expired: ${truncateText(d.question, TEXT_LIMITS.DECISION_QUESTION)}`,
            referenceUrl: `/decision/${d.id}`,
            refType: "decision",
            refId: d.id,
            groupKey: `decision:${d.id}:expired`,
        });
        void worldSuggestionRefresh(d.accountId, d.projectId);
    }

    log({ module: "decision" }, `Expired ${expiring.length} decisions`);
    return expiring.length;
}

/**
 * Find decisions that are >50% through their TTL and still assigned to one person.
 * Try to reassign to the next available member who hasn't seen it yet.
 */
async function reassignStaleDecisions(now: Date): Promise<void> {
    const halfTtl = TIME_MS.DAY / 2; // 12 hours
    const staleThreshold = new Date(now.getTime() - halfTtl);

    const stale = await db.decision.findMany({
        where: {
            status: "pending",
            assignedTo: { not: null },
            createdAt: { lte: staleThreshold },
            expiresAt: { gt: now }, // Not yet expired
        },
        select: {
            id: true,
            projectId: true,
            assignedTo: true,
            assignHistory: true,
            question: true,
            context: true,
            accountId: true,
        },
        take: 50,
    });

    for (const d of stale) {
        try {
            let history: Array<{ memberId: string }> = [];
            try { history = JSON.parse(d.assignHistory); } catch { /* empty */ }

            const alreadyAssigned = new Set(history.map((h) => h.memberId));
            if (d.assignedTo) alreadyAssigned.add(d.assignedTo);

            // Find next candidate who hasn't been assigned yet
            const candidates = await db.worldMember.findMany({
                where: {
                    projectId: d.projectId,
                    availability: "active",
                    decisionScope: { not: "none" },
                    id: { notIn: [...alreadyAssigned] },
                },
                select: { id: true, accountId: true, role: true },
                orderBy: { role: "asc" }, // owner/admin first
            });

            if (candidates.length === 0) continue;

            // Pick the first candidate (admin-priority)
            const next = candidates.find((c) => c.role === "owner" || c.role === "admin")
                ?? candidates[0];

            await reassignDecision(d.id, next.id, "stale_reassign");

            // Notify the new assignee
            void inboxCreate({
                accountId: next.accountId,
                category: "decision",
                eventType: "decision.reassigned",
                severity: "warning",
                title: `Decision reassigned: ${truncateText(d.question, TEXT_LIMITS.DECISION_QUESTION)}`,
                referenceUrl: `/decision/${d.id}`,
                refType: "decision",
                refId: d.id,
                groupKey: `decision:${d.id}:reassigned:${next.id}`,
            });

            log({ module: "decision" }, `Reassigned stale decision ${d.id} → member ${next.id}`);
        } catch (err) {
            log({ module: "decision", level: "error" }, `Failed to reassign stale decision ${d.id}: ${err}`);
        }
    }
}
