/**
 * Expire pending Decisions that have passed their expiresAt deadline.
 */

import { db } from "@/storage/db";
import { inboxCreate } from "./inboxCreate";
import { log } from "@/utils/log";
import { truncateText, TEXT_LIMITS } from "./worldConstants";
import { worldSuggestionRefresh } from "./worldSuggestionGenerate";

export async function expireDecisions(): Promise<number> {
    const now = new Date();

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
