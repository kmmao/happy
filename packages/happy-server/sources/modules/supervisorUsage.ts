import { db } from "@/storage/db";
import { log } from "@/utils/log";

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

/**
 * Schedule delayed re-aggregation attempts to capture turn-end cost reports
 * that arrive after the supervisor run is marked as completed.
 * Uses a chained approach: each attempt only schedules the next one if cost
 * was not yet captured, avoiding unnecessary DB queries.
 */
export function scheduleDelayedCostAggregation(
    runId: string,
    sessionId: string,
): void {
    const delays = [15_000, 30_000, 60_000];
    scheduleNextAttempt(runId, sessionId, delays);
}

function scheduleNextAttempt(
    runId: string,
    sessionId: string,
    remainingDelays: readonly number[],
): void {
    if (remainingDelays.length === 0) return;
    const [current, ...rest] = remainingDelays;

    setTimeout(async () => {
        try {
            const run = await db.supervisorRun.findUnique({
                where: { id: runId },
                select: { costUsd: true },
            });
            if (run?.costUsd && run.costUsd > 0) return;

            const usage = await aggregateSessionUsage(sessionId);
            if (usage && usage.totalCostUsd > 0) {
                await db.supervisorRun.update({
                    where: { id: runId },
                    data: {
                        tokenCount: usage.totalTokens,
                        costUsd: usage.totalCostUsd,
                    },
                });
                log(
                    { module: "supervisor" },
                    `Delayed cost aggregation (${current}ms): run ${runId} → $${usage.totalCostUsd}`,
                );
                return;
            }

            scheduleNextAttempt(runId, sessionId, rest);
        } catch {
            scheduleNextAttempt(runId, sessionId, rest);
        }
    }, current);
}
