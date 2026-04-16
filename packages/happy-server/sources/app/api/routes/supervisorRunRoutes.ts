import {
    eventRouter,
    buildSupervisorTriggerEphemeral,
    buildSupervisorStatusEphemeral,
    buildSessionActivityEphemeral,
} from "@/app/events/eventRouter";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { checkDailyRunLimit, incrementDailyRunCount } from "@/modules/supervisorLimits";
import { computeHealthScore, countSeverities } from "@/modules/supervisorScoring";
import { aggregateSessionUsage, scheduleDelayedCostAggregation } from "@/modules/supervisorUsage";
import { activityCache } from "@/app/presence/sessionCache";
import { onRunCompleted as loopOnRunCompleted } from "@/modules/supervisorLoopEngine";
import { log } from "@/utils/log";
import { handleAutoApproval } from "@/app/api/socket/supervisorRunStatusHandler";
import { resolveSupervisorProfile, parseDefaultProfileId } from "@/modules/supervisorProfileResolver";
import { auth } from "@/app/auth/auth";

/**
 * Supervisor run routes: trigger, list, detail, cancel, and status updates.
 * Split from supervisorRoutes to keep file sizes manageable.
 */
export function supervisorRunRoutes(app: Fastify) {
    // POST /v1/projects/:id/supervisor/run — Trigger a manual supervisor run
    app.post(
        "/v1/projects/:id/supervisor/run",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z
                    .object({
                        machineId: z.string().optional(),
                        repoPath: z.string().optional(),
                        trigger: z.enum(["manual", "research"]).optional(),
                        researchParams: z.object({
                            knownCompetitors: z.string().max(1000).optional(),
                            focusAreas: z.string().max(1000).optional(),
                            additionalNotes: z.string().max(2000).optional(),
                            featureDirection: z.string().max(1000).optional(),
                        }).optional(),
                        profileId: z.string().optional(),
                    })
                    .optional(),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { id: true, machineId: true, path: true, supervisorMode: true, supervisorEnabledDimensions: true, supervisorCustomRules: true, supervisorConfig: true, narrative: true, laws: true },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Check daily run limit
            const limitCheck = await checkDailyRunLimit(id);
            if (!limitCheck.allowed) {
                return reply.code(429).send({
                    error: `Daily supervisor run limit reached (${limitCheck.currentCount}/${limitCheck.limit})`,
                });
            }

            // Atomically check-and-create inside a transaction to prevent
            // concurrent requests from both passing the check
            let run;
            try {
                run = await db.$transaction(async (tx) => {
                    const existingRun = await tx.supervisorRun.findFirst({
                        where: {
                            projectId: id,
                            accountId: userId,
                            status: { in: ["pending", "running"] },
                        },
                        select: { id: true },
                    });

                    if (existingRun) {
                        throw new ConflictError(existingRun.id);
                    }

                    return tx.supervisorRun.create({
                        data: {
                            projectId: id,
                            accountId: userId,
                            trigger: request.body?.trigger ?? "manual",
                            status: "pending",
                            researchParams: request.body?.researchParams
                                ? JSON.stringify(request.body.researchParams)
                                : null,
                        },
                    });
                });
            } catch (e) {
                if (e instanceof ConflictError) {
                    return reply.code(409).send({
                        error: "A supervisor run is already in progress",
                        runId: e.runId,
                    });
                }
                throw e;
            }

            // Increment daily run count
            await incrementDailyRunCount(id);

            // Emit ephemeral trigger event to CLI daemon
            const machineId = request.body?.machineId || project.machineId;
            const repoPath = request.body?.repoPath || project.path;

            const triggerType = request.body?.trigger ?? "manual";
            const researchParams = request.body?.researchParams;

            // Query all existing actions (including dismissed) for dedup in analysis prompt
            const existingActions = triggerType !== "research"
                ? await db.supervisorAction.findMany({
                    where: {
                        projectId: id,
                        accountId: userId,
                        approval: { in: ["pending", "approved", "skipped", "ignored"] },
                    },
                    select: { category: true, title: true, severity: true, approval: true, fixStatus: true },
                    take: 100,
                    orderBy: { createdAt: "desc" },
                })
                : undefined;

            // Extract concurrency limits from supervisorConfig JSON
            const concurrency = parseConcurrencyConfig(project.supervisorConfig);
            const maxFindings = parseMaxFindings(project.supervisorConfig);

            const requestedProfileId = request.body?.profileId ?? parseDefaultProfileId(project.supervisorConfig);
            const resolvedProfile = await resolveSupervisorProfile(userId, requestedProfileId);
            const callbackToken = await auth.createSupervisorCallbackToken({
                userId,
                projectId: id,
                machineId,
                purpose: "run-status",
                runId: run.id,
            });

            eventRouter.emitEphemeral({
                userId,
                payload: buildSupervisorTriggerEphemeral({
                    projectId: id,
                    runId: run.id,
                    trigger: triggerType,
                    machineId,
                    repoPath,
                    mode: triggerType === "research" ? undefined : (project.supervisorMode ?? undefined),
                    dimensions: triggerType === "research" ? undefined : parseDimensions(project.supervisorEnabledDimensions),
                    customRules: triggerType === "research" ? undefined : (project.supervisorCustomRules ?? undefined),
                    narrative: triggerType === "research" ? undefined : (project.narrative ?? undefined),
                    laws: triggerType === "research" ? undefined : (project.laws ?? undefined),
                    researchParams: researchParams ? JSON.stringify(researchParams) : undefined,
                    existingActions,
                    maxConcurrentAnalysis: concurrency.maxAnalysis,
                    maxConcurrentFix: concurrency.maxFix,
                    maxFindings,
                    callbackToken,
                    runtimeProfile: resolvedProfile.runtimeProfile,
                }),
                recipientFilter: {
                    type: "machine-scoped-only",
                    machineId,
                },
            });

            return reply.send({
                run: serializeSupervisorRun(run),
            });
        },
    );

    // GET /v1/projects/:id/supervisor/runs — List supervisor run history
    app.get(
        "/v1/projects/:id/supervisor/runs",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: z
                    .object({
                        limit: z.coerce
                            .number()
                            .int()
                            .min(1)
                            .max(100)
                            .default(20),
                        offset: z.coerce.number().int().min(0).default(0),
                        trigger: z.string().optional(),
                    })
                    .optional(),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const limit = request.query?.limit ?? 20;
            const offset = request.query?.offset ?? 0;
            const triggerFilter = request.query?.trigger;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { id: true },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const where = {
                projectId: id,
                accountId: userId,
                ...(triggerFilter ? { trigger: triggerFilter } : {}),
            };

            const [runs, total] = await Promise.all([
                db.supervisorRun.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip: offset,
                }),
                db.supervisorRun.count({ where }),
            ]);

            return reply.send({
                runs: runs.map(serializeSupervisorRun),
                total,
            });
        },
    );

    // GET /v1/projects/:id/supervisor/runs/:runId — Get run details
    app.get(
        "/v1/projects/:id/supervisor/runs/:runId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    runId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, runId } = request.params;

            const run = await db.supervisorRun.findFirst({
                where: {
                    id: runId,
                    projectId: id,
                    accountId: userId,
                },
            });

            if (!run) {
                return reply
                    .code(404)
                    .send({ error: "Supervisor run not found" });
            }

            return reply.send({
                run: serializeSupervisorRun(run),
            });
        },
    );

    // POST /v1/projects/:id/supervisor/cancel/:runId — Cancel a running supervisor
    app.post(
        "/v1/projects/:id/supervisor/cancel/:runId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    runId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, runId } = request.params;

            // Atomic: only cancel if status is still pending/running
            const result = await db.supervisorRun.updateMany({
                where: {
                    id: runId,
                    projectId: id,
                    accountId: userId,
                    status: { in: ["pending", "running"] },
                },
                data: {
                    status: "cancelled",
                    completedAt: new Date(),
                },
            });

            if (result.count === 0) {
                return reply.code(404).send({
                    error: "Active supervisor run not found",
                });
            }

            // Fetch the updated run for response
            const updated = await db.supervisorRun.findUnique({
                where: { id: runId },
            });

            // Notify App about cancellation
            eventRouter.emitEphemeral({
                userId,
                payload: buildSupervisorStatusEphemeral(
                    runId,
                    id,
                    "cancelled",
                ),
                recipientFilter: { type: "user-scoped-only" },
            });

            return reply.send({
                run: updated ? serializeSupervisorRun(updated) : { id: runId },
            });
        },
    );

    // DELETE /v1/projects/:id/supervisor/runs/:runId — Delete a completed/failed/cancelled run
    app.delete(
        "/v1/projects/:id/supervisor/runs/:runId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    runId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, runId } = request.params;

            const run = await db.supervisorRun.findFirst({
                where: { id: runId, projectId: id, accountId: userId },
                select: { status: true },
            });

            if (!run) {
                return reply.code(404).send({ error: "Supervisor run not found" });
            }

            if (run.status === "pending" || run.status === "running") {
                return reply.code(409).send({ error: "Cannot delete an active run. Cancel it first." });
            }

            await db.supervisorRun.delete({ where: { id: runId } });

            return reply.send({ deleted: true });
        },
    );

    // POST /v1/projects/:id/supervisor/runs/:runId/status — CLI callback to update run status
    app.post(
        "/v1/projects/:id/supervisor/runs/:runId/status",
        {
            preHandler: app.authenticateMachineScopedCallback,
            schema: {
                params: z.object({
                    id: z.string(),
                    runId: z.string(),
                }),
                body: z.object({
                    status: z.enum(["running", "completed", "failed"]),
                    artifactId: z.string().optional(),
                    sessionId: z.string().optional(),
                    actionsCount: z.number().int().min(0).optional(),
                    issuesCreated: z.number().int().min(0).optional(),
                    errorMessage: z.string().max(500).optional(),
                    currentDimension: z.string().max(50).optional(),
                    dimensionIndex: z.number().int().min(1).optional(),
                    totalDimensions: z.number().int().min(1).optional(),
                    reportTitle: z.string().max(200).optional(),
                    reportContent: z.string().max(50000).optional(),
                    actions: z.array(z.object({
                        severity: z.enum(["critical", "high", "medium", "low"]),
                        category: z.string().max(50),
                        title: z.string().max(500),
                        description: z.string().max(2000),
                        suggestedFix: z.string().max(2000).optional(),
                        confidence: z.number().int().min(0).max(100).optional(),
                    })).max(20).optional(),
                }),
            },
        },
        async (request, reply) => {
            const callbackAuth = request.supervisorCallbackAuth;
            const { id, runId } = request.params;
            if (!callbackAuth || callbackAuth.purpose !== "run-status" || callbackAuth.projectId !== id || callbackAuth.runId !== runId) {
                return reply.code(403).send({ error: "Callback token mismatch" });
            }

            const userId = callbackAuth.userId;
            const machineId = callbackAuth.machineId;

            const run = await db.supervisorRun.findFirst({
                where: {
                    id: runId,
                    projectId: id,
                    accountId: userId,
                },
                select: {
                    id: true,
                    sessionId: true,
                    project: {
                        select: {
                            machineId: true,
                        },
                    },
                },
            });

            if (!run) {
                return reply
                    .code(404)
                    .send({ error: "Supervisor run not found" });
            }

            if (!machineId || run.project.machineId !== machineId) {
                return reply.code(403).send({ error: "Machine mismatch" });
            }

            const {
                status,
                artifactId,
                sessionId,
                actionsCount,
                issuesCreated,
                errorMessage,
                currentDimension,
                dimensionIndex,
                totalDimensions,
                reportTitle,
                reportContent,
                actions: reportedActions,
            } = request.body;

            if (sessionId) {
                const matchedSession = await db.session.findFirst({
                    where: {
                        id: sessionId,
                        accountId: userId,
                        projectId: id,
                    },
                    select: { id: true },
                });
                if (!matchedSession) {
                    return reply.code(403).send({ error: "Invalid session for machine" });
                }
            }

            // Atomic: only update if status is still pending/running
            const data: Prisma.SupervisorRunUpdateManyMutationInput = {
                status,
            };
            if (artifactId !== undefined) data.artifactId = artifactId;
            if (sessionId !== undefined) data.sessionId = sessionId;
            if (actionsCount !== undefined) data.actionsCount = actionsCount;
            if (issuesCreated !== undefined) data.issuesCreated = issuesCreated;
            if (errorMessage !== undefined) data.errorMessage = errorMessage;
            if (reportTitle !== undefined) data.reportTitle = reportTitle;
            if (reportContent !== undefined) data.reportContent = reportContent;
            if (status === "completed" || status === "failed") {
                data.completedAt = new Date();
            }

            const result = await db.supervisorRun.updateMany({
                where: {
                    id: runId,
                    projectId: id,
                    accountId: userId,
                    status: { in: ["pending", "running"] },
                },
                data,
            });

            if (result.count === 0) {
                // Check if run exists but is already in a terminal state
                const existing = await db.supervisorRun.findFirst({
                    where: { id: runId, projectId: id, accountId: userId },
                    select: { status: true },
                });

                if (!existing) {
                    return reply
                        .code(404)
                        .send({ error: "Supervisor run not found" });
                }

                return reply.code(409).send({
                    error: `Run is already ${existing.status}`,
                });
            }

            // Compute and persist healthScore on completion
            if (status === "completed") {
                // Create SupervisorAction entries if provided — with deduplication
                if (reportedActions && reportedActions.length > 0) {
                    const existingPending = await db.supervisorAction.findMany({
                        where: {
                            projectId: id,
                            accountId: userId,
                            approval: "pending",
                        },
                        select: { id: true, category: true, title: true },
                    });

                    const existingKeys = new Map(
                        existingPending.map((a) => [`${a.category}::${a.title}`, a.id]),
                    );

                    const newActions: typeof reportedActions = [];
                    const batchOps: ReturnType<typeof db.supervisorAction.update>[] = [];

                    for (const action of reportedActions) {
                        const key = `${action.category}::${action.title}`;
                        const existingId = existingKeys.get(key);
                        if (existingId) {
                            batchOps.push(
                                db.supervisorAction.update({
                                    where: { id: existingId },
                                    data: {
                                        lastSeenRunId: runId,
                                        description: action.description,
                                        suggestedFix: action.suggestedFix ?? null,
                                        confidence: action.confidence ?? null,
                                        severity: action.severity,
                                    },
                                }),
                            );
                        } else {
                            newActions.push(action);
                        }
                    }

                    if (batchOps.length > 0) {
                        await db.$transaction(batchOps);
                    }

                    if (newActions.length > 0) {
                        await db.supervisorAction.createMany({
                            data: newActions.map((action) => ({
                                runId,
                                projectId: id,
                                accountId: userId,
                                severity: action.severity,
                                category: action.category,
                                title: action.title,
                                description: action.description,
                                suggestedFix: action.suggestedFix ?? null,
                                confidence: action.confidence ?? null,
                            })),
                        });
                    }

                    await db.supervisorRun.update({
                        where: { id: runId },
                        data: { actionsCount: reportedActions.length },
                    });
                }

                const allActions = await db.supervisorAction.findMany({
                    where: { runId, projectId: id, accountId: userId },
                    select: { severity: true },
                });
                const counts = countSeverities(allActions);
                const healthScore = computeHealthScore(counts);

                // Aggregate session usage (cost/tokens) from UsageReport
                const runForSession = await db.supervisorRun.findUnique({
                    where: { id: runId },
                    select: { sessionId: true },
                });
                const resolvedSessionId = sessionId ?? runForSession?.sessionId;
                const usage = await aggregateSessionUsage(resolvedSessionId);

                await db.supervisorRun.update({
                    where: { id: runId },
                    data: {
                        healthScore,
                        ...(usage
                            ? {
                                  tokenCount: usage.totalTokens,
                                  costUsd: usage.totalCostUsd,
                              }
                            : {}),
                    },
                });

                // Delayed re-aggregation: the turn-end cost report arrives AFTER
                // Claude's curl POST (which triggers this handler). Schedule
                // multiple retry attempts at increasing intervals.
                if (resolvedSessionId) {
                    scheduleDelayedCostAggregation(runId, resolvedSessionId);
                }

                // Archive the supervisor session so it doesn't stay active
                if (resolvedSessionId) {
                    const now = Date.now();
                    await db.session.updateMany({
                        where: { id: resolvedSessionId, active: true },
                        data: { lastActiveAt: new Date(now), active: false },
                    });
                    activityCache.invalidateSession(resolvedSessionId);
                    eventRouter.emitEphemeral({
                        userId,
                        payload: buildSessionActivityEphemeral(resolvedSessionId, false, now, false),
                        recipientFilter: { type: "user-scoped-only" },
                    });
                }
            }

            // Fetch the updated run for response
            const updated = await db.supervisorRun.findUnique({
                where: { id: runId },
            });

            // Notify App clients about status change
            eventRouter.emitEphemeral({
                userId,
                payload: buildSupervisorStatusEphemeral(
                    runId,
                    id,
                    status,
                    artifactId,
                    errorMessage,
                    currentDimension,
                    dimensionIndex,
                    totalDimensions,
                ),
                recipientFilter: { type: "user-scoped-only" },
            });

            if (status === "completed" || status === "failed") {
                // Auto/semi-auto mode: automatically approve actions based on configured severities
                // Skip if run belongs to a loop — Loop engine handles its own approval flow.
                // Check DB for actions (not request body) because Claude may report
                // actions in a separate request from the "completed" status.
                if (status === "completed") {
                    const runForAutoApprove = await db.supervisorRun.findUnique({
                        where: { id: runId },
                        select: { loopId: true, actionsCount: true },
                    });
                    log(
                        { module: "supervisor" },
                        `Auto-approval check: run ${runId}, loopId=${runForAutoApprove?.loopId ?? "null"}, actionsCount=${runForAutoApprove?.actionsCount ?? "null"}`,
                    );
                    if (!runForAutoApprove?.loopId && (runForAutoApprove?.actionsCount ?? 0) > 0) {
                        try {
                            await handleAutoApproval(userId, id, runId);
                        } catch (autoApproveError) {
                            log(
                                { module: "supervisor", level: "error" },
                                `Auto-approval error for run ${runId}: ${autoApproveError}`,
                            );
                        }
                    }
                }

                // Loop progression: if this run belongs to a loop, advance the state machine
                try {
                    await loopOnRunCompleted(userId, runId, id);
                } catch (loopError) {
                    log(
                        { module: "supervisor", level: "error" },
                        `Loop progression error for run ${runId}: ${loopError}`,
                    );
                }
            }

            return reply.send({
                run: updated ? serializeSupervisorRun(updated) : { id: runId },
            });
        },
    );
}

class ConflictError extends Error {
    public readonly runId: string;
    constructor(runId: string) {
        super("Conflict");
        this.runId = runId;
    }
}

/**
 * Extract concurrency limits from the supervisorConfig JSON blob.
 * Returns undefined values if not set (CLI will use its defaults).
 */
export function parseConcurrencyConfig(configJson: string | null | undefined): {
    maxAnalysis: number | undefined;
    maxFix: number | undefined;
} {
    if (!configJson) return { maxAnalysis: undefined, maxFix: undefined };
    try {
        const config = JSON.parse(configJson);
        const c = config?.concurrency;
        if (!c || typeof c !== "object") return { maxAnalysis: undefined, maxFix: undefined };
        return {
            maxAnalysis: typeof c.maxAnalysisSessions === "number" ? c.maxAnalysisSessions : undefined,
            maxFix: typeof c.maxFixSessions === "number" ? c.maxFixSessions : undefined,
        };
    } catch {
        return { maxAnalysis: undefined, maxFix: undefined };
    }
}

export function parseMaxFindings(configJson: string | null | undefined): number | undefined {
    if (!configJson) return undefined;
    try {
        const config = JSON.parse(configJson);
        return typeof config?.maxFindings === "number" ? config.maxFindings : undefined;
    } catch {
        return undefined;
    }
}

export function parseDimensions(raw: string | null | undefined): string[] | undefined {
    if (!raw) return undefined;
    const dims = raw
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);
    return dims.length > 0 ? dims : undefined;
}

export function serializeSupervisorRun(run: {
    id: string;
    projectId: string;
    trigger: string;
    status: string;
    artifactId: string | null;
    reportTitle: string | null;
    reportContent: string | null;
    researchParams: string | null;
    actionsCount: number;
    issuesCreated: number;
    sessionId: string | null;
    errorMessage: string | null;
    tokenCount: number | null;
    costUsd: number | null;
    healthScore: number | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
}) {
    return {
        id: run.id,
        projectId: run.projectId,
        trigger: run.trigger,
        status: run.status,
        artifactId: run.artifactId,
        reportTitle: run.reportTitle,
        reportContent: run.reportContent,
        researchParams: run.researchParams,
        actionsCount: run.actionsCount,
        issuesCreated: run.issuesCreated,
        sessionId: run.sessionId,
        errorMessage: run.errorMessage,
        tokenCount: run.tokenCount,
        costUsd: run.costUsd,
        healthScore: run.healthScore,
        createdAt: run.createdAt.getTime(),
        updatedAt: run.updatedAt.getTime(),
        completedAt: run.completedAt?.getTime() ?? null,
    };
}
