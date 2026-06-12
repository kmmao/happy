import { emitSyncUpdate } from "@/app/events/syncUpdate";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { assertOwnedProject } from "../ownership";

/**
 * Project CRUD + resolve routes.
 * Projects are identified by (accountId, machineId, path).
 * metadata field is E2E encrypted — Server treats it as opaque string.
 */
export function projectRoutes(app: Fastify) {
    // GET /v1/projects — List all projects for the authenticated user
    app.get(
        "/v1/projects",
        {
            preHandler: app.authenticate,
            schema: {
                querystring: z
                    .object({
                        archived: z.coerce.boolean().optional(),
                        limit: z.coerce.number().int().min(1).max(100).optional(),
                        cursor: z.string().optional(),
                    })
                    .optional(),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const archived = request.query?.archived;
            const limit = request.query?.limit ?? 50;
            const cursor = request.query?.cursor;

            const where: { accountId: string; archived?: boolean; path?: { not: { contains: string } } } = {
                accountId: userId,
                // Exclude worktree-path projects — they belong to their parent project
                path: { not: { contains: ".dev/worktree/" } },
            };
            if (archived !== undefined) {
                where.archived = archived;
            }

            const rows = await db.project.findMany({
                where,
                orderBy: { updatedAt: "desc" },
                take: limit + 1,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                include: {
                    _count: { select: { sessions: true } },
                },
            });

            const hasNextPage = rows.length > limit;
            const projects = hasNextPage ? rows.slice(0, limit) : rows;
            const nextCursor = hasNextPage ? projects[projects.length - 1].id : null;

            return reply.send({
                projects: projects.map((p) => ({
                    ...serializeProject(p),
                    sessionCount: p._count.sessions,
                })),
                nextCursor,
            });
        },
    );

    // POST /v1/projects — Create a new project (idempotent via upsert)
    app.post(
        "/v1/projects",
        {
            preHandler: app.authenticate,
            schema: {
                body: z.object({
                    machineId: z.string(),
                    path: z.string(),
                    repoUrl: z.string().nullish(),
                    metadata: z.string().nullish(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { machineId, path, repoUrl, metadata } = request.body;

            const uniqueKey = {
                accountId: userId,
                machineId,
                path,
            };

            // Use upsert to avoid TOCTOU race condition
            const result = await db.project.upsert({
                where: { accountId_machineId_path: uniqueKey },
                create: {
                    accountId: userId,
                    machineId,
                    path,
                    repoUrl: repoUrl || null,
                    metadata: metadata || null,
                    metadataVersion: metadata ? 1 : 0,
                },
                update: {},
            });

            // Determine if this was a create by checking if createdAt ~ updatedAt
            const wasCreated =
                Math.abs(result.createdAt.getTime() - result.updatedAt.getTime()) < 100;

            if (wasCreated) {
                // new-project. Seam owns seq + id + recipient (ADR-0023).
                await emitSyncUpdate(userId, { t: "new-project", project: result });
            }

            return reply.send({
                project: serializeProject(result),
                created: wasCreated,
            });
        },
    );

    // GET /v1/projects/:id — Get project details
    app.get(
        "/v1/projects/:id",
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
                include: {
                    _count: { select: { sessions: true } },
                },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            return reply.send({
                project: {
                    ...serializeProject(project),
                    sessionCount: project._count.sessions,
                },
            });
        },
    );

    // PATCH /v1/projects/:id — Update project
    app.patch(
        "/v1/projects/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    metadata: z.string().nullish(),
                    repoUrl: z.string().nullish(),
                    archived: z.boolean().optional(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const { metadata, repoUrl, archived } = request.body;

            await assertOwnedProject(userId, id);

            const data: Prisma.ProjectUpdateInput = {};
            if (metadata !== undefined) {
                data.metadata = metadata;
                data.metadataVersion = { increment: 1 };
            }
            if (repoUrl !== undefined) {
                data.repoUrl = repoUrl;
            }
            if (archived !== undefined) {
                data.archived = archived;
            }

            const updated = await db.project.update({
                where: { id },
                data,
            });

            // Broadcast update-project. Seam owns seq + id + recipient (ADR-0023).
            await emitSyncUpdate(userId, {
                t: "update-project",
                projectId: updated.id,
                metadata: metadata !== undefined
                    ? { value: updated.metadata, version: updated.metadataVersion }
                    : undefined,
                archived,
            });

            return reply.send({
                project: serializeProject(updated),
            });
        },
    );

    // DELETE /v1/projects/:id — Delete project (sessions get projectId set to null)
    app.delete(
        "/v1/projects/:id",
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

            // Sessions will have projectId set to null via onDelete: SetNull
            await db.project.delete({ where: { id } });

            // Broadcast delete-project. Seam owns seq + id + recipient (ADR-0023).
            await emitSyncUpdate(userId, { t: "delete-project", projectId: id });

            return reply.send({ ok: true });
        },
    );

    // POST /v1/projects/resolve — Find or create by machineId + path (idempotent)
    app.post(
        "/v1/projects/resolve",
        {
            preHandler: app.authenticate,
            schema: {
                body: z.object({
                    machineId: z.string(),
                    path: z.string(),
                    repoUrl: z.string().nullish(),
                    metadata: z.string().nullish(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { machineId, path, repoUrl, metadata } = request.body;

            // Use upsert to atomically find-or-create, eliminating TOCTOU race
            const result = await db.project.upsert({
                where: {
                    accountId_machineId_path: {
                        accountId: userId,
                        machineId,
                        path,
                    },
                },
                create: {
                    accountId: userId,
                    machineId,
                    path,
                    repoUrl: repoUrl || null,
                    metadata: metadata || null,
                    metadataVersion: metadata ? 1 : 0,
                },
                update: repoUrl ? { repoUrl } : {},
            });

            const wasCreated =
                Math.abs(result.createdAt.getTime() - result.updatedAt.getTime()) < 100;

            if (wasCreated) {
                // new-project. Seam owns seq + id + recipient (ADR-0023).
                await emitSyncUpdate(userId, { t: "new-project", project: result });
            }

            return reply.send({
                project: serializeProject(result),
                created: wasCreated,
            });
        },
    );

    // POST /v1/projects/:id/link-sessions — Batch link sessions to a project
    app.post(
        "/v1/projects/:id/link-sessions",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: z.object({
                    sessionIds: z.array(z.string()).min(1).max(500),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;
            const { sessionIds } = request.body;

            await assertOwnedProject(userId, id);

            // Update sessions to link to this project
            const result = await db.session.updateMany({
                where: {
                    id: { in: sessionIds },
                    accountId: userId,
                },
                data: { projectId: id },
            });

            return reply.send({
                linked: result.count,
            });
        },
    );

    // GET /v1/projects/:id/related — Find projects with the same repoUrl on other machines
    app.get(
        "/v1/projects/:id/related",
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
                select: { id: true, repoUrl: true },
            });

            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            if (!project.repoUrl) {
                return reply.send({ related: [] });
            }

            const related = await db.project.findMany({
                where: {
                    accountId: userId,
                    repoUrl: project.repoUrl,
                    id: { not: id },
                    archived: false,
                },
                select: {
                    id: true,
                    machineId: true,
                    path: true,
                    repoUrl: true,
                    supervisorMode: true,
                    createdAt: true,
                    updatedAt: true,
                },
                orderBy: { updatedAt: "desc" },
                take: 10,
            });

            // Machine metadata is encrypted, so we return machineId as the name
            return reply.send({
                related: related.map((p) => ({
                    id: p.id,
                    machineId: p.machineId,
                    machineName: p.machineId,
                    path: p.path,
                    repoUrl: p.repoUrl,
                    supervisorMode: p.supervisorMode,
                    updatedAt: p.updatedAt.getTime(),
                })),
            });
        },
    );
}

function serializeProject(project: {
    id: string;
    machineId: string;
    path: string;
    repoUrl: string | null;
    metadata: string | null;
    metadataVersion: number;
    supervisorConfig: string | null;
    supervisorConfigVersion: number;
    supervisorMode: string | null;
    supervisorScheduleEnabled: boolean;
    supervisorScheduleIntervalHours: number | null;
    supervisorEnabledDimensions: string | null;
    supervisorPushTriggerEnabled: boolean;
    supervisorCustomRules: string | null;
    autoLoopHealthThreshold: number | null;
    autoLoopDebounceMinutes: number;
    archived: boolean;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: project.id,
        machineId: project.machineId,
        path: project.path,
        repoUrl: project.repoUrl,
        metadata: project.metadata,
        metadataVersion: project.metadataVersion,
        supervisorConfig: project.supervisorConfig,
        supervisorConfigVersion: project.supervisorConfigVersion,
        supervisorMode: project.supervisorMode,
        supervisorScheduleEnabled: project.supervisorScheduleEnabled,
        supervisorScheduleIntervalHours: project.supervisorScheduleIntervalHours,
        supervisorEnabledDimensions: project.supervisorEnabledDimensions,
        supervisorPushTriggerEnabled: project.supervisorPushTriggerEnabled,
        supervisorCustomRules: project.supervisorCustomRules,
        autoLoopHealthThreshold: project.autoLoopHealthThreshold,
        autoLoopDebounceMinutes: project.autoLoopDebounceMinutes,
        archived: project.archived,
        createdAt: project.createdAt.getTime(),
        updatedAt: project.updatedAt.getTime(),
    };
}
