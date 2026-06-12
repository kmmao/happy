import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { checkDailyRunLimit, incrementDailyRunCount } from "./supervisorLimits";
import { emitConfiguredSupervisorRunTrigger } from "./supervisorRunTrigger";

const DEFAULT_SCHEDULE_INTERVAL_HOURS = 24;

export interface ScheduledRunRecoveryWindow {
    due: boolean;
    intervalHours: number;
    overdueByMs: number;
    totalDueRuns: number;
    missedRuns: number;
    nextRunAt: Date | null;
}

export function computeScheduledRunRecoveryWindow(input: {
    nextRunAt: Date | null;
    intervalHours: number | null;
    now?: Date;
}): ScheduledRunRecoveryWindow {
    const intervalHours = input.intervalHours ?? DEFAULT_SCHEDULE_INTERVAL_HOURS;
    const intervalMs = intervalHours * 60 * 60 * 1000;
    const now = input.now ?? new Date();

    if (!input.nextRunAt) {
        return {
            due: false,
            intervalHours,
            overdueByMs: 0,
            totalDueRuns: 0,
            missedRuns: 0,
            nextRunAt: null,
        };
    }

    const overdueByMs = now.getTime() - input.nextRunAt.getTime();
    if (overdueByMs < 0) {
        return {
            due: false,
            intervalHours,
            overdueByMs: 0,
            totalDueRuns: 0,
            missedRuns: 0,
            nextRunAt: input.nextRunAt,
        };
    }

    const totalDueRuns = Math.floor(overdueByMs / intervalMs) + 1;
    const missedRuns = Math.max(0, totalDueRuns - 1);

    return {
        due: true,
        intervalHours,
        overdueByMs,
        totalDueRuns,
        missedRuns,
        nextRunAt: new Date(input.nextRunAt.getTime() + totalDueRuns * intervalMs),
    };
}

/**
 * Check for projects that are due for a scheduled supervisor run and trigger them.
 * Called periodically from the machine heartbeat handler (throttled to ~5 min).
 */
export async function checkAndTriggerScheduledRuns(
    machineId: string,
    userId: string,
): Promise<void> {
    const now = new Date();

    const dueProjects = await db.project.findMany({
        where: {
            accountId: userId,
            machineId,
            archived: false,
            supervisorScheduleEnabled: true,
            supervisorNextRunAt: { lte: now },
            supervisorConfig: { not: null },
        },
        select: {
            id: true,
            path: true,
            supervisorMode: true,
            supervisorScheduleIntervalHours: true,
            supervisorEnabledDimensions: true,
            supervisorCustomRules: true,
            supervisorConfig: true,
            supervisorNextRunAt: true,
        },
        orderBy: { supervisorNextRunAt: "asc" },
        take: 50,
    });

    if (dueProjects.length === 0) return;

    for (const project of dueProjects) {
        try {
            const recoveryWindow = computeScheduledRunRecoveryWindow({
                nextRunAt: project.supervisorNextRunAt,
                intervalHours: project.supervisorScheduleIntervalHours,
                now,
            });

            if (!recoveryWindow.due || !recoveryWindow.nextRunAt || !project.supervisorNextRunAt) {
                continue;
            }

            const limitCheck = await checkDailyRunLimit(project.id);
            if (!limitCheck.allowed) {
                log(
                    { module: "supervisor" },
                    `Skipping scheduled run for project ${project.id}: daily limit reached (${limitCheck.currentCount}/${limitCheck.limit})`,
                );
                await db.project.update({
                    where: { id: project.id },
                    data: {
                        supervisorNextRunAt: recoveryWindow.nextRunAt,
                    },
                });
                continue;
            }

            const claimed = await db.$transaction(async (tx) => {
                const existing = await tx.supervisorRun.findFirst({
                    where: {
                        projectId: project.id,
                        accountId: userId,
                        status: { in: ["pending", "running"] },
                    },
                    select: { id: true },
                });

                if (existing) {
                    return { status: "active-run" as const };
                }

                const claim = await tx.project.updateMany({
                    where: {
                        id: project.id,
                        accountId: userId,
                        supervisorScheduleEnabled: true,
                        supervisorNextRunAt: project.supervisorNextRunAt,
                    },
                    data: {
                        supervisorNextRunAt: recoveryWindow.nextRunAt,
                    },
                });

                if (claim.count === 0) {
                    return { status: "already-claimed" as const };
                }

                const run = await tx.supervisorRun.create({
                    data: {
                        projectId: project.id,
                        accountId: userId,
                        trigger: "scheduled",
                        status: "pending",
                    },
                });

                return { status: "claimed" as const, run };
            });

            if (claimed.status !== "claimed") {
                if (claimed.status === "active-run") {
                    log(
                        { module: "supervisor" },
                        `Skipping scheduled run for project ${project.id}: active run exists`,
                    );
                }
                continue;
            }

            await incrementDailyRunCount(project.id);

            const dimensions = project.supervisorEnabledDimensions
                ? project.supervisorEnabledDimensions.split(",").map((d) => d.trim()).filter(Boolean)
                : undefined;

            let maxFindings: number | undefined;
            try {
                const cfg = project.supervisorConfig ? JSON.parse(project.supervisorConfig) : null;
                maxFindings = typeof cfg?.maxFindings === "number" ? cfg.maxFindings : undefined;
            } catch {
                // ignore malformed config and proceed with defaults
            }

            await emitConfiguredSupervisorRunTrigger({
                userId,
                projectId: project.id,
                runId: claimed.run.id,
                trigger: "scheduled",
                machineId,
                repoPath: project.path,
                supervisorConfig: project.supervisorConfig,
                mode: project.supervisorMode ?? undefined,
                dimensions,
                customRules: project.supervisorCustomRules ?? undefined,
                maxFindings,
            });

            log(
                { module: "supervisor" },
                `Triggered scheduled supervisor run ${claimed.run.id} for project ${project.id} (missedRuns=${recoveryWindow.missedRuns}, overdueMs=${recoveryWindow.overdueByMs})`,
            );
        } catch (error) {
            log(
                { module: "supervisor", level: "error" },
                `Failed to trigger scheduled run for project ${project.id}: ${error}`,
            );
        }
    }
}
