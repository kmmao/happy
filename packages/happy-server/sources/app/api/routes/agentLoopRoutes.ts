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
    pauseGenericAgentLoop,
    resumeGenericAgentLoop,
    stopGenericAgentLoop,
    handleAgentLoopIterationCallback,
    serializeAgentLoop,
} from "@/modules/agentLoopEngine";
import {
    pauseLoop as pauseSupervisorLoop,
    resumeLoop as resumeSupervisorLoop,
    stopLoop as stopSupervisorLoop,
} from "@/modules/supervisorLoopEngine";
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
            const role = request.query?.role;
            const limit = request.query?.limit ?? 50;
            const offset = request.query?.offset ?? 0;

            await ownedProject(userId, projectId);

            // ADR-0022 Phase 4 — omitting `role` returns both supervisor
            // and generic rows. Explicit `role=...` narrows the query.
            const where = role
                ? { projectId, accountId: userId, role }
                : { projectId, accountId: userId };
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
    // DELETE /v1/projects/:projectId/agent-loops/:loopId — role-aware
    // (ADR-0022 Phase 4 unification). Generic rows go through the
    // engine helper that emits a SyncUpdate; supervisor rows mirror the
    // existing /v1/projects/:id/supervisor/loops/:loopId DELETE: refuse
    // active loops, delete inactive ones directly. Old supervisor route
    // is kept for compatibility (no behaviour change here).
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
            const { projectId, loopId } = request.params;
            const loop = await ownedAgentLoop(userId, loopId);
            if (loop.projectId !== projectId) {
                return reply.code(404).send({ error: "Loop not found" });
            }
            if (loop.role === "supervisor") {
                if (loop.status === "running" || loop.status === "paused") {
                    return reply
                        .code(409)
                        .send({ error: "Cannot delete an active loop. Stop it first." });
                }
                await db.agentLoop.delete({ where: { id: loopId } });
                return reply.send({ deleted: true });
            }
            const result = await deleteGenericAgentLoop({ userId, loopId });
            if (!result.ok) {
                return reply.code(result.code).send({ error: result.error });
            }
            return reply.send({ deleted: true });
        },
    );

    // ───────────────────────────────────────────────────────────────
    // POST /v1/projects/:projectId/agent-loops/:loopId/{pause,resume,stop}
    // Unified action endpoints. Dispatch by role: supervisor rows call
    // into supervisorLoopEngine (phase-aware, fires Run side effects);
    // generic rows use the agentLoopEngine helpers (enabled flag +
    // SyncUpdate). The endpoint signature is identical so the App can
    // drop the supervisor/generic split from its API client.
    // ───────────────────────────────────────────────────────────────
    for (const action of ["pause", "resume", "stop"] as const) {
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
                const { projectId, loopId } = request.params;
                const loop = await ownedAgentLoop(userId, loopId);
                if (loop.projectId !== projectId) {
                    return reply.code(404).send({ error: "Loop not found" });
                }

                if (loop.role === "supervisor") {
                    const fn =
                        action === "pause"
                            ? pauseSupervisorLoop
                            : action === "resume"
                              ? resumeSupervisorLoop
                              : stopSupervisorLoop;
                    const result = await fn(loopId, userId);
                    if (!result.success) {
                        return reply.code(404).send({
                            error:
                                action === "pause"
                                    ? "Active loop not found"
                                    : action === "resume"
                                      ? "Paused loop not found"
                                      : "Active loop not found",
                        });
                    }
                    const updated = await db.agentLoop.findUnique({ where: { id: loopId } });
                    return reply.send({
                        loop: updated ? serializeAgentLoop(updated) : null,
                    });
                }

                // Generic-role path.
                const fn =
                    action === "pause"
                        ? pauseGenericAgentLoop
                        : action === "resume"
                          ? resumeGenericAgentLoop
                          : stopGenericAgentLoop;
                const result = await fn({ userId, loopId });
                if (!result.ok) {
                    return reply.code(result.code).send({ error: result.error });
                }
                return reply.send({ loop: serializeAgentLoop(result.value.loop) });
            },
        );
    }

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
