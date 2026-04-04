import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { log } from "@/utils/log";
import {
    eventRouter,
    buildTaskTriggerEphemeral,
} from "@/app/events/eventRouter";
import { CronExpressionParser } from "cron-parser";

/**
 * Compute next run time from a cron expression, starting after `currentDate`.
 */
function computeNextRunAt(cronExpression: string, currentDate: Date): Date | null {
    try {
        const interval = CronExpressionParser.parse(cronExpression, { currentDate });
        return interval.next().toDate();
    } catch {
        return null;
    }
}

/**
 * Check for TriggerSchedules that are due and create Tasks.
 * Called from the machine heartbeat handler (throttled to ~5 min).
 * Uses optimistic locking on nextRunAt to prevent duplicate task creation.
 */
export async function checkAndTriggerSchedules(
    machineId: string,
    userId: string,
): Promise<void> {
    const now = new Date();

    const dueSchedules = await db.triggerSchedule.findMany({
        where: {
            accountId: userId,
            machineId,
            enabled: true,
            nextRunAt: { lte: now },
        },
        orderBy: { nextRunAt: "asc" },
        take: 20,
    });

    if (dueSchedules.length === 0) return;

    for (const schedule of dueSchedules) {
        try {
            if (!schedule.nextRunAt) continue;

            const nextRunAt = computeNextRunAt(schedule.cronExpression, now);
            if (!nextRunAt) {
                log(
                    { module: "trigger", level: "error" },
                    `Invalid cron expression for schedule ${schedule.id}: ${schedule.cronExpression}`,
                );
                continue;
            }

            // Resolve project directory (read-only, outside transaction)
            let directory = "~";
            let resolvedProjectId: string | null = null;
            if (schedule.projectId) {
                const project = await db.project.findFirst({
                    where: { id: schedule.projectId, accountId: userId },
                    select: { id: true, path: true },
                });
                if (project) {
                    directory = project.path;
                    resolvedProjectId = project.id;
                }
            }

            // Load skills (read-only, outside transaction)
            let skillContents: Array<{ name: string; content: string }> | undefined;
            const skillIds: string[] = safeParseJsonArray(schedule.skillIds);
            if (skillIds.length > 0) {
                const skills = await db.skill.findMany({
                    where: {
                        id: { in: skillIds },
                        accountId: userId,
                        archived: false,
                    },
                    orderBy: { name: "asc" },
                });
                if (skills.length > 0) {
                    skillContents = skills.map((s) => ({
                        name: s.name,
                        content: s.content,
                    }));
                }
            }

            // Claim schedule + create task + update lastTaskId in a single transaction
            const result = await inTx(async (tx) => {
                // Optimistic lock: claim this schedule by advancing nextRunAt
                const claim = await tx.triggerSchedule.updateMany({
                    where: {
                        id: schedule.id,
                        nextRunAt: schedule.nextRunAt,
                    },
                    data: {
                        nextRunAt,
                        lastRunAt: now,
                        runCount: { increment: 1 },
                    },
                });

                if (claim.count === 0) {
                    return { status: "already-claimed" as const };
                }

                const task = await tx.task.create({
                    data: {
                        accountId: userId,
                        projectId: resolvedProjectId,
                        machineId,
                        prompt: schedule.prompt,
                        priority: schedule.priority,
                        maxAttempts: 3,
                        triggerType: "cron",
                        triggerRef: schedule.id,
                        status: "dispatching",
                        ...(skillIds.length > 0
                            ? {
                                  skillBindings: {
                                      create: skillIds.map((sid, idx) => ({
                                          skillId: sid,
                                          order: idx,
                                      })),
                                  },
                              }
                            : {}),
                    },
                });

                await tx.triggerSchedule.update({
                    where: { id: schedule.id },
                    data: { lastTaskId: task.id },
                });

                return { status: "claimed" as const, task };
            });

            if (result.status !== "claimed") {
                continue;
            }

            const { task } = result;

            // Dispatch to CLI daemon via ephemeral
            eventRouter.emitEphemeral({
                userId,
                payload: buildTaskTriggerEphemeral({
                    taskId: task.id,
                    prompt: schedule.prompt,
                    directory,
                    priority: schedule.priority,
                    projectId: resolvedProjectId ?? undefined,
                    skillContents,
                }),
                recipientFilter: {
                    type: "machine-scoped-only",
                    machineId,
                },
            });

            log(
                { module: "trigger" },
                `Cron schedule ${schedule.id} triggered task ${task.id} (runCount=${schedule.runCount + 1})`,
            );
        } catch (error) {
            log(
                { module: "trigger", level: "error" },
                `Failed to trigger schedule ${schedule.id}: ${error}`,
            );
        }
    }
}

function safeParseJsonArray(json: string): string[] {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
