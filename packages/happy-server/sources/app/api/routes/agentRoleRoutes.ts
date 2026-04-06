import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { log } from "@/utils/log";

const ROLE_TYPES = ["guardian", "builder", "healer", "chronicler", "planner", "custom"] as const;

const CreateAgentRoleBodySchema = z.object({
    projectId: z.string(),
    name: z.string().min(1).max(200),
    type: z.enum(ROLE_TYPES).default("custom"),
    description: z.string().max(5000).optional(),
    duties: z.array(z.string().max(200)).max(10).default([]),
    skillIds: z.array(z.string()).max(10).default([]),
    maxConcurrency: z.number().int().min(1).max(10).default(1),
    templateType: z.enum(ROLE_TYPES).optional(),
});

const UpdateAgentRoleBodySchema = z.object({
    name: z.string().min(1).max(200).optional(),
    type: z.enum(ROLE_TYPES).optional(),
    description: z.string().max(5000).nullable().optional(),
    duties: z.array(z.string().max(200)).max(10).optional(),
    skillIds: z.array(z.string()).max(10).optional(),
    maxConcurrency: z.number().int().min(1).max(10).optional(),
    enabled: z.boolean().optional(),
});

const QueryAgentRolesSchema = z.object({
    projectId: z.string(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});

// --- Preset Templates ---

const ROLE_TEMPLATES: Record<string, { description: string; duties: string[] }> = {
    guardian: {
        description: "You are the Guardian of this project. Your mission is to protect code quality, security, and compliance with project laws.",
        duties: [
            "Scan for security vulnerabilities",
            "Check dependency updates and known CVEs",
            "Verify compliance with project laws",
            "Report violations with evidence",
        ],
    },
    builder: {
        description: "You are the Builder. Your mission is to implement features and write code according to specifications.",
        duties: [
            "Implement assigned tasks and features",
            "Write tests for new code",
            "Follow project conventions and style guides",
            "Update documentation when needed",
        ],
    },
    healer: {
        description: "You are the Healer. Your mission is to diagnose and fix issues, monitor health, and optimize performance.",
        duties: [
            "Monitor build health and CI status",
            "Fix failing tests and broken builds",
            "Diagnose and fix performance issues",
            "Fix reported bugs with minimal changes",
        ],
    },
    chronicler: {
        description: "You are the Chronicler. Your mission is to maintain the project's knowledge base and documentation.",
        duties: [
            "Update knowledge base entries after significant changes",
            "Write changelog entries for releases",
            "Summarize session outcomes into knowledge",
            "Archive stale or superseded knowledge",
        ],
    },
    planner: {
        description: "You are the Planner. Your mission is to analyze goals, break them into tasks, and create execution plans.",
        duties: [
            "Analyze high-level project goals",
            "Break goals into actionable tasks with estimates",
            "Assess risks and dependencies",
            "Prioritize task execution order",
        ],
    },
};

/**
 * Agent Role CRUD routes.
 * Roles define the identity, duties, and skills for Agent Loops.
 */
export function agentRoleRoutes(app: Fastify) {
    // POST /v1/agent-roles — create a new role
    app.post(
        "/v1/agent-roles",
        {
            preHandler: app.authenticate,
            schema: { body: CreateAgentRoleBodySchema },
        },
        async (request, reply) => {
            const { projectId, name, type, description, duties, skillIds, maxConcurrency, templateType } = request.body;

            // Verify project ownership
            const project = await db.project.findFirst({
                where: { id: projectId, accountId: request.userId },
                select: { id: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Apply template defaults if requested
            const template = templateType ? ROLE_TEMPLATES[templateType] : undefined;
            const finalDescription = description ?? template?.description ?? null;
            const finalDuties = duties.length > 0 ? duties : (template?.duties ?? []);
            const finalType = templateType ?? type;

            try {
                const role = await db.agentRole.create({
                    data: {
                        accountId: request.userId,
                        projectId,
                        name,
                        type: finalType,
                        description: finalDescription,
                        duties: JSON.stringify(finalDuties),
                        skillIds: JSON.stringify(skillIds),
                        maxConcurrency,
                    },
                });

                log({ module: "agent-role" }, `AgentRole created: ${role.id} "${name}" (${finalType})`);
                return reply.code(201).send({ role: serializeAgentRole(role) });
            } catch (e: any) {
                if (e.code === "P2002" && e.meta?.target?.includes("name")) {
                    return reply.code(409).send({ error: "role-name-conflict" });
                }
                throw e;
            }
        },
    );

    // GET /v1/agent-roles — list roles for a project
    app.get(
        "/v1/agent-roles",
        {
            preHandler: app.authenticate,
            schema: { querystring: QueryAgentRolesSchema },
        },
        async (request, reply) => {
            const { projectId, limit, offset } = request.query;

            const where = {
                accountId: request.userId,
                projectId,
            };

            const [roles, total] = await Promise.all([
                db.agentRole.findMany({
                    where,
                    orderBy: { updatedAt: "desc" },
                    take: limit,
                    skip: offset,
                }),
                db.agentRole.count({ where }),
            ]);

            return reply.send({
                roles: roles.map(serializeAgentRole),
                total,
            });
        },
    );

    // GET /v1/agent-roles/:id — get single role
    app.get(
        "/v1/agent-roles/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const role = await db.agentRole.findFirst({
                where: { id: request.params.id, accountId: request.userId },
            });
            if (!role) {
                return reply.code(404).send({ error: "Agent role not found" });
            }
            return reply.send({ role: serializeAgentRole(role) });
        },
    );

    // GET /v1/agent-roles/:id/prompt-context — get role context for CLI prompt injection
    app.get(
        "/v1/agent-roles/:id/prompt-context",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const role = await db.agentRole.findFirst({
                where: { id: request.params.id, accountId: request.userId },
            });
            if (!role) {
                return reply.code(404).send({ error: "Agent role not found" });
            }

            // Resolve bound skills
            const skillIdList = safeParseJsonArray(role.skillIds);
            const skills = skillIdList.length > 0
                ? await db.skill.findMany({
                    where: {
                        id: { in: skillIdList },
                        accountId: request.userId,
                        archived: false,
                    },
                    select: { id: true, name: true, content: true },
                })
                : [];

            return reply.send({
                roleId: role.id,
                roleName: role.name,
                roleType: role.type,
                description: role.description,
                duties: safeParseJsonArray(role.duties),
                skills: skills.map((s) => ({ id: s.id, name: s.name, content: s.content })),
            });
        },
    );

    // PATCH /v1/agent-roles/:id — update role
    app.patch(
        "/v1/agent-roles/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: UpdateAgentRoleBodySchema,
            },
        },
        async (request, reply) => {
            const role = await db.agentRole.findFirst({
                where: { id: request.params.id, accountId: request.userId },
            });
            if (!role) {
                return reply.code(404).send({ error: "Agent role not found" });
            }

            const { name, type, description, duties, skillIds, maxConcurrency, enabled } = request.body;
            const data: Record<string, unknown> = {};

            if (name !== undefined) data.name = name;
            if (type !== undefined) data.type = type;
            if (description !== undefined) data.description = description;
            if (duties !== undefined) data.duties = JSON.stringify(duties);
            if (skillIds !== undefined) data.skillIds = JSON.stringify(skillIds);
            if (maxConcurrency !== undefined) data.maxConcurrency = maxConcurrency;
            if (enabled !== undefined) data.enabled = enabled;

            try {
                const updated = await db.agentRole.update({
                    where: { id: role.id },
                    data,
                });
                return reply.send({ role: serializeAgentRole(updated) });
            } catch (e: any) {
                if (e.code === "P2002" && e.meta?.target?.includes("name")) {
                    return reply.code(409).send({ error: "role-name-conflict" });
                }
                throw e;
            }
        },
    );

    // DELETE /v1/agent-roles/:id — hard delete
    app.delete(
        "/v1/agent-roles/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const role = await db.agentRole.findFirst({
                where: { id: request.params.id, accountId: request.userId },
            });
            if (!role) {
                return reply.code(404).send({ error: "Agent role not found" });
            }

            await db.agentRole.delete({ where: { id: role.id } });
            return reply.send({ deleted: true });
        },
    );

    // GET /v1/agent-roles/templates — list available preset templates
    app.get(
        "/v1/agent-roles/templates",
        {
            preHandler: app.authenticate,
        },
        async (_request, reply) => {
            const templates = Object.entries(ROLE_TEMPLATES).map(([type, tmpl]) => ({
                type,
                description: tmpl.description,
                duties: tmpl.duties,
            }));
            return reply.send({ templates });
        },
    );
}

// === Serialization ===

function serializeAgentRole(role: {
    id: string;
    projectId: string;
    name: string;
    type: string;
    description: string | null;
    duties: string;
    skillIds: string;
    maxConcurrency: number;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: role.id,
        projectId: role.projectId,
        name: role.name,
        type: role.type,
        description: role.description,
        duties: safeParseJsonArray(role.duties),
        skillIds: safeParseJsonArray(role.skillIds),
        maxConcurrency: role.maxConcurrency,
        enabled: role.enabled,
        createdAt: role.createdAt.getTime(),
        updatedAt: role.updatedAt.getTime(),
    };
}

function safeParseJsonArray(json: string): string[] {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
