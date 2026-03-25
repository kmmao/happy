/**
 * Fix historical UsageReport records where cost was stored as cumulative
 * values instead of per-turn deltas.
 *
 * Bug: SDK's total_cost_usd is cumulative since process start, but CLI
 * was sending it as-is to the server. Each turn's cost report contained
 * the TOTAL cost up to that point, not just the cost for that turn.
 * When the server sums all reports, costs are massively overcounted.
 *
 * Fix strategy:
 * 1. For each session, find all "cost reports" (where cost.total > 0)
 *    ordered by createdAt
 * 2. Detect "run boundaries" — when cost drops (new CLI process = reset)
 * 3. Compute delta: report[i].cost - report[i-1].cost (within same run)
 * 4. Update each report to store only its delta
 *
 * Usage:
 *   DRY_RUN=true npx tsx sources/scripts/fixCumulativeCostReports.ts
 *   npx tsx sources/scripts/fixCumulativeCostReports.ts
 */

import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "true";

interface CostData {
    total: number;
    [key: string]: number;
}

interface UsageReportData {
    tokens: { total: number; [key: string]: number };
    cost: CostData;
}

interface ReportRow {
    id: string;
    sessionId: string | null;
    data: UsageReportData;
    createdAt: Date;
}

async function main() {
    console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE — will modify data"}`);
    console.log("---");

    // Find all cost reports (cost.total > 0) grouped by session
    const costReports = await db.$queryRaw<ReportRow[]>`
        SELECT id, "sessionId", data, "createdAt"
        FROM "UsageReport"
        WHERE (data->'cost'->>'total')::double precision > 0
        ORDER BY "sessionId" NULLS LAST, "createdAt" ASC
    `;

    console.log(`Found ${costReports.length} cost reports total`);

    // Group by session
    const bySession = new Map<string, ReportRow[]>();
    for (const report of costReports) {
        const key = report.sessionId ?? "__no_session__";
        const list = bySession.get(key) ?? [];
        list.push(report);
        bySession.set(key, list);
    }

    console.log(`Across ${bySession.size} sessions`);
    console.log("---");

    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalSavings = 0;

    for (const [sessionKey, reports] of bySession) {
        if (reports.length <= 1) {
            // Single report per session — no overcounting possible,
            // but it could still be cumulative from a multi-turn session.
            // We can't distinguish, so leave it as-is.
            totalSkipped += reports.length;
            continue;
        }

        let prevCumulativeCost: CostData = { total: 0 };
        let sessionUpdates = 0;
        let sessionSaved = 0;

        for (let i = 0; i < reports.length; i++) {
            const report = reports[i];
            const currentCost = report.data.cost;

            // Detect run boundary: if current total < previous total,
            // a new CLI process started (cost reset to 0 then built up)
            const isNewRun = currentCost.total < prevCumulativeCost.total;
            if (isNewRun) {
                prevCumulativeCost = { total: 0 };
            }

            // Compute delta for each cost key
            const deltaCost: CostData = { total: 0 };
            for (const [key, value] of Object.entries(currentCost)) {
                if (typeof value !== "number") continue;
                const prevValue = prevCumulativeCost[key] ?? 0;
                deltaCost[key] = Math.max(0, value - prevValue);
            }

            // Check if delta differs from stored value
            const needsUpdate = Math.abs(deltaCost.total - currentCost.total) > 0.0001;

            if (needsUpdate) {
                const saving = currentCost.total - deltaCost.total;
                sessionSaved += saving;

                if (!DRY_RUN) {
                    const updatedData: UsageReportData = {
                        ...report.data,
                        cost: deltaCost,
                    };
                    await db.usageReport.update({
                        where: { id: report.id },
                        data: { data: updatedData as any },
                    });
                }
                sessionUpdates++;
            }

            // Track cumulative for next iteration
            prevCumulativeCost = { ...currentCost };
        }

        if (sessionUpdates > 0) {
            console.log(
                `Session ${sessionKey}: ${sessionUpdates}/${reports.length} reports fixed, saved $${sessionSaved.toFixed(4)}`,
            );
            totalUpdated += sessionUpdates;
            totalSavings += sessionSaved;
        } else {
            totalSkipped += reports.length;
        }
    }

    console.log("---");
    console.log(`Summary:`);
    console.log(`  Reports updated: ${totalUpdated}`);
    console.log(`  Reports skipped: ${totalSkipped}`);
    console.log(`  Overcounted cost removed: $${totalSavings.toFixed(4)}`);

    if (DRY_RUN) {
        console.log("\n⚠️  DRY RUN — no changes were made. Run without DRY_RUN=true to apply.");
    }

    // Also fix SupervisorRun.costUsd which was aggregated from the bad data
    if (!DRY_RUN) {
        console.log("\nRecalculating SupervisorRun cost aggregates...");
        const runsWithSessions = await db.$queryRaw<
            { id: string; sessionId: string }[]
        >`
            SELECT id, "sessionId"
            FROM "SupervisorRun"
            WHERE "sessionId" IS NOT NULL AND "costUsd" > 0
        `;

        let runsFixed = 0;
        for (const run of runsWithSessions) {
            const reports = await db.usageReport.findMany({
                where: { sessionId: run.sessionId },
                select: { data: true },
            });

            let totalCost = 0;
            let totalTokens = 0;
            for (const r of reports) {
                const data = r.data as unknown as UsageReportData;
                totalCost += data.cost?.total ?? 0;
                totalTokens += data.tokens?.total ?? 0;
            }

            await db.supervisorRun.update({
                where: { id: run.id },
                data: {
                    costUsd: Math.round(totalCost * 10000) / 10000,
                    tokenCount: totalTokens,
                },
            });
            runsFixed++;
        }
        console.log(`  SupervisorRun records recalculated: ${runsFixed}`);
    }

    await db.$disconnect();
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
