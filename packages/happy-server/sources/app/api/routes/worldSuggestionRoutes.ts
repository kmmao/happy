/**
 * World Suggestion routes — CRUD for server-generated next-step proposals.
 */

import { type Fastify } from "../types";
import { z } from "zod";
import { db } from "@/storage/db";
import { worldSuggestionQuery } from "@/modules/worldSuggestionQuery";
import { worldSuggestionRefresh } from "@/modules/worldSuggestionGenerate";
import { worldSuggestionAccept } from "@/modules/worldSuggestionAccept";
import { worldSuggestionDismiss } from "@/modules/worldSuggestionDismiss";
import { vetoWorldSuggestion } from "@/modules/worldSuggestionVeto";
import { AcceptBodySchema, SUGGESTION_BUCKETS, SUGGESTION_STATUSES, type AcceptBody } from "@kmmao/happy-wire";
import { getAutonomyStats } from "@/modules/worldSuggestionAutonomyStats";

export function worldSuggestionRoutes(app: Fastify) {
    app.get(
        "/v1/projects/:id/world/autonomy-stats",
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

            const stats = await getAutonomyStats(userId, projectId);
            return reply.send(stats);
        },
    );
    app.get(
        "/v1/projects/:id/world/suggestions",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: z.object({
                    status: z.enum(SUGGESTION_STATUSES).default("open"),
                    limit: z.coerce.number().int().min(1).max(100).default(50),
                    goalId: z.string().optional(),
                    bucket: z.enum(SUGGESTION_BUCKETS).optional(),
                }),
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

            const suggestions = await worldSuggestionQuery(userId, projectId, {
                status: request.query.status,
                limit: request.query.limit,
                goalId: request.query.goalId,
                bucket: request.query.bucket,
            });

            return reply.send({ suggestions });
        },
    );

    app.post(
        "/v1/projects/:id/world/suggestions/refresh",
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

            const result = await worldSuggestionRefresh(userId, projectId);
            return reply.send(result);
        },
    );

    app.post(
        "/v1/projects/:id/world/suggestions/:suggestionId/accept",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    suggestionId: z.string(),
                }),
                body: AcceptBodySchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;
            const { suggestionId } = request.params;
            const body = request.body as AcceptBody;

            const project = await db.project.findFirst({
                where: { id: projectId, accountId: userId },
                select: { id: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            try {
                const result = await worldSuggestionAccept({
                    accountId: userId,
                    projectId,
                    suggestionId,
                    machineId: body.machineId,
                    priorityOverride: body.priorityOverride,
                    roleOverride: body.roleOverride,
                });
                return reply.send(result);
            } catch (e: any) {
                return reply.code(400).send({ error: e.message ?? "Accept failed" });
            }
        },
    );

    app.get(
        "/v1/projects/:id/world/audit-log",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: z.object({
                    limit: z.coerce.number().int().min(1).max(100).default(50),
                }),
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

            const entries = await db.worldSuggestion.findMany({
                where: {
                    accountId: userId,
                    projectId,
                    acceptSource: "system_auto",
                    status: { in: ["accepted", "dismissed"] },
                },
                orderBy: { actedAt: "desc" },
                take: request.query.limit,
                select: {
                    id: true,
                    type: true,
                    title: true,
                    status: true,
                    acceptAudit: true,
                    actedAt: true,
                    autoAcceptStatus: true,
                    autoAcceptReasonCode: true,
                },
            });

            return reply.send({ entries });
        },
    );

    app.post(
        "/v1/projects/:id/world/veto/:suggestionId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    suggestionId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;
            const { suggestionId } = request.params;

            const project = await db.project.findFirst({
                where: { id: projectId, accountId: userId },
                select: { id: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const result = await vetoWorldSuggestion({
                accountId: userId,
                projectId,
                suggestionId,
            });

            if (!result.vetoed) {
                return reply.code(400).send({ error: result.reason ?? "Veto failed" });
            }

            return reply.send({ success: true });
        },
    );

    app.patch(
        "/v1/projects/:id/world/policy",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    supervisorMode: z.enum(["disabled", "suggest", "semi-auto", "auto"]).optional(),
                    maxAutoAcceptsPerDay: z.number().int().positive().nullable().optional(),
                    maxConcurrentAutoTasks: z.number().int().positive().nullable().optional(),
                    autoAcceptTypes: z.array(z.string()).optional(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;
            const body = request.body as {
                supervisorMode?: string;
                maxAutoAcceptsPerDay?: number | null;
                maxConcurrentAutoTasks?: number | null;
                autoAcceptTypes?: string[];
            };

            const project = await db.project.findFirst({
                where: { id: projectId, accountId: userId },
                select: { id: true, supervisorConfig: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Merge new autoAccept params into existing supervisorConfig JSON
            let cfg: Record<string, unknown> = {};
            try {
                if (project.supervisorConfig) cfg = JSON.parse(project.supervisorConfig) as Record<string, unknown>;
            } catch { /* start fresh */ }

            const wa = (typeof cfg.worldAutonomy === "object" && cfg.worldAutonomy !== null)
                ? { ...(cfg.worldAutonomy as Record<string, unknown>) }
                : {};

            if (body.maxAutoAcceptsPerDay !== undefined) wa.maxAutoAcceptsPerDay = body.maxAutoAcceptsPerDay;
            if (body.maxConcurrentAutoTasks !== undefined) wa.maxConcurrentAutoTasks = body.maxConcurrentAutoTasks;
            if (body.autoAcceptTypes !== undefined) wa.autoAcceptTypes = body.autoAcceptTypes;
            cfg.worldAutonomy = wa;

            const updateData: Record<string, unknown> = {
                supervisorConfig: JSON.stringify(cfg),
            };
            if (body.supervisorMode !== undefined) {
                updateData.supervisorMode = body.supervisorMode;
            }

            await db.project.update({
                where: { id: projectId },
                data: updateData as any,
            });

            return reply.send({ success: true });
        },
    );

    app.post(
        "/v1/projects/:id/world/suggestions/:suggestionId/dismiss",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                    suggestionId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;
            const { suggestionId } = request.params;

            const project = await db.project.findFirst({
                where: { id: projectId, accountId: userId },
                select: { id: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            try {
                await worldSuggestionDismiss(userId, projectId, suggestionId);
                return reply.send({ success: true });
            } catch (e: any) {
                return reply.code(400).send({ error: e.message ?? "Dismiss failed" });
            }
        },
    );
}
