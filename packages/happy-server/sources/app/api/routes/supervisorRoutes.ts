import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { log } from "@/utils/log";
import { parseAutoApproveSeverities } from "@/modules/supervisorConfig";
import { parseConcurrencyConfig } from "./supervisorRunRoutes";
import { emitConfiguredSupervisorFixTrigger } from "@/modules/supervisorFixTrigger";
import { assertOwnedProject, ownedProject } from "../ownership";

/**
 * Supervisor config and action-reprocessing routes.
 * Run-related routes live in supervisorRunRoutes.ts.
 */
export function supervisorRoutes(app: Fastify) {
    // PATCH /v1/projects/:id/supervisor/config — Update supervisor config
    app.patch(
        "/v1/projects/:id/supervisor/config",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    supervisorConfig: z.string().nullable(),
                    supervisorMode: z
                        .enum(["disabled", "suggest", "semi-auto", "auto"])
                        .optional(),
                    supervisorScheduleEnabled: z.boolean().optional(),
                    supervisorScheduleIntervalHours: z
                        .number()
                        .int()
                        .min(1)
                        .max(168)
                        .optional(),
                    supervisorEnabledDimensions: z.string().max(500).optional(),
                    supervisorPushTriggerEnabled: z.boolean().optional(),
                    supervisorNotifyPrefs: z.string().max(200).nullable().optional(),
                    supervisorCustomRules: z.string().max(2000).nullable().optional(),
                    fixStrategy: z.enum(["direct", "pr"]).nullable().optional(),
                    // ADR-0022 D-1 — autonomous loop discovery. null disables;
                    // 0..100 sets the healthScore threshold above which a
                    // standalone run's completion auto-starts a supervisor
                    // loop. Debounce window between auto-starts is configurable
                    // separately (autoLoopDebounceMinutes). Manual reset via
                    // POST autoloop/reset-debounce.
                    autoLoopHealthThreshold: z.number().int().min(0).max(100).nullable().optional(),
                    // 0..10080 minutes (0 disables debounce; 10080 = 7 days
                    // cap). Default at column level is 1440 (24h).
                    autoLoopDebounceMinutes: z.number().int().min(0).max(10080).optional(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const {
                supervisorConfig,
                supervisorMode,
                supervisorScheduleEnabled,
                supervisorScheduleIntervalHours,
                supervisorEnabledDimensions,
                supervisorPushTriggerEnabled,
                supervisorNotifyPrefs,
                supervisorCustomRules,
                fixStrategy,
                autoLoopHealthThreshold,
                autoLoopDebounceMinutes,
            } = request.body;

            await assertOwnedProject(userId, id);

            // Build update data with plaintext scheduling fields
            const updateData: Prisma.ProjectUpdateInput = {
                supervisorConfig,
                supervisorConfigVersion: { increment: 1 },
            };

            if (supervisorMode !== undefined) {
                updateData.supervisorMode = supervisorMode;
            }
            if (supervisorScheduleEnabled !== undefined) {
                updateData.supervisorScheduleEnabled =
                    supervisorScheduleEnabled;
            }
            if (supervisorScheduleIntervalHours !== undefined) {
                updateData.supervisorScheduleIntervalHours =
                    supervisorScheduleIntervalHours;
            }
            if (supervisorEnabledDimensions !== undefined) {
                updateData.supervisorEnabledDimensions =
                    supervisorEnabledDimensions;
            }
            if (supervisorPushTriggerEnabled !== undefined) {
                updateData.supervisorPushTriggerEnabled =
                    supervisorPushTriggerEnabled;
            }
            if (supervisorNotifyPrefs !== undefined) {
                updateData.supervisorNotifyPrefs = supervisorNotifyPrefs;
            }
            if (supervisorCustomRules !== undefined) {
                updateData.supervisorCustomRules = supervisorCustomRules;
            }
            if (fixStrategy !== undefined) {
                updateData.fixStrategy = fixStrategy;
            }
            if (autoLoopHealthThreshold !== undefined) {
                updateData.autoLoopHealthThreshold = autoLoopHealthThreshold;
            }
            if (autoLoopDebounceMinutes !== undefined) {
                updateData.autoLoopDebounceMinutes = autoLoopDebounceMinutes;
            }

            // Compute nextRunAt when scheduling is enabled/changed
            if (supervisorScheduleEnabled === true) {
                const intervalHours =
                    supervisorScheduleIntervalHours ?? 24;
                updateData.supervisorNextRunAt = new Date(
                    Date.now() + intervalHours * 60 * 60 * 1000,
                );
            } else if (supervisorScheduleEnabled === false) {
                updateData.supervisorNextRunAt = null;
            }

            const updated = await db.project.update({
                where: { id },
                data: updateData,
            });

            return reply.send({
                supervisorConfig: updated.supervisorConfig,
                supervisorConfigVersion: updated.supervisorConfigVersion,
            });
        },
    );

    // POST /v1/projects/:id/supervisor/autoloop/reset-debounce
    // ADR-0022 D-1 follow-up — clears the project's auto-loop cooldown clock
    // so the very next eligible SupervisorRun completion can fire an auto-
    // loop without waiting out the configured window. Useful for testing and
    // for incident response. Idempotent; safe to call when no cooldown is
    // currently active (lastAutoLoopStartedAt is already null).
    app.post(
        "/v1/projects/:id/supervisor/autoloop/reset-debounce",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            const existing = await ownedProject(userId, id);

            await db.project.update({
                where: { id },
                data: { lastAutoLoopStartedAt: null },
            });

            return reply.send({
                ok: true,
                previousLastAutoLoopStartedAt:
                    existing.lastAutoLoopStartedAt?.getTime() ?? null,
            });
        },
    );

    // POST /v1/projects/:id/supervisor/actions/reprocess — Re-process pending actions with current mode
    app.post(
        "/v1/projects/:id/supervisor/actions/reprocess",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    mode: z.enum(["semi-auto", "auto"]),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const { mode } = request.body;

            const project = await ownedProject(userId, id);

            // Parse configured severities from project config
            const severities = parseAutoApproveSeverities(project.supervisorConfig, mode);
            if (severities.length === 0) {
                return reply.send({ approvedCount: 0, remainingPending: 0 });
            }

            // Atomic: check for conflicts + find + approve in a single transaction
            const txResult = await db.$transaction(async (tx) => {
                // Check for active loop
                const activeLoop = await tx.agentLoop.findFirst({
                    where: {
                        projectId: id,
                        accountId: userId,
                        role: "supervisor",
                        status: { in: ["running", "paused"] },
                    },
                    select: { id: true },
                });
                if (activeLoop) {
                    return { conflict: "Cannot reprocess while a loop is active" as const };
                }

                // Check for active run
                const activeRun = await tx.supervisorRun.findFirst({
                    where: {
                        projectId: id,
                        accountId: userId,
                        status: { in: ["pending", "running"] },
                    },
                    select: { id: true },
                });
                if (activeRun) {
                    return { conflict: "Cannot reprocess while a scan is running" as const };
                }

                // Find all matching pending actions (capped at 200 to prevent memory issues)
                const pendingActions = await tx.supervisorAction.findMany({
                    where: {
                        projectId: id,
                        accountId: userId,
                        approval: "pending",
                        severity: { in: [...severities] },
                    },
                    select: {
                        id: true,
                        severity: true,
                        title: true,
                        description: true,
                        suggestedFix: true,
                        category: true,
                    },
                    take: 200,
                });

                if (pendingActions.length >= 200) {
                    log({ module: "supervisor", level: "warn" }, `pendingActions query hit the 200-record cap for project ${id}`);
                }

                if (pendingActions.length === 0) {
                    const totalPending = await tx.supervisorAction.count({
                        where: { projectId: id, accountId: userId, approval: "pending" },
                    });
                    return { pendingActions: [] as typeof pendingActions, approvedCount: 0, remainingPending: totalPending };
                }

                // Batch approve
                await tx.supervisorAction.updateMany({
                    where: {
                        id: { in: pendingActions.map((a) => a.id) },
                        approval: "pending",
                    },
                    data: {
                        approval: "approved",
                        fixStatus: "pending",
                    },
                });

                const remainingPending = await tx.supervisorAction.count({
                    where: { projectId: id, accountId: userId, approval: "pending" },
                });

                return { pendingActions, approvedCount: pendingActions.length, remainingPending };
            });

            if ("conflict" in txResult) {
                return reply.code(409).send({ error: txResult.conflict });
            }

            const { pendingActions, remainingPending } = txResult;

            log(
                { module: "supervisor" },
                `Reprocess: approved ${pendingActions.length} actions (mode=${mode}, severities=${severities.join(",")}) for project ${id}`,
            );

            // Trigger fix for each approved action
            const { maxAnalysis, maxFix } = parseConcurrencyConfig(project.supervisorConfig);
            for (const action of pendingActions) {
                await emitConfiguredSupervisorFixTrigger({
                    userId,
                    projectId: id,
                    actionId: action.id,
                    machineId: project.machineId,
                    repoPath: project.path,
                    supervisorConfig: project.supervisorConfig,
                    fixStrategy: project.fixStrategy,
                    mode,
                    maxConcurrentAnalysis: maxAnalysis,
                    maxConcurrentFix: maxFix,
                    fixAction: {
                        title: action.title,
                        description: action.description,
                        suggestedFix: action.suggestedFix,
                        category: action.category,
                        severity: action.severity,
                    },
                });
            }

            return reply.send({
                approvedCount: pendingActions.length,
                remainingPending,
            });
        },
    );
}
