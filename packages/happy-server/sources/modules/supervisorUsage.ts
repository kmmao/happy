import { db } from "@/storage/db";

/**
 * Aggregate token and cost totals from UsageReport records for a given session.
 * Returns { totalTokens, totalCostUsd } or null if no session or no reports.
 */
export async function aggregateSessionUsage(
    sessionId: string | null | undefined,
): Promise<{ totalTokens: number; totalCostUsd: number } | null> {
    if (!sessionId) return null;

    const reports = await db.usageReport.findMany({
        where: { sessionId },
        select: { data: true },
    });

    if (reports.length === 0) return null;

    let totalTokens = 0;
    let totalCostUsd = 0;

    for (const report of reports) {
        const data = report.data as PrismaJson.UsageReportData;
        totalTokens += data.tokens?.total ?? 0;
        totalCostUsd += data.cost?.total ?? 0;
    }

    return {
        totalTokens,
        totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
    };
}
