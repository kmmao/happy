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
import { AcceptBodySchema, SUGGESTION_BUCKETS, SUGGESTION_STATUSES, type AcceptBody } from "@kmmao/happy-wire";

export function worldSuggestionRoutes(app: Fastify) {
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
