import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { getRelations, addRelations, removeRelationById, serializeRelation, type KnowledgeRelationType } from "@/modules/knowledgeRelation";
import { runDecayArchive } from "@/modules/knowledgeDecay";
import { runMergeJob } from "@/modules/knowledgeMergeJob";
import { resolveKnowledgeConfig } from "@/modules/knowledgeConfigResolver";

/**
 * Knowledge lifecycle routes: relations, decay, merge, statistics.
 * Split from knowledgeRoutes.ts to keep files under 800 lines.
 */
export function knowledgeLifecycleRoutes(app: Fastify) {
    // ─── Get relations for a knowledge entry ───
    app.get(
        "/v1/projects/:id/knowledge/:entryId/relations",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), entryId: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, entryId } = request.params;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Verify entry belongs to this project
            const entry = await db.projectKnowledge.findFirst({
                where: { id: entryId, projectId: id },
            });
            if (!entry) {
                return reply.code(404).send({ error: "Entry not found in this project" });
            }

            const result = await getRelations(entryId);
            return reply.send({
                from: result.from.map(serializeRelation),
                to: result.to.map(serializeRelation),
            });
        },
    );

    // ─── Add relation between knowledge entries ───
    app.post(
        "/v1/projects/:id/knowledge/:entryId/relations",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), entryId: z.string() }),
                body: z.object({
                    toEntryId: z.string(),
                    relationType: z.enum(["related", "contradicts", "refines", "combines"]),
                    metadata: z.string().optional(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, entryId } = request.params;
            const { toEntryId, relationType, metadata } = request.body;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Verify both entries exist in this project
            const count = await db.projectKnowledge.count({
                where: { id: { in: [entryId, toEntryId] }, projectId: id },
            });
            if (count < 2) {
                return reply.code(404).send({ error: "One or both entries not found in this project" });
            }

            await addRelations([{
                fromId: entryId,
                toId: toEntryId,
                relationType: relationType as KnowledgeRelationType,
                metadata,
            }]);

            return reply.code(201).send({ success: true });
        },
    );

    // ─── Delete a relation ───
    app.delete(
        "/v1/projects/:id/knowledge/relations/:relationId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), relationId: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id, relationId } = request.params;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Verify the relation belongs to an entry in this project (prevent IDOR)
            const relation = await db.knowledgeRelation.findFirst({
                where: { id: relationId, fromEntry: { projectId: id } },
            });
            if (!relation) {
                return reply.code(404).send({ error: "Relation not found in this project" });
            }

            await removeRelationById(relationId);
            return reply.send({ success: true });
        },
    );

    // ─── Manual decay archive trigger ───
    app.post(
        "/v1/projects/:id/knowledge/decay",
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
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const config = await resolveKnowledgeConfig(id);
            if (!config.decayEnabled) {
                return reply.code(400).send({ error: "Decay is disabled for this project" });
            }

            const result = await runDecayArchive(id);
            return reply.send(result);
        },
    );

    // ─── Knowledge lifecycle statistics ───
    app.get(
        "/v1/projects/:id/knowledge/lifecycle",
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
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const [active, superseded, archived, totalRelations] = await Promise.all([
                db.projectKnowledge.count({ where: { projectId: id, status: "active" } }),
                db.projectKnowledge.count({ where: { projectId: id, status: "superseded" } }),
                db.projectKnowledge.count({ where: { projectId: id, status: "archived" } }),
                db.knowledgeRelation.count({
                    where: { fromEntry: { projectId: id } },
                }),
            ]);

            return reply.send({
                active,
                superseded,
                archived,
                total: active + superseded + archived,
                totalRelations,
            });
        },
    );

    // ─── Manual merge trigger ───
    app.post(
        "/v1/projects/:id/knowledge/merge",
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
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const config = await resolveKnowledgeConfig(id);
            if (!config.mergeEnabled) {
                return reply.code(400).send({ error: "Merge is disabled for this project" });
            }

            const result = await runMergeJob(id);
            return reply.send(result);
        },
    );
}
