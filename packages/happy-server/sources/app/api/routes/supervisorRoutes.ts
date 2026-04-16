import {
    eventRouter,
    buildSupervisorTriggerEphemeral,
} from "@/app/events/eventRouter";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { log } from "@/utils/log";
import { parseAutoApproveSeverities } from "@/modules/supervisorConfig";
import { parseConcurrencyConfig } from "./supervisorRunRoutes";
import { auth } from "@/app/auth/auth";

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
            } = request.body;

            const existing = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { id: true },
            });

            if (!existing) {
                return reply.code(404).send({ error: "Project not found" });
            }

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

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: {
                    id: true,
                    supervisorConfig: true,
                    machineId: true,
                    path: true,
                    repoUrl: true,
                    fixStrategy: true,
                },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Parse configured severities from project config
            const severities = parseAutoApproveSeverities(project.supervisorConfig, mode);
            if (severities.length === 0) {
                return reply.send({ approvedCount: 0, remainingPending: 0 });
            }

            // Atomic: check for conflicts + find + approve in a single transaction
            const txResult = await db.$transaction(async (tx) => {
                // Check for active loop
                const activeLoop = await tx.supervisorLoop.findFirst({
                    where: {
                        projectId: id,
                        accountId: userId,
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

                // Find all matching pending actions
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
                });

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
                const callbackToken = await auth.createSupervisorCallbackToken({
                    userId,
                    projectId: id,
                    machineId: project.machineId,
                    purpose: "fix-status",
                    actionId: action.id,
                });
                eventRouter.emitEphemeral({
                    userId,
                    payload: buildSupervisorTriggerEphemeral({
                        projectId: id,
                        runId: action.id,
                        trigger: "fix",
                        machineId: project.machineId,
                        repoPath: project.path,
                        callbackToken,
                        mode,
                        fixAction: {
                            title: action.title,
                            description: action.description,
                            suggestedFix: action.suggestedFix,
                            category: action.category,
                            severity: action.severity,
                        },
                        fixStrategy: project.fixStrategy ?? undefined,
                        maxConcurrentAnalysis: maxAnalysis,
                        maxConcurrentFix: maxFix,
                    }),
                    recipientFilter: {
                        type: "machine-scoped-only",
                        machineId: project.machineId,
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
