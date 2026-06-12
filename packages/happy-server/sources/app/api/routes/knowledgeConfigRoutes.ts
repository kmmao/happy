import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { assertOwnedProject } from "../ownership";
import {
    KnowledgeConfigSchema,
    parseKnowledgeConfig,
    mergeWithDefaults,
    hasCustomConfig,
    getDefaults,
} from "@/modules/knowledgeConfigResolver";

/**
 * Project-level knowledge base configuration routes.
 * GET returns the resolved config (merged with defaults).
 * PATCH partially updates the project-level overrides.
 */
export function knowledgeConfigRoutes(app: Fastify) {
    // ─── Get project knowledge config ───
    app.get(
        "/v1/projects/:id/knowledge/config",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            // Narrow data select (ADR-0027: data-bearing selects stay
            // hand-rolled) — the handler needs only knowledgeConfig.
            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { knowledgeConfig: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const parsed = parseKnowledgeConfig(project.knowledgeConfig);
            const resolved = mergeWithDefaults(parsed);
            const isCustomized = hasCustomConfig(project.knowledgeConfig);

            return reply.send({
                config: resolved,
                isCustomized,
                defaults: getDefaults(),
            });
        },
    );

    // ─── Update project knowledge config (partial merge) ───
    app.patch(
        "/v1/projects/:id/knowledge/config",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: KnowledgeConfigSchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const updates = request.body;

            const project = await db.project.findFirst({
                where: { id, accountId: userId },
                select: { knowledgeConfig: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Merge updates into existing config
            const existing = parseKnowledgeConfig(project.knowledgeConfig) ?? {};
            const merged = { ...existing, ...updates };

            await db.project.update({
                where: { id },
                data: { knowledgeConfig: JSON.stringify(merged) },
            });

            const resolved = mergeWithDefaults(merged);
            return reply.send({
                config: resolved,
                isCustomized: true,
            });
        },
    );

    // ─── Reset project knowledge config to defaults ───
    app.delete(
        "/v1/projects/:id/knowledge/config",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            await assertOwnedProject(userId, id);

            await db.project.update({
                where: { id },
                data: { knowledgeConfig: null },
            });

            return reply.send({
                config: getDefaults(),
                isCustomized: false,
            });
        },
    );
}
