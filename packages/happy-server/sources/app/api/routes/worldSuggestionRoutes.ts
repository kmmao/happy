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
import { AcceptBodySchema } from "@/modules/worldSuggestionTypes";

export function worldSuggestionRoutes(app: Fastify) {

    // GET /v1/projects/:id/world/suggestions — list open suggestions
    app.get(
        "/v1/projects/:id/world/suggestions",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: z.object({
                    status: z.enum(["open", "accepted", "dismissed"]).default("open"),
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

            const suggestions = await worldSuggestionQuery(
                userId,
                projectId,
                {
                    status: request.query.status,
                    limit: request.query.limit,
                },
            );

            return reply.send({ suggestions });
        },
    );

    // POST /v1/projects/:id/world/suggestions/refresh — regenerate from fact sources
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

    // POST /v1/projects/:id/world/suggestions/:suggestionId/accept
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
                    machineId: request.body.machineId,
                    priorityOverride: request.body.priorityOverride,
                    roleOverride: request.body.roleOverride,
                });
                return reply.send(result);
            } catch (e: any) {
                return reply.code(400).send({ error: e.message ?? "Accept failed" });
            }
        },
    );

    // POST /v1/projects/:id/world/suggestions/:suggestionId/dismiss
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
