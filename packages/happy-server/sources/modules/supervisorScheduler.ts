import { db } from "@/storage/db";
import { log } from "@/utils/log";
import {
    eventRouter,
    buildSupervisorTriggerEphemeral,
} from "@/app/events/eventRouter";
import { checkDailyRunLimit, incrementDailyRunCount } from "./supervisorLimits";

/**
 * Check for projects that are due for a scheduled supervisor run and trigger them.
 * Called periodically from the machine heartbeat handler (throttled to ~5 min).
 */
export async function checkAndTriggerScheduledRuns(
    machineId: string,
    userId: string,
): Promise<void> {
    const now = new Date();

    // Find projects on this machine that are due for a scheduled run
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
        },
        orderBy: { supervisorNextRunAt: "asc" },
        take: 50,
    });

    if (dueProjects.length === 0) return;

    for (const project of dueProjects) {
        try {
            // Check daily run limit
            const limitCheck = await checkDailyRunLimit(project.id);
            if (!limitCheck.allowed) {
                log(
                    { module: "supervisor" },
                    `Skipping scheduled run for project ${project.id}: daily limit reached (${limitCheck.currentCount}/${limitCheck.limit})`,
                );
                // Push nextRunAt forward to avoid re-checking every 5 min
                const intervalHours = project.supervisorScheduleIntervalHours ?? 24;
                await db.project.update({
                    where: { id: project.id },
                    data: {
                        supervisorNextRunAt: new Date(
                            now.getTime() + intervalHours * 60 * 60 * 1000,
                        ),
                    },
                });
                continue;
            }

            // Check no active run exists (atomically create in transaction)
            let run;
            try {
                run = await db.$transaction(async (tx) => {
                    const existing = await tx.supervisorRun.findFirst({
                        where: {
                            projectId: project.id,
                            accountId: userId,
                            status: { in: ["pending", "running"] },
                        },
                        select: { id: true },
                    });

                    if (existing) return null;

                    return tx.supervisorRun.create({
                        data: {
                            projectId: project.id,
                            accountId: userId,
                            trigger: "scheduled",
                            status: "pending",
                        },
                    });
                });
            } catch {
                continue;
            }

            if (!run) {
                log(
                    { module: "supervisor" },
                    `Skipping scheduled run for project ${project.id}: active run exists`,
                );
                continue;
            }

            // Increment daily count
            await incrementDailyRunCount(project.id);

            // Atomically advance nextRunAt to prevent duplicate triggers
            const intervalHours = project.supervisorScheduleIntervalHours ?? 24;
            await db.project.update({
                where: { id: project.id },
                data: {
                    supervisorNextRunAt: new Date(
                        now.getTime() + intervalHours * 60 * 60 * 1000,
                    ),
                },
            });

            // Emit trigger event to CLI daemon
            const dimensions = project.supervisorEnabledDimensions
                ? project.supervisorEnabledDimensions.split(",").map((d) => d.trim()).filter(Boolean)
                : undefined;

            let maxFindings: number | undefined;
            try {
                const cfg = project.supervisorConfig ? JSON.parse(project.supervisorConfig) : null;
                maxFindings = typeof cfg?.maxFindings === "number" ? cfg.maxFindings : undefined;
            } catch { /* ignore */ }

            eventRouter.emitEphemeral({
                userId,
                payload: buildSupervisorTriggerEphemeral({
                    projectId: project.id,
                    runId: run.id,
                    trigger: "scheduled",
                    machineId,
                    repoPath: project.path,
                    mode: project.supervisorMode ?? undefined,
                    dimensions,
                    customRules: project.supervisorCustomRules ?? undefined,
                    maxFindings,
                }),
                recipientFilter: {
                    type: "machine-scoped-only",
                    machineId,
                },
            });

            log(
                { module: "supervisor" },
                `Triggered scheduled supervisor run ${run.id} for project ${project.id}`,
            );
        } catch (error) {
            log(
                { module: "supervisor", level: "error" },
                `Failed to trigger scheduled run for project ${project.id}: ${error}`,
            );
        }
    }
}
