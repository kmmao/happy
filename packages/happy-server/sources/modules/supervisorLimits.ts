import { db } from "@/storage/db";

/**
 * Server-enforced hard limit on daily supervisor runs per project.
 * Can be overridden via MAX_DAILY_SUPERVISOR_RUNS env var.
 */
const MAX_DAILY_SUPERVISOR_RUNS = Math.max(
    1,
    parseInt(process.env.MAX_DAILY_SUPERVISOR_RUNS ?? "5", 10) || 5,
);

/**
 * Check whether a project is allowed another supervisor run today.
 * Automatically resets the counter if the reset timestamp is stale (past UTC midnight).
 */
export async function checkDailyRunLimit(
    projectId: string,
): Promise<{ allowed: boolean; currentCount: number; limit: number }> {
    const project = await db.project.findUnique({
        where: { id: projectId },
        select: {
            supervisorDailyRunCount: true,
            supervisorDailyRunCountResetAt: true,
        },
    });

    if (!project) {
        return { allowed: false, currentCount: 0, limit: MAX_DAILY_SUPERVISOR_RUNS };
    }

    const todayStart = getUtcMidnight();
    let currentCount = project.supervisorDailyRunCount;

    // Reset counter if it's a new day
    if (
        !project.supervisorDailyRunCountResetAt ||
        project.supervisorDailyRunCountResetAt < todayStart
    ) {
        await db.project.update({
            where: { id: projectId },
            data: {
                supervisorDailyRunCount: 0,
                supervisorDailyRunCountResetAt: todayStart,
            },
        });
        currentCount = 0;
    }

    return {
        allowed: currentCount < MAX_DAILY_SUPERVISOR_RUNS,
        currentCount,
        limit: MAX_DAILY_SUPERVISOR_RUNS,
    };
}

/**
 * Atomically increment the daily run count for a project.
 */
export async function incrementDailyRunCount(
    projectId: string,
): Promise<void> {
    const todayStart = getUtcMidnight();

    await db.project.update({
        where: { id: projectId },
        data: {
            supervisorDailyRunCount: { increment: 1 },
            supervisorDailyRunCountResetAt: todayStart,
        },
    });
}

function getUtcMidnight(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
