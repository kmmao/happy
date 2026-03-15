import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";

/**
 * Supervisor report routes: comparison and export.
 * Split from supervisorRoutes to keep file sizes manageable.
 */
export function supervisorReportRoutes(app: Fastify) {
    // GET /v1/projects/:id/supervisor/runs/:runId/compare — Compare with previous run
    app.get(
        "/v1/projects/:id/supervisor/runs/:runId/compare",
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

            // Fetch target run
            const targetRun = await db.supervisorRun.findFirst({
                where: {
                    id: runId,
                    projectId: id,
                    accountId: userId,
                    status: "completed",
                },
                select: {
                    id: true,
                    createdAt: true,
                    completedAt: true,
                    trigger: true,
                    actionsCount: true,
                    tokenCount: true,
                    costUsd: true,
                    healthScore: true,
                    actions: {
                        select: {
                            id: true,
                            severity: true,
                            category: true,
                            title: true,
                            description: true,
                            suggestedFix: true,
                            confidence: true,
                            approval: true,
                            fixStatus: true,
                        },
                    },
                },
            });

            if (!targetRun) {
                return reply
                    .code(404)
                    .send({ error: "Completed run not found" });
            }

            // Find previous completed run
            const previousRun = await db.supervisorRun.findFirst({
                where: {
                    projectId: id,
                    accountId: userId,
                    status: "completed",
                    createdAt: { lt: targetRun.createdAt },
                },
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    createdAt: true,
                    completedAt: true,
                    actionsCount: true,
                    actions: {
                        select: {
                            id: true,
                            severity: true,
                            category: true,
                            title: true,
                            description: true,
                            suggestedFix: true,
                            confidence: true,
                            approval: true,
                            fixStatus: true,
                        },
                    },
                },
            });

            // Compute diff by category+title exact match
            const currentKeys = new Set(
                targetRun.actions.map(
                    (a) => `${a.category}::${a.title}`,
                ),
            );
            const previousKeys = new Set(
                (previousRun?.actions ?? []).map(
                    (a) => `${a.category}::${a.title}`,
                ),
            );

            const newActions = targetRun.actions.filter(
                (a) =>
                    !previousKeys.has(`${a.category}::${a.title}`),
            );
            const resolvedActions = (
                previousRun?.actions ?? []
            ).filter(
                (a) =>
                    !currentKeys.has(`${a.category}::${a.title}`),
            );
            const persistentActions = targetRun.actions.filter(
                (a) =>
                    previousKeys.has(`${a.category}::${a.title}`),
            );

            return reply.send({
                currentRun: {
                    id: targetRun.id,
                    createdAt: targetRun.createdAt.getTime(),
                    completedAt:
                        targetRun.completedAt?.getTime() ?? null,
                    trigger: targetRun.trigger,
                    actionsCount: targetRun.actionsCount,
                    tokenCount: targetRun.tokenCount,
                    costUsd: targetRun.costUsd,
                    healthScore: targetRun.healthScore ?? null,
                },
                previousRun: previousRun
                    ? {
                          id: previousRun.id,
                          createdAt:
                              previousRun.createdAt.getTime(),
                          completedAt:
                              previousRun.completedAt?.getTime() ??
                              null,
                          actionsCount:
                              previousRun.actionsCount,
                      }
                    : null,
                newActions,
                resolvedActions,
                persistentActions,
            });
        },
    );

    // GET /v1/projects/:id/supervisor/runs/:runId/export — Export run report as Markdown
    app.get(
        "/v1/projects/:id/supervisor/runs/:runId/export",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    runId: z.string(),
                }),
                querystring: z
                    .object({
                        format: z.enum(["markdown"]).default("markdown"),
                    })
                    .optional(),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, runId } = request.params;

            // Fetch target run with all actions
            const targetRun = await db.supervisorRun.findFirst({
                where: {
                    id: runId,
                    projectId: id,
                    accountId: userId,
                    status: "completed",
                },
                select: {
                    id: true,
                    createdAt: true,
                    completedAt: true,
                    trigger: true,
                    actionsCount: true,
                    tokenCount: true,
                    costUsd: true,
                    actions: {
                        select: {
                            id: true,
                            severity: true,
                            category: true,
                            title: true,
                            description: true,
                            suggestedFix: true,
                            confidence: true,
                            approval: true,
                            fixStatus: true,
                        },
                    },
                },
            });

            if (!targetRun) {
                return reply
                    .code(404)
                    .send({ error: "Completed run not found" });
            }

            // Find previous completed run for comparison
            const previousRun = await db.supervisorRun.findFirst({
                where: {
                    projectId: id,
                    accountId: userId,
                    status: "completed",
                    createdAt: { lt: targetRun.createdAt },
                },
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    createdAt: true,
                    completedAt: true,
                    actionsCount: true,
                    actions: {
                        select: {
                            id: true,
                            severity: true,
                            category: true,
                            title: true,
                            description: true,
                            suggestedFix: true,
                            confidence: true,
                            approval: true,
                            fixStatus: true,
                        },
                    },
                },
            });

            // Compute diff by category+title exact match
            const currentKeys = new Set(
                targetRun.actions.map(
                    (a) => `${a.category}::${a.title}`,
                ),
            );
            const previousKeys = new Set(
                (previousRun?.actions ?? []).map(
                    (a) => `${a.category}::${a.title}`,
                ),
            );

            const newActions = targetRun.actions.filter(
                (a) => !previousKeys.has(`${a.category}::${a.title}`),
            );
            const resolvedActions = (previousRun?.actions ?? []).filter(
                (a) => !currentKeys.has(`${a.category}::${a.title}`),
            );
            const persistentActions = targetRun.actions.filter(
                (a) => previousKeys.has(`${a.category}::${a.title}`),
            );

            // Build Markdown content
            const reportDate = (
                targetRun.completedAt ?? targetRun.createdAt
            ).toISOString().split("T")[0];

            const durationMs =
                targetRun.completedAt && targetRun.createdAt
                    ? targetRun.completedAt.getTime() -
                      targetRun.createdAt.getTime()
                    : null;
            const durationStr =
                durationMs !== null
                    ? `${Math.round(durationMs / 1000)}s`
                    : "N/A";

            const severityBadge = (severity: string) => `[${severity.toUpperCase()}]`;

            const renderAction = (a: {
                severity: string;
                title: string;
                description: string;
                suggestedFix: string | null;
            }) => {
                const lines = [
                    `### ${severityBadge(a.severity)} ${a.title}`,
                    ``,
                    a.description,
                ];
                if (a.suggestedFix) {
                    lines.push(``, `**Suggested Fix:** ${a.suggestedFix}`);
                }
                return lines.join("\n");
            };

            const severityCounts: Record<string, number> = {
                critical: 0,
                high: 0,
                medium: 0,
                low: 0,
            };
            for (const a of targetRun.actions) {
                const sev = a.severity as keyof typeof severityCounts;
                if (sev in severityCounts) severityCounts[sev]++;
            }

            const sections: string[] = [
                `# Supervisor Report`,
                ``,
                `*Generated on ${reportDate}*`,
                ``,
                `## Run Summary`,
                ``,
                `| Field | Value |`,
                `|-------|-------|`,
                `| Trigger | ${targetRun.trigger} |`,
                `| Duration | ${durationStr} |`,
                `| Cost | ${targetRun.costUsd !== null ? `$${targetRun.costUsd.toFixed(4)}` : "N/A"} |`,
                `| Tokens | ${targetRun.tokenCount ?? "N/A"} |`,
                `| Actions | ${targetRun.actionsCount} |`,
                ``,
                `## Issues by Severity`,
                ``,
                `| Severity | Count |`,
                `|----------|-------|`,
                `| Critical | ${severityCounts.critical} |`,
                `| High | ${severityCounts.high} |`,
                `| Medium | ${severityCounts.medium} |`,
                `| Low | ${severityCounts.low} |`,
            ];

            if (newActions.length > 0) {
                sections.push(``, `## New Issues`, ``);
                for (const a of newActions) {
                    sections.push(renderAction(a), ``);
                }
            }

            if (resolvedActions.length > 0) {
                sections.push(``, `## Resolved Issues`, ``);
                for (const a of resolvedActions) {
                    sections.push(renderAction(a), ``);
                }
            }

            if (persistentActions.length > 0) {
                sections.push(``, `## Persistent Issues`, ``);
                for (const a of persistentActions) {
                    sections.push(renderAction(a), ``);
                }
            }

            const content = sections.join("\n");
            const filename = `supervisor-report-${reportDate}.md`;

            return reply.send({ content, filename });
        },
    );
}
