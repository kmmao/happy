import { type Fastify } from "../types";
import { safeParseJsonArray } from "@/utils/safeJson";
import { db } from "@/storage/db";
import { z } from "zod";
import { log } from "@/utils/log";
import { assertOwnedProject, ownedSkill } from "../ownership";
import { parseSkillFrontmatter } from "@kmmao/happy-wire";

// Inline Zod schemas (mirrored from @kmmao/happy-wire/skills — will import after wire publish)

const CreateSkillBodySchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
    content: z.string().min(1).max(50000),
    projectId: z.string().optional(),
    attachments: z.array(z.string()).max(20).default([]),
    sourceKnowledgeId: z.string().optional(),
});

const UpdateSkillBodySchema = z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(500).nullable().optional(),
    content: z.string().min(1).max(50000).optional(),
    attachments: z.array(z.string()).max(20).optional(),
});

const QuerySkillsSchema = z.object({
    projectId: z.string().optional(),
    archived: z.preprocess(
        (val) => val === "true" ? true : val === "false" ? false : undefined,
        z.boolean().optional(),
    ),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Skill CRUD routes.
 * Skills are reusable instruction templates that can be attached to tasks.
 */
export function skillRoutes(app: Fastify) {
    // POST /v1/skills — create a new skill
    app.post(
        "/v1/skills",
        {
            preHandler: app.authenticate,
            schema: { body: CreateSkillBodySchema },
        },
        async (request, reply) => {
            const { name, description, content, projectId, attachments, sourceKnowledgeId } = request.body;

            // Verify project ownership if scoped
            if (projectId) {
                await assertOwnedProject(request.userId, projectId);
            }

            try {
                const skill = await db.skill.create({
                    data: {
                        accountId: request.userId,
                        projectId: projectId ?? null,
                        name,
                        description: description ?? null,
                        content,
                        attachments: JSON.stringify(attachments),
                        sourceKnowledgeId: sourceKnowledgeId ?? null,
                    },
                });

                log({ module: "skill" }, `Skill created: ${skill.id} "${name}"`);
                return reply.code(201).send({ skill: serializeSkill(skill) });
            } catch (e: any) {
                if (e.code === "P2002" && e.meta?.target?.includes("name")) {
                    return reply.code(409).send({ error: "skill-name-conflict" });
                }
                throw e;
            }
        },
    );

    // GET /v1/skills — list skills
    app.get(
        "/v1/skills",
        {
            preHandler: app.authenticate,
            schema: { querystring: QuerySkillsSchema },
        },
        async (request, reply) => {
            const { projectId, archived, limit, offset } = request.query;

            const where: Record<string, unknown> = {
                accountId: request.userId,
            };
            if (projectId !== undefined) {
                where.projectId = projectId;
            }
            if (archived !== undefined) {
                where.archived = archived;
            } else {
                where.archived = false;
            }

            const [skills, total] = await Promise.all([
                db.skill.findMany({
                    where,
                    orderBy: { updatedAt: "desc" },
                    take: limit,
                    skip: offset,
                }),
                db.skill.count({ where }),
            ]);

            return reply.send({
                skills: skills.map(serializeSkill),
                total,
            });
        },
    );

    // GET /v1/skills/:id — get single skill
    app.get(
        "/v1/skills/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const skill = await ownedSkill(request.userId, request.params.id);
            return reply.send({ skill: serializeSkill(skill) });
        },
    );

    // PATCH /v1/skills/:id — update skill
    app.patch(
        "/v1/skills/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: UpdateSkillBodySchema,
            },
        },
        async (request, reply) => {
            const skill = await ownedSkill(request.userId, request.params.id);

            const { name, description, content, attachments } = request.body;
            const data: Record<string, unknown> = {};

            if (name !== undefined) data.name = name;
            if (description !== undefined) data.description = description;
            if (attachments !== undefined) data.attachments = JSON.stringify(attachments);
            if (content !== undefined && content !== skill.content) {
                data.content = content;
                data.contentVersion = { increment: 1 };
            }

            try {
                const updated = await db.skill.update({
                    where: { id: skill.id },
                    data,
                });
                return reply.send({ skill: serializeSkill(updated) });
            } catch (e: any) {
                if (e.code === "P2002" && e.meta?.target?.includes("name")) {
                    return reply.code(409).send({ error: "skill-name-conflict" });
                }
                throw e;
            }
        },
    );

    // POST /v1/skills/:id/archive — toggle archived status
    app.post(
        "/v1/skills/:id/archive",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const skill = await ownedSkill(request.userId, request.params.id);

            const updated = await db.skill.update({
                where: { id: skill.id },
                data: { archived: !skill.archived },
            });
            return reply.send({ skill: serializeSkill(updated) });
        },
    );

    // DELETE /v1/skills/:id — hard delete (blocked if bound to active tasks)
    app.delete(
        "/v1/skills/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const skill = await ownedSkill(request.userId, request.params.id);

            // Check for active task bindings
            const activeBindings = await db.taskSkillBinding.count({
                where: {
                    skillId: skill.id,
                    task: {
                        status: { in: ["queued", "dispatching", "running"] },
                    },
                },
            });
            if (activeBindings > 0) {
                return reply.code(409).send({
                    error: "Skill is bound to active tasks and cannot be deleted. Archive it instead.",
                });
            }

            // Remove bindings first, then delete skill
            await db.taskSkillBinding.deleteMany({ where: { skillId: skill.id } });
            await db.skill.delete({ where: { id: skill.id } });

            return reply.send({ deleted: true });
        },
    );
}

// === Serialization ===

function serializeSkill(skill: Record<string, unknown>): Record<string, unknown> {
    const s = skill as {
        id: string;
        accountId: string;
        projectId: string | null;
        name: string;
        description: string | null;
        content: string;
        contentVersion: number;
        attachments: string;
        sourceKnowledgeId: string | null;
        archived: boolean;
        createdAt: Date;
        updatedAt: Date;
    };

    // Surface Phase 3 front-matter so the App can route/gate the skill (e.g.
    // hide model-invocation, show the target model). Parsing is cheap and keeps
    // the stored content untouched.
    const { frontmatter } = parseSkillFrontmatter(s.content);

    return {
        id: s.id,
        projectId: s.projectId,
        name: s.name,
        description: s.description,
        content: s.content,
        contentVersion: s.contentVersion,
        attachments: safeParseJsonArray(s.attachments),
        sourceKnowledgeId: s.sourceKnowledgeId,
        archived: s.archived,
        createdAt: s.createdAt.getTime(),
        updatedAt: s.updatedAt.getTime(),
        ...(frontmatter.model ? { model: frontmatter.model } : {}),
        ...(frontmatter.userInvocable !== undefined
            ? { userInvocable: frontmatter.userInvocable }
            : {}),
        ...(frontmatter.disableModelInvocation !== undefined
            ? { disableModelInvocation: frontmatter.disableModelInvocation }
            : {}),
    };
}
