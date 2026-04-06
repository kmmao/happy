/**
 * Calculate the autonomy score for a project.
 * Score = 1 - (pending_decisions / total_decisions_30d)
 * Returns 0-100 integer. When no decisions exist, returns null (N/A).
 */

import { db } from "@/storage/db";

export interface AutonomyData {
    score: number | null;   // 0-100, null when no decisions
    total30d: number;
    pending30d: number;
    decided30d: number;
    autoResolved30d: number;
    expired30d: number;
}

export async function autonomyScore(projectId: string, accountId: string): Promise<AutonomyData> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const decisions = await db.decision.groupBy({
        by: ["status"],
        where: {
            accountId,
            projectId,
            createdAt: { gte: cutoff },
        },
        _count: true,
    });

    let total30d = 0;
    let pending30d = 0;
    let decided30d = 0;
    let autoResolved30d = 0;
    let expired30d = 0;

    for (const group of decisions) {
        const count = group._count;
        total30d += count;
        switch (group.status) {
            case "pending":
                pending30d = count;
                break;
            case "decided":
                decided30d = count;
                break;
            case "auto_resolved":
                autoResolved30d = count;
                break;
            case "expired":
                expired30d = count;
                break;
        }
    }

    const score = total30d === 0
        ? null
        : Math.round((1 - pending30d / total30d) * 100);

    return { score, total30d, pending30d, decided30d, autoResolved30d, expired30d };
}
