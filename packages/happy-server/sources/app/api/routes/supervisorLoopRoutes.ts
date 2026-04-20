/**
 * Supervisor Loop routes — start, control, and query autopilot loops.
 * Split from supervisorRoutes to keep file sizes manageable.
 */

import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import {
    startLoop,
    pauseLoop,
    resumeLoop,
    stopLoop,
} from "@/modules/supervisorLoopEngine";
import { resolveConfiguredSupervisorProfile } from "@/modules/supervisorConfiguredProfile";
import { ResolvedRuntimeProfileSchema } from "@/types/aiBackendProfile";

export function supervisorLoopRoutes(app: Fastify) {
    // POST /v1/projects/:id/supervisor/loop — Start a new loop
    app.post(
        "/v1/projects/:id/supervisor/loop",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    maxIterations: z.number().int().min(1).max(20).default(5),
                    costCapUsd: z.number().min(0).max(100).optional(),
                    healthScoreTarget: z.number().int().min(0).max(100).optional(),
                    autoApproveThreshold: z.number().int().min(50).max(100).default(80),
                    maxConsecutiveFailures: z.number().int().min(1).max(10).default(2),
                    maxDurationMinutes: z.number().int().min(10).max(480).default(240),
                    profileId: z.string().optional(),
                    runtimeProfile: ResolvedRuntimeProfileSchema.optional(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { supervisorConfig: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const requestedProfile = await resolveConfiguredSupervisorProfile({
                userId,
                supervisorConfig: project.supervisorConfig,
                profileId: request.body.profileId,
                runtimeProfile: request.body.runtimeProfile,
            });
            if (!requestedProfile.ok) {
                return reply.code(400).send({ error: requestedProfile.error });
            }

            const result = await startLoop(id, userId, {
                ...request.body,
                runtimeProfile: requestedProfile.resolvedProfile.runtimeProfile,
            });

            if ("error" in result) {
                return reply.code(result.code).send({ error: result.error });
            }

            const loop = await db.supervisorLoop.findUnique({
                where: { id: result.loopId },
            });

            return reply.send({ loop: loop ? serializeLoop(loop) : { id: result.loopId } });
        },
    );

    // GET /v1/projects/:id/supervisor/loop — Get active loop
    app.get(
        "/v1/projects/:id/supervisor/loop",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            const loop = await db.supervisorLoop.findFirst({
                where: {
                    projectId: id,
                    accountId: userId,
                    status: { in: ["running", "paused"] },
                },
            });

            return reply.send({ loop: loop ? serializeLoop(loop) : null });
        },
    );

    // GET /v1/projects/:id/supervisor/loops — Loop history
    app.get(
        "/v1/projects/:id/supervisor/loops",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: z.object({
                    limit: z.coerce.number().int().min(1).max(50).default(10),
                    offset: z.coerce.number().int().min(0).default(0),
                }).optional(),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const limit = request.query?.limit ?? 10;
            const offset = request.query?.offset ?? 0;

            const where = {
                projectId: id,
                accountId: userId,
            };

            const [loops, total] = await Promise.all([
                db.supervisorLoop.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip: offset,
                }),
                db.supervisorLoop.count({ where }),
            ]);

            return reply.send({
                loops: loops.map(serializeLoop),
                total,
            });
        },
    );

    // GET /v1/projects/:id/supervisor/loops/:loopId — Get loop detail with associated runs
    app.get(
        "/v1/projects/:id/supervisor/loops/:loopId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    loopId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, loopId } = request.params;

            const loop = await db.supervisorLoop.findFirst({
                where: {
                    id: loopId,
                    projectId: id,
                    accountId: userId,
                },
            });

            if (!loop) {
                return reply.code(404).send({ error: "Loop not found" });
            }

            // Fetch runs and actions in parallel (no data dependency between them)
            const [runs, actions] = await Promise.all([
                db.supervisorRun.findMany({
                    where: {
                        loopId,
                        projectId: id,
                        accountId: userId,
                    },
                    orderBy: { createdAt: "asc" },
                    take: 1000,
                }),
                db.supervisorAction.findMany({
                    where: {
                        projectId: id,
                        accountId: userId,
                        run: { loopId },
                        approval: { in: ["approved", "pending"] },
                    },
                    orderBy: { createdAt: "desc" },
                    take: 50,
                }),
            ]);

            return reply.send({
                loop: serializeLoop(loop),
                runs: runs.map((r) => ({
                    id: r.id,
                    trigger: r.trigger,
                    status: r.status,
                    loopIteration: r.loopIteration,
                    loopPhase: r.loopPhase,
                    actionsCount: r.actionsCount,
                    healthScore: r.healthScore,
                    costUsd: r.costUsd,
                    tokenCount: r.tokenCount,
                    errorMessage: r.errorMessage,
                    createdAt: r.createdAt.getTime(),
                    completedAt: r.completedAt?.getTime() ?? null,
                })),
                actions: actions.map((a) => ({
                    id: a.id,
                    severity: a.severity,
                    category: a.category,
                    title: a.title,
                    description: a.description,
                    confidence: a.confidence,
                    approval: a.approval,
                    fixStatus: a.fixStatus,
                    createdAt: a.createdAt.getTime(),
                })),
            });
        },
    );

    // DELETE /v1/projects/:id/supervisor/loops/:loopId — Delete a completed/failed/stopped loop
    app.delete(
        "/v1/projects/:id/supervisor/loops/:loopId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    loopId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, loopId } = request.params;

            const loop = await db.supervisorLoop.findFirst({
                where: { id: loopId, projectId: id, accountId: userId },
                select: { status: true },
            });

            if (!loop) {
                return reply.code(404).send({ error: "Loop not found" });
            }

            if (loop.status === "running" || loop.status === "paused") {
                return reply.code(409).send({ error: "Cannot delete an active loop. Stop it first." });
            }

            await db.supervisorLoop.delete({ where: { id: loopId } });

            return reply.send({ deleted: true });
        },
    );

    // POST /v1/projects/:id/supervisor/loop/:loopId/pause
    app.post(
        "/v1/projects/:id/supervisor/loop/:loopId/pause",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    loopId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { loopId } = request.params;

            const result = await pauseLoop(loopId, userId);
            if (!result.success) {
                return reply.code(404).send({ error: "Active loop not found" });
            }

            const loop = await db.supervisorLoop.findUnique({ where: { id: loopId } });
            return reply.send({ loop: loop ? serializeLoop(loop) : { id: loopId } });
        },
    );

    // POST /v1/projects/:id/supervisor/loop/:loopId/resume
    app.post(
        "/v1/projects/:id/supervisor/loop/:loopId/resume",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    loopId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { loopId } = request.params;

            const result = await resumeLoop(loopId, userId);
            if (!result.success) {
                return reply.code(404).send({ error: "Paused loop not found" });
            }

            const loop = await db.supervisorLoop.findUnique({ where: { id: loopId } });
            return reply.send({ loop: loop ? serializeLoop(loop) : { id: loopId } });
        },
    );

    // POST /v1/projects/:id/supervisor/loop/:loopId/stop
    app.post(
        "/v1/projects/:id/supervisor/loop/:loopId/stop",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    loopId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { loopId } = request.params;

            const result = await stopLoop(loopId, userId);
            if (!result.success) {
                return reply.code(404).send({ error: "Active loop not found" });
            }

            const loop = await db.supervisorLoop.findUnique({ where: { id: loopId } });
            return reply.send({ loop: loop ? serializeLoop(loop) : { id: loopId } });
        },
    );
}

function serializeLoop(loop: {
    id: string;
    projectId: string;
    accountId: string;
    status: string;
    currentPhase: string;
    currentIteration: number;
    maxIterations: number;
    costCapUsd: number | null;
    healthScoreTarget: number | null;
    autoApproveThreshold: number;
    maxConsecutiveFailures: number;
    maxDurationMinutes: number;
    totalCostUsd: number;
    totalTokens: number;
    totalActionsFound: number;
    totalActionsFixed: number;
    consecutiveFailures: number;
    initialHealthScore: number | null;
    currentHealthScore: number | null;
    activeRunId: string | null;
    exitReason: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
}) {
    return {
        id: loop.id,
        projectId: loop.projectId,
        status: loop.status,
        currentPhase: loop.currentPhase,
        currentIteration: loop.currentIteration,
        maxIterations: loop.maxIterations,
        costCapUsd: loop.costCapUsd,
        healthScoreTarget: loop.healthScoreTarget,
        autoApproveThreshold: loop.autoApproveThreshold,
        maxConsecutiveFailures: loop.maxConsecutiveFailures,
        maxDurationMinutes: loop.maxDurationMinutes,
        totalCostUsd: loop.totalCostUsd,
        totalTokens: loop.totalTokens,
        totalActionsFound: loop.totalActionsFound,
        totalActionsFixed: loop.totalActionsFixed,
        consecutiveFailures: loop.consecutiveFailures,
        initialHealthScore: loop.initialHealthScore,
        currentHealthScore: loop.currentHealthScore,
        activeRunId: loop.activeRunId,
        exitReason: loop.exitReason,
        createdAt: loop.createdAt.getTime(),
        updatedAt: loop.updatedAt.getTime(),
        completedAt: loop.completedAt?.getTime() ?? null,
    };
}
