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
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            const result = await startLoop(id, userId, request.body);

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
