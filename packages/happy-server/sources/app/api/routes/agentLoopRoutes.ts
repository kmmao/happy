/**
 * Generic AgentLoop routes — ADR-0022 Phase 3b.
 *
 * `/v1/projects/:projectId/agent-loops` family for the unified loop
 * primitive. Phase 3b ships generic-role CRUD here; supervisor-role
 * loops keep their existing `/v1/projects/:id/supervisor/loop` routes
 * until Phase 4 collapses both behind a `role` filter.
 *
 * Per-route ownership goes through `ownedProject` / `ownedAgentLoop` —
 * the standard 404 handler in api.ts maps the OwnedEntityNotFound
 * exception to the flat error shape every other route uses.
 */

import { z } from "zod";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import {
    CreateGenericAgentLoopBodySchema,
    UpdateGenericAgentLoopBodySchema,
    ListAgentLoopsQuerySchema,
    AgentLoopIterationReportSchema,
} from "@kmmao/happy-wire";
import { ownedProject, ownedAgentLoop } from "../ownership";
import {
    createGenericAgentLoop,
    updateGenericAgentLoop,
    deleteGenericAgentLoop,
    handleAgentLoopIterationCallback,
    serializeAgentLoop,
} from "@/modules/agentLoopEngine";
import { emitSyncUpdate } from "@/app/events/syncUpdate";

export function agentLoopRoutes(app: Fastify) {
    // ───────────────────────────────────────────────────────────────
    // POST /v1/projects/:projectId/agent-loops — Create generic loop
    // ───────────────────────────────────────────────────────────────
    app.post(
        "/v1/projects/:projectId/agent-loops",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ projectId: z.string() }),
                body: CreateGenericAgentLoopBodySchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { projectId } = request.params;

            await ownedProject(userId, projectId);

            const result = await createGenericAgentLoop({
                userId,
                projectId,
                body: request.body,
            });
            if (!result.ok) {
                return reply.code(result.code).send({ error: result.error });
            }

            const loop = await db.agentLoop.findUnique({
                where: { id: result.value.loopId },
            });
            return reply.send({ loop: loop ? serializeAgentLoop(loop) : null });
        },
    );

    // ───────────────────────────────────────────────────────────────
    // GET /v1/projects/:projectId/agent-loops — List loops for project
    // ───────────────────────────────────────────────────────────────
    app.get(
        "/v1/projects/:projectId/agent-loops",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ projectId: z.string() }),
                querystring: ListAgentLoopsQuerySchema.partial(),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { projectId } = request.params;
            const role = request.query?.role ?? "generic";
            const limit = request.query?.limit ?? 50;
            const offset = request.query?.offset ?? 0;

            await ownedProject(userId, projectId);

            const where = { projectId, accountId: userId, role };
            const [loops, total] = await Promise.all([
                db.agentLoop.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip: offset,
                }),
                db.agentLoop.count({ where }),
            ]);

            return reply.send({
                loops: loops.map(serializeAgentLoop),
                total,
            });
        },
    );

    // ───────────────────────────────────────────────────────────────
    // GET /v1/projects/:projectId/agent-loops/:loopId — Detail
    // ───────────────────────────────────────────────────────────────
    app.get(
        "/v1/projects/:projectId/agent-loops/:loopId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    projectId: z.string(),
                    loopId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { loopId } = request.params;
            const loop = await ownedAgentLoop(userId, loopId);
            return reply.send({ loop: serializeAgentLoop(loop) });
        },
    );

    // ───────────────────────────────────────────────────────────────
    // PATCH /v1/projects/:projectId/agent-loops/:loopId — Update
    // ───────────────────────────────────────────────────────────────
    app.patch(
        "/v1/projects/:projectId/agent-loops/:loopId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    projectId: z.string(),
                    loopId: z.string(),
                }),
                body: UpdateGenericAgentLoopBodySchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { loopId } = request.params;

            const result = await updateGenericAgentLoop({
                userId,
                loopId,
                body: request.body,
            });
            if (!result.ok) {
                return reply.code(result.code).send({ error: result.error });
            }
            return reply.send({ loop: serializeAgentLoop(result.value.loop) });
        },
    );

    // ───────────────────────────────────────────────────────────────
    // DELETE /v1/projects/:projectId/agent-loops/:loopId
    // ───────────────────────────────────────────────────────────────
    app.delete(
        "/v1/projects/:projectId/agent-loops/:loopId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    projectId: z.string(),
                    loopId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { loopId } = request.params;
            const result = await deleteGenericAgentLoop({ userId, loopId });
            if (!result.ok) {
                return reply.code(result.code).send({ error: result.error });
            }
            return reply.send({ deleted: true });
        },
    );

    // ───────────────────────────────────────────────────────────────
    // POST /v1/projects/:projectId/agent-loops/:loopId/enable
    // POST /v1/projects/:projectId/agent-loops/:loopId/disable
    // Convenience wrappers around PATCH { enabled: true/false }.
    // ───────────────────────────────────────────────────────────────
    for (const action of ["enable", "disable"] as const) {
        app.post(
            `/v1/projects/:projectId/agent-loops/:loopId/${action}`,
            {
                preHandler: app.authenticate,
                schema: {
                    params: z.object({
                        projectId: z.string(),
                        loopId: z.string(),
                    }),
                },
            },
            async (request, reply) => {
                const userId = request.userId;
                const { loopId } = request.params;
                const result = await updateGenericAgentLoop({
                    userId,
                    loopId,
                    body: { enabled: action === "enable" },
                });
                if (!result.ok) {
                    return reply.code(result.code).send({ error: result.error });
                }
                return reply.send({ loop: serializeAgentLoop(result.value.loop) });
            },
        );
    }

    // ───────────────────────────────────────────────────────────────
    // POST /v1/projects/:projectId/agent-loops/:loopId/iterations
    // CLI daemon → server. Bearer token from the trigger ephemeral
    // (stateless HMAC; see agentLoopEngine.buildCallbackToken). No
    // `app.authenticate` — token IS the auth.
    // ───────────────────────────────────────────────────────────────
    app.post(
        "/v1/projects/:projectId/agent-loops/:loopId/iterations",
        {
            schema: {
                params: z.object({
                    projectId: z.string(),
                    loopId: z.string(),
                }),
                body: AgentLoopIterationReportSchema,
            },
        },
        async (request, reply) => {
            const { loopId } = request.params;

            const authHeader = request.headers["authorization"];
            const bearer =
                typeof authHeader === "string" && authHeader.startsWith("Bearer ")
                    ? authHeader.slice(7).trim()
                    : null;
            if (!bearer) {
                return reply.code(401).send({ error: "Missing Bearer token" });
            }

            const result = await handleAgentLoopIterationCallback({
                loopId,
                bearerToken: bearer,
                body: request.body,
            });
            if (!result.ok) {
                return reply.code(result.code).send({ error: result.error });
            }
            return reply.send({ loop: serializeAgentLoop(result.value.loop) });
        },
    );

    // Reference to silence unused-import linter if emitSyncUpdate ends up
    // unused after future refactors. Cheap and explicit.
    void emitSyncUpdate;
}
