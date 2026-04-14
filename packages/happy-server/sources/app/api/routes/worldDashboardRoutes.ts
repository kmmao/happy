import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { autonomyScore } from "@/modules/autonomyScore";
import { generateWorldConstitution } from "@/modules/worldConstitutionGenerator";
import { buildCollaborationSummary } from "@/modules/roleCollaboration";

/**
 * World Dashboard — aggregated project world state.
 */
export function worldDashboardRoutes(app: Fastify) {
    // GET /v1/projects/:id/world/dashboard
    app.get(
        "/v1/projects/:id/world/dashboard",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;

            // Verify project ownership
            const project = await db.project.findFirst({
                where: { id: projectId, accountId: userId },
                select: { id: true, narrative: true, laws: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Parallel queries
            const [
                autonomy,
                rolesData,
                goalsData,
                pendingDecisions,
                recentDecisions,
                messagesData,
                membersCount,
                goalHealthRows,
            ] = await Promise.all([
                autonomyScore(projectId, userId),

                db.agentRole.groupBy({
                    by: ["type"],
                    where: { accountId: userId, projectId, enabled: true },
                    _count: true,
                }),

                db.goal.groupBy({
                    by: ["status"],
                    where: { accountId: userId, projectId },
                    _count: true,
                }),

                db.decision.count({
                    where: { accountId: userId, projectId, status: "pending" },
                }),

                db.decision.findMany({
                    where: { accountId: userId, projectId, status: "decided" },
                    orderBy: { decidedAt: "desc" },
                    take: 5,
                    select: {
                        id: true,
                        question: true,
                        chosenOption: true,
                        decidedAt: true,
                    },
                }),

                db.agentMessage.groupBy({
                    by: ["msgType"],
                    where: {
                        accountId: userId,
                        projectId,
                        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
                    },
                    _count: true,
                }),

                db.worldMember.count({
                    where: { accountId: userId, projectId },
                }),

                db.goal.findMany({
                    where: { accountId: userId, projectId, healthScore: { not: null } },
                    select: { healthScore: true, layer: true },
                }),
            ]);

            // Parse roles
            const rolesByType: Record<string, number> = {};
            let totalEnabledRoles = 0;
            for (const r of rolesData) {
                rolesByType[r.type] = r._count;
                totalEnabledRoles += r._count;
            }

            // Parse goals
            const goalsByStatus: Record<string, number> = {};
            let totalGoals = 0;
            for (const g of goalsData) {
                goalsByStatus[g.status] = g._count;
                totalGoals += g._count;
            }

            // Parse laws
            let lawCount = 0;
            if (project.laws) {
                try {
                    const laws = JSON.parse(project.laws) as Array<{ enabled: boolean }>;
                    lawCount = laws.filter((l) => l.enabled).length;
                } catch {
                    // ignore
                }
            }

            // Parse goal health
            let healthTotal = 0;
            let healthSum = 0;
            let criticalCount = 0;
            let warningCount = 0;
            let healthyCount = 0;
            const byLayer: Record<string, { count: number; sum: number }> = {
                strategic: { count: 0, sum: 0 },
                operational: { count: 0, sum: 0 },
                execution: { count: 0, sum: 0 },
            };
            for (const row of goalHealthRows) {
                const score = row.healthScore ?? 100;
                healthTotal++;
                healthSum += score;
                if (score < 30) criticalCount++;
                else if (score <= 60) warningCount++;
                else healthyCount++;
                const layer = row.layer ?? "operational";
                if (byLayer[layer]) {
                    byLayer[layer].count++;
                    byLayer[layer].sum += score;
                }
            }

            // Parse messages
            let totalMessages30d = 0;
            let conflicts30d = 0;
            let lawSuggestions30d = 0;
            let handoffs30d = 0;
            let dependencyBlocked30d = 0;
            let reviewRequests30d = 0;
            for (const m of messagesData) {
                totalMessages30d += m._count;
                if (m.msgType === "conflict") conflicts30d = m._count;
                if (m.msgType === "law_suggestion") lawSuggestions30d = m._count;
                if (m.msgType === "handoff") handoffs30d = m._count;
                if (m.msgType === "dependency_blocked") dependencyBlocked30d = m._count;
                if (m.msgType === "review_request") reviewRequests30d = m._count;
            }

            return reply.send({
                autonomy: {
                    score: autonomy.score,
                    total30d: autonomy.total30d,
                    pending30d: autonomy.pending30d,
                    decided30d: autonomy.decided30d,
                    autoResolved30d: autonomy.autoResolved30d,
                    expired30d: autonomy.expired30d,
                },
                roles: {
                    total: totalEnabledRoles,
                    byType: rolesByType,
                },
                members: {
                    total: membersCount > 0 ? membersCount : 1,
                },
                goals: {
                    total: totalGoals,
                    active: (goalsByStatus["planning"] ?? 0) + (goalsByStatus["in_progress"] ?? 0),
                    completed: goalsByStatus["completed"] ?? 0,
                    blocked: goalsByStatus["blocked"] ?? 0,
                    cancelled: goalsByStatus["cancelled"] ?? 0,
                },
                decisions: {
                    pending: pendingDecisions,
                    recentDecided: recentDecisions.map((d) => ({
                        id: d.id,
                        question: d.question,
                        chosenOption: d.chosenOption,
                        decidedAt: d.decidedAt?.getTime() ?? null,
                    })),
                },
                lawCount,
                goalHealth: {
                    averageScore: healthTotal > 0 ? Math.round(healthSum / healthTotal) : null,
                    criticalCount,
                    warningCount,
                    healthyCount,
                    byLayer: {
                        strategic: { count: byLayer.strategic.count, avgScore: byLayer.strategic.count > 0 ? Math.round(byLayer.strategic.sum / byLayer.strategic.count) : null },
                        operational: { count: byLayer.operational.count, avgScore: byLayer.operational.count > 0 ? Math.round(byLayer.operational.sum / byLayer.operational.count) : null },
                        execution: { count: byLayer.execution.count, avgScore: byLayer.execution.count > 0 ? Math.round(byLayer.execution.sum / byLayer.execution.count) : null },
                    },
                },
                hasNarrative: Boolean(project.narrative && project.narrative.trim().length > 0),
                agentMessages: {
                    total30d: totalMessages30d,
                    conflicts30d,
                    lawSuggestions30d,
                    handoffs30d,
                    dependencyBlocked30d,
                    reviewRequests30d,
                },
            });
        },
    );

    // GET /v1/projects/:id/world/collaboration — role collaboration graph
    app.get(
        "/v1/projects/:id/world/collaboration",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;

            const project = await db.project.findFirst({
                where: { id: projectId, accountId: userId },
                select: { id: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            const [roles, tasks, messages, decisions] = await Promise.all([
                db.agentRole.findMany({
                    where: { accountId: userId, projectId, enabled: true },
                    select: { name: true, type: true },
                }),
                db.task.findMany({
                    where: { accountId: userId, projectId, createdAt: { gte: since30d } },
                    select: { roleType: true, status: true },
                }),
                db.agentMessage.findMany({
                    where: {
                        accountId: userId,
                        projectId,
                        status: { not: "resolved" },
                    },
                    select: {
                        id: true,
                        fromRole: true,
                        toRole: true,
                        msgType: true,
                        status: true,
                        relatedGoalId: true,
                        createdAt: true,
                    },
                }),
                db.decision.findMany({
                    where: { accountId: userId, projectId },
                    select: { status: true },
                }),
            ]);

            const summary = buildCollaborationSummary({ roles, tasks, messages, decisions });
            return reply.send(summary);
        },
    );

    // POST /v1/projects/:id/world/generate — auto-generate world elements from project context
    app.post(
        "/v1/projects/:id/world/generate",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    mode: z.enum(["auto", "custom"]).default("auto"),
                    prompt: z.string().max(5000).optional(),
                    contentLanguage: z.enum(["en", "zh"]).default("en"),
                    elements: z.array(z.enum(["narrative", "laws", "roles", "member", "goal"])).optional(),
                }),
            },
        },
        async (request, reply) => {
            try {
                const result = await generateWorldConstitution(
                    request.params.id,
                    request.userId,
                    {
                        mode: request.body.mode,
                        prompt: request.body.prompt,
                        contentLanguage: request.body.contentLanguage,
                        elements: request.body.elements,
                    },
                );
                return reply.send(result);
            } catch (e: any) {
                return reply.code(404).send({ error: e.message ?? "Failed to generate" });
            }
        },
    );
}
