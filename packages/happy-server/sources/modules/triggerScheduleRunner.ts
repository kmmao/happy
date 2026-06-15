import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { log } from "@/utils/log";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { emitSyncUpdate } from "@/app/events/syncUpdate";
import { CronExpressionParser } from "cron-parser";
import { inboxCreate } from "./inboxCreate";
import {
    isUnifiedRuntimeProfileResolverEnabled,
    notifyRuntimeProfileFailure,
    resolveRuntimeProfile,
} from "./runtimeProfileResolver";

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled"]);

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

    const lastTaskIds = dueSchedules
        .map((s) => s.lastTaskId)
        .filter((id): id is string => id != null);

    const projectIds = [
        ...new Set(
            dueSchedules
                .map((s) => s.projectId)
                .filter((id): id is string => id != null),
        ),
    ];

    const allSkillIds = [
        ...new Set(
            dueSchedules.flatMap((s) => safeParseJsonArray(s.skillIds)),
        ),
    ];

    const [lastTasks, projects, skills] = await Promise.all([
        lastTaskIds.length > 0
            ? db.task.findMany({
                  where: { id: { in: lastTaskIds } },
                  select: { id: true, status: true },
              })
            : Promise.resolve([]),
        projectIds.length > 0
            ? db.project.findMany({
                  where: { id: { in: projectIds }, accountId: userId },
                  select: { id: true, path: true, supervisorConfig: true },
              })
            : Promise.resolve([]),
        allSkillIds.length > 0
            ? db.skill.findMany({
                  where: {
                      id: { in: allSkillIds },
                      accountId: userId,
                      archived: false,
                  },
                  select: { id: true, name: true, content: true },
              })
            : Promise.resolve([]),
    ]);

    const taskStatusMap = new Map(lastTasks.map((t) => [t.id, t.status]));
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const skillMap = new Map(skills.map((s) => [s.id, s]));

    for (const schedule of dueSchedules) {
        try {
            if (!schedule.nextRunAt) continue;

            if (schedule.lastTaskId) {
                const lastTaskStatus = taskStatusMap.get(schedule.lastTaskId);
                if (lastTaskStatus && !TERMINAL_TASK_STATUSES.has(lastTaskStatus)) {
                    log(
                        { module: "trigger" },
                        `Skipping schedule ${schedule.id}: last task ${schedule.lastTaskId} still ${lastTaskStatus}`,
                    );
                    continue;
                }
            }

            const nextRunAt = computeNextRunAt(schedule.cronExpression, now);
            if (!nextRunAt) {
                log(
                    { module: "trigger", level: "error" },
                    `Invalid cron expression for schedule ${schedule.id}: ${schedule.cronExpression}`,
                );
                continue;
            }

            let directory = "~";
            let resolvedProjectId: string | null = null;
            let projectSupervisorConfig: string | null = null;
            if (schedule.projectId) {
                const project = projectMap.get(schedule.projectId);
                if (project) {
                    directory = project.path;
                    resolvedProjectId = project.id;
                    projectSupervisorConfig = project.supervisorConfig ?? null;
                }
            }

            // Resolve the runtime profile before claiming the schedule so a
            // missing / archived / corrupt binding surfaces as an operator
            // notification instead of a silently-spawned session using stale
            // env defaults. Disabled path (`RUNTIME_PROFILE_UNIFIED_RESOLVER=false`)
            // keeps the legacy "no runtimeProfile in payload" behavior.
            let resolvedProfileId: string | undefined;
            let resolvedRuntimeProfile:
                | Awaited<ReturnType<typeof resolveRuntimeProfile>>
                | null = null;
            if (isUnifiedRuntimeProfileResolverEnabled()) {
                resolvedRuntimeProfile = await resolveRuntimeProfile({
                    accountId: userId,
                    explicitProfileId: schedule.profileId,
                    projectSupervisorConfig,
                    purpose: "cron",
                });
                if (!resolvedRuntimeProfile.ok) {
                    notifyRuntimeProfileFailure({
                        accountId: userId,
                        purpose: "cron",
                        failure: resolvedRuntimeProfile,
                        referenceUrl: `/machine/${machineId}/tasks`,
                        refType: "triggerSchedule",
                        refId: schedule.id,
                    });
                    continue;
                }
                resolvedProfileId = resolvedRuntimeProfile.profileId;
            }

            let skillContents: Array<{ name: string; content: string }> | undefined;
            const skillIds: string[] = safeParseJsonArray(schedule.skillIds);
            if (skillIds.length > 0) {
                const resolved = skillIds
                    .map((sid) => skillMap.get(sid))
                    .filter((s): s is NonNullable<typeof s> => s != null);
                if (resolved.length > 0) {
                    skillContents = resolved.map((s) => ({
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
                        profileId: resolvedProfileId,
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

            // Dispatch to CLI daemon via ephemeral.
            await emitSyncEphemeral(userId, {
                t: "task-trigger",
                machineId,
                taskId: task.id,
                prompt: schedule.prompt,
                directory,
                priority: schedule.priority,
                projectId: resolvedProjectId ?? undefined,
                skillContents,
                profileId: resolvedProfileId,
                runtimeProfile:
                    resolvedRuntimeProfile?.ok
                        ? resolvedRuntimeProfile.runtimeProfile
                        : undefined,
            });

            void inboxCreate({
                accountId: userId,
                category: "trigger",
                eventType: "trigger.cron_fired",
                severity: "info",
                title: `Cron schedule fired`,
                body: schedule.name ?? schedule.cronExpression,
                referenceUrl: `/machine/${machineId}/tasks`,
                refType: "triggerSchedule",
                refId: schedule.id,
                groupKey: `schedule:${schedule.id}:triggered`,
                skipPush: true,
            });

            log(
                { module: "trigger" },
                `Cron schedule ${schedule.id} triggered task ${task.id} (runCount=${schedule.runCount + 1})`,
            );

            // Phase C — real-time push to App's useWorkflows so the
            // Scheduled Workflow card updates lastRunAt/runCount/nextRunAt
            // the moment the cron fires. Without this the App would only
            // see the change on its next 30 s poll (which we're removing
            // in this PR). Reload the row from db to get the post-claim
            // shape, then emit the same wire form the route returns.
            const fresh = await db.triggerSchedule.findUnique({
                where: { id: schedule.id },
            });
            if (fresh) {
                await emitSyncUpdate(userId, {
                    t: "trigger-schedule-updated",
                    schedule: serializeTriggerScheduleForSync(fresh),
                });
            }
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

/**
 * Wire shape used by the `trigger-schedule-updated` SyncUpdate body.
 * Mirrors the App's `ServerTriggerSchedule` interface (apiTriggerSchedules.ts)
 * field-for-field — keep them in sync if either side adds fields.
 *
 * Date columns are serialized to epoch ms so the App can treat them
 * identically to its periodic REST fetches.
 */
function serializeTriggerScheduleForSync(s: Record<string, any>): Record<string, any> {
    return {
        id: s.id,
        machineId: s.machineId,
        projectId: s.projectId,
        name: s.name,
        prompt: s.prompt,
        cronExpression: s.cronExpression,
        priority: s.priority,
        skillIds: typeof s.skillIds === "string" ? safeParseJsonArray(s.skillIds) : s.skillIds,
        profileId: s.profileId,
        enabled: s.enabled,
        nextRunAt: s.nextRunAt instanceof Date ? s.nextRunAt.getTime() : s.nextRunAt,
        lastRunAt: s.lastRunAt instanceof Date ? s.lastRunAt.getTime() : s.lastRunAt,
        runCount: s.runCount,
        lastTaskId: s.lastTaskId,
        createdAt: s.createdAt instanceof Date ? s.createdAt.getTime() : s.createdAt,
        updatedAt: s.updatedAt instanceof Date ? s.updatedAt.getTime() : s.updatedAt,
    };
}
