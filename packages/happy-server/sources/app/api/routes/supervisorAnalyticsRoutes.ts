import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import {
    type SeverityCounts,
    computeHealthScore,
    computeHealthGrade,
    countSeverities,
    computeTrendDirection,
} from "@/modules/supervisorScoring";

/**
 * Supervisor analytics routes: cost, trend, and summary.
 * Split from supervisorRoutes to keep file sizes manageable.
 */
export function supervisorAnalyticsRoutes(app: Fastify) {
    // GET /v1/projects/:id/supervisor/cost — Get aggregated cost for the project
    app.get(
        "/v1/projects/:id/supervisor/cost",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: z
                    .object({
                        days: z.coerce.number().int().min(1).max(365).default(30),
                    })
                    .optional(),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const days = request.query?.days ?? 30;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { id: true },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

            const whereClause = {
                projectId: id,
                accountId: userId,
                completedAt: { gte: since },
                status: { in: ["completed", "failed", "cancelled"] },
            };

            const [aggregation, runsCount] = await Promise.all([
                db.supervisorRun.aggregate({
                    where: whereClause,
                    _sum: {
                        tokenCount: true,
                        costUsd: true,
                    },
                }),
                db.supervisorRun.count({ where: whereClause }),
            ]);

            const totalTokens = aggregation._sum?.tokenCount ?? 0;
            const totalCostUsd = aggregation._sum?.costUsd ?? 0;

            return reply.send({
                days,
                runsCount,
                totalTokens,
                totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
            });
        },
    );

    // GET /v1/projects/:id/supervisor/trend — Severity distribution over time
    app.get(
        "/v1/projects/:id/supervisor/trend",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: z
                    .object({
                        days: z.coerce.number().int().min(1).max(90).default(30),
                    })
                    .optional(),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const days = request.query?.days ?? 30;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { id: true },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

            // Fetch completed runs with their action severity counts
            const runs = await db.supervisorRun.findMany({
                where: {
                    projectId: id,
                    accountId: userId,
                    status: "completed",
                    completedAt: { gte: since },
                },
                select: {
                    id: true,
                    completedAt: true,
                    actionsCount: true,
                    healthScore: true,
                    actions: {
                        select: { severity: true },
                    },
                },
                orderBy: { completedAt: "asc" },
            });

            const points = runs.map((run) => {
                const severityCounts = countSeverities(run.actions);
                return {
                    date: run.completedAt?.getTime() ?? 0,
                    total: run.actionsCount,
                    score: run.healthScore,
                    ...severityCounts,
                };
            });

            return reply.send({ days, points });
        },
    );

    // GET /v1/projects/:id/supervisor/summary — Aggregated health summary
    app.get(
        "/v1/projects/:id/supervisor/summary",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: {
                    id: true,
                    supervisorNextRunAt: true,
                    supervisorScheduleEnabled: true,
                },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Open issues by severity (pending approval)
            const severityGroups = await db.supervisorAction.groupBy({
                by: ["severity"],
                where: {
                    projectId: id,
                    accountId: userId,
                    approval: "pending",
                },
                _count: { severity: true },
            });

            const openCounts: SeverityCounts = {
                critical: 0,
                high: 0,
                medium: 0,
                low: 0,
            };
            for (const group of severityGroups) {
                const sev = group.severity as keyof SeverityCounts;
                if (sev in openCounts) {
                    openCounts[sev] = group._count.severity;
                }
            }


            // Compute health grade based on weighted severity score
            const score = computeHealthScore(openCounts);
            const grade = computeHealthGrade(score);

            // Last 2 completed runs for trend direction
            const recentRuns = await db.supervisorRun.findMany({
                where: {
                    projectId: id,
                    accountId: userId,
                    status: "completed",
                },
                orderBy: { completedAt: "desc" },
                take: 2,
                select: {
                    actionsCount: true,
                    completedAt: true,
                },
            });

            let trendDirection: "improving" | "stable" | "declining" =
                "stable";
            if (recentRuns.length >= 2) {
                trendDirection = computeTrendDirection(
                    recentRuns[0].actionsCount,
                    recentRuns[1].actionsCount,
                );
            }

            const lastScanAt =
                recentRuns.length > 0
                    ? recentRuns[0].completedAt?.getTime() ?? null
                    : null;

            // Total runs in last 30 days
            const since30d = new Date(
                Date.now() - 30 * 24 * 60 * 60 * 1000,
            );
            const totalRuns30d = await db.supervisorRun.count({
                where: {
                    projectId: id,
                    accountId: userId,
                    status: "completed",
                    completedAt: { gte: since30d },
                },
            });

            const nextRunAt =
                project.supervisorScheduleEnabled && project.supervisorNextRunAt
                    ? project.supervisorNextRunAt.getTime()
                    : null;

            return reply.send({
                grade,
                score,
                openCounts,
                trendDirection,
                lastScanAt,
                totalRuns30d,
                nextRunAt,
            });
        },
    );
}
