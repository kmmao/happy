import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { assertOwnedSession, ownedSession } from "../ownership";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import {
    PreviewCandidateReportSchema,
    DEFAULT_PREVIEW_LEASE_MS,
    DEFAULT_PREVIEW_IDLE_TIMEOUT_MS,
    PREVIEW_CREATE_RATE_LIMIT_WINDOW_MS,
    PREVIEW_CREATE_RATE_LIMIT_MAX,
} from "@kmmao/happy-wire";
import { previewStore } from "@/app/preview/previewStore";
import { eventRouter } from "@/app/events/eventRouter";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";

// F7: per-user sliding-window rate limit for tunnel creation
const createAttempts = new Map<string, number[]>(); // userId → recent createdAt[]

function checkAndRecordCreateAttempt(userId: string): { ok: true } | { ok: false; retryAfterMs: number } {
    const now = Date.now();
    const cutoff = now - PREVIEW_CREATE_RATE_LIMIT_WINDOW_MS;
    const attempts = (createAttempts.get(userId) ?? []).filter((t) => t > cutoff);
    if (attempts.length >= PREVIEW_CREATE_RATE_LIMIT_MAX) {
        const oldest = attempts[0]!;
        return { ok: false, retryAfterMs: oldest + PREVIEW_CREATE_RATE_LIMIT_WINDOW_MS - now };
    }
    attempts.push(now);
    createAttempts.set(userId, attempts);
    return { ok: true };
}

/**
 * REST routes for preview lifecycle.
 * Manages preview candidate reporting, tunnel creation, and revocation.
 */
export function previewRoutes(app: Fastify) {
    // POST /v3/sessions/:sessionId/preview/candidates — Report a preview candidate
    app.post(
        "/v3/sessions/:sessionId/preview/candidates",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ sessionId: z.string() }),
                body: PreviewCandidateReportSchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { sessionId } = request.params;
            const candidateData = request.body;

            const session = await ownedSession(userId, sessionId);

            // Resolve machineId from session's project
            let candidateMachineId = "";
            if (session.projectId) {
                const project = await db.project.findUnique({
                    where: { id: session.projectId },
                    select: { machineId: true },
                });
                if (project) candidateMachineId = project.machineId;
            }

            // Generate candidate ID
            const candidateId = randomKeyNaked(12);

            // Store candidate
            const candidate = {
                id: candidateId,
                sessionId,
                machineId: candidateMachineId,
                state: "available",
                protocol: candidateData.protocol || "http",
                host: candidateData.host,
                port: candidateData.port,
                path: candidateData.path,
                devServerType: candidateData.devServerType,
                command: candidateData.command,
                cwd: candidateData.cwd,
                pid: candidateData.pid,
                reportedAt: Date.now(),
            };

            previewStore.addCandidate(candidate);

            // Emit ephemeral event to all interested clients.
            await emitSyncEphemeral(userId, {
                t: "preview-candidate-reported",
                sessionId,
                candidate: {
                    id: candidate.id,
                    sessionId: candidate.sessionId,
                    state: candidate.state,
                    protocol: candidate.protocol,
                    host: candidate.host,
                    port: candidate.port,
                    path: candidate.path,
                    devServerType: candidate.devServerType,
                    reportedAt: candidate.reportedAt,
                },
            });

            return reply.send({
                candidateId,
                state: "available",
            });
        },
    );

    // POST /v3/sessions/:sessionId/preview/create — Create tunnel
    app.post(
        "/v3/sessions/:sessionId/preview/create",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ sessionId: z.string() }),
                body: z.object({
                    candidateId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { sessionId } = request.params;
            const { candidateId } = request.body;

            // F7: rate limit (5 creates per minute per user)
            const rate = checkAndRecordCreateAttempt(userId);
            if (!rate.ok) {
                reply.header("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
                return reply.status(429).send({
                    error: "rate-limit-exceeded",
                    retryAfterMs: rate.retryAfterMs,
                });
            }

            const session = await ownedSession(userId, sessionId);

            // Get project to find machineId
            let machineId = "";
            if (session.projectId) {
                const project = await db.project.findUnique({
                    where: { id: session.projectId },
                    select: { machineId: true },
                });
                if (project) {
                    machineId = project.machineId;
                }
            }

            // Verify candidate exists and is available
            const candidate = previewStore.getCandidate(candidateId);
            if (!candidate || candidate.state !== "available") {
                return reply.status(400).send({ error: "candidate-not-available" });
            }

            // Generate tunnel ID
            const tunnelId = randomKeyNaked(12);

            // Get server base URL
            const serverUrl = process.env.PREVIEW_SERVER_URL || "http://localhost:3005";
            const publicUrl = `${serverUrl}/preview/${tunnelId}`;

            // Store connection
            const now = Date.now();
            const connection = {
                tunnelId,
                candidateId,
                sessionId,
                machineId,
                publicUrl,
                status: "active",
                createdAt: now,
                leaseExpiresAt: now + DEFAULT_PREVIEW_LEASE_MS,
                idleTimeoutMs: DEFAULT_PREVIEW_IDLE_TIMEOUT_MS,
                lastActiveAt: now,
            };

            previewStore.addConnection(connection);

            // Tell the CLI daemon to start proxying HTTP/WS requests
            const machineSocket = eventRouter.findMachineSocket(machineId);
            if (machineSocket) {
                machineSocket.emit("preview-start-proxy", {
                    tunnelId,
                    candidate: {
                        protocol: candidate.protocol,
                        host: candidate.host,
                        port: candidate.port,
                    },
                });
            }

            // Emit ephemeral event.
            await emitSyncEphemeral(userId, {
                t: "preview-connection-updated",
                sessionId,
                connection: {
                    tunnelId: connection.tunnelId,
                    candidateId: connection.candidateId,
                    sessionId: connection.sessionId,
                    publicUrl: connection.publicUrl,
                    status: connection.status,
                    createdAt: connection.createdAt,
                    leaseExpiresAt: connection.leaseExpiresAt,
                    idleTimeoutMs: connection.idleTimeoutMs,
                    lastActiveAt: connection.lastActiveAt,
                },
            });

            return reply.send({
                tunnelId,
                publicUrl,
                status: "active",
                createdAt: now,
                leaseExpiresAt: connection.leaseExpiresAt,
            });
        },
    );

    // POST /v3/sessions/:sessionId/preview/revoke — Revoke tunnel
    app.post(
        "/v3/sessions/:sessionId/preview/revoke",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ sessionId: z.string() }),
                body: z.object({
                    tunnelId: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { sessionId } = request.params;
            const { tunnelId } = request.body;

            await assertOwnedSession(userId, sessionId);

            // Tell daemon to stop proxying
            const existingConnection = previewStore.getConnection(tunnelId);
            if (existingConnection) {
                const machineSocket = eventRouter.findMachineSocket(existingConnection.machineId);
                if (machineSocket) {
                    machineSocket.emit("preview-stop-proxy", {});
                }
            }

            // Remove connection
            previewStore.removeConnection(tunnelId);

            // Emit ephemeral event with null connection (indicating revoked).
            await emitSyncEphemeral(userId, {
                t: "preview-connection-updated",
                sessionId,
                connection: null,
            });

            return reply.send({ ok: true });
        },
    );

    // POST /v3/sessions/:sessionId/preview/refresh — Extend tunnel lease (F5)
    app.post(
        "/v3/sessions/:sessionId/preview/refresh",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ sessionId: z.string() }),
                body: z.object({ tunnelId: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { sessionId } = request.params;
            const { tunnelId } = request.body;

            await assertOwnedSession(userId, sessionId);

            const conn = previewStore.getConnection(tunnelId);
            if (!conn || conn.sessionId !== sessionId) {
                return reply.status(404).send({ error: "tunnel-not-found" });
            }

            const refreshed = previewStore.refreshLease(tunnelId, DEFAULT_PREVIEW_LEASE_MS);
            if (!refreshed) {
                return reply.status(404).send({ error: "tunnel-not-found" });
            }

            // Broadcast updated lease so app updates its countdown.
            await emitSyncEphemeral(userId, {
                t: "preview-connection-updated",
                sessionId,
                connection: {
                    tunnelId: refreshed.tunnelId,
                    candidateId: refreshed.candidateId,
                    sessionId: refreshed.sessionId,
                    publicUrl: refreshed.publicUrl,
                    status: refreshed.status,
                    createdAt: refreshed.createdAt,
                    leaseExpiresAt: refreshed.leaseExpiresAt,
                    idleTimeoutMs: refreshed.idleTimeoutMs,
                    lastActiveAt: refreshed.lastActiveAt,
                },
            });

            return reply.send({
                leaseExpiresAt: refreshed.leaseExpiresAt,
                lastActiveAt: refreshed.lastActiveAt,
            });
        },
    );

    // GET /v3/sessions/:sessionId/preview — Get current preview state
    app.get(
        "/v3/sessions/:sessionId/preview",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ sessionId: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { sessionId } = request.params;

            await assertOwnedSession(userId, sessionId);

            const candidate = previewStore.getCandidateBySession(sessionId);
            const connection = previewStore.getConnectionBySession(sessionId);

            return reply.send({
                candidate: candidate ? {
                    id: candidate.id,
                    sessionId: candidate.sessionId,
                    state: candidate.state,
                    protocol: candidate.protocol,
                    host: candidate.host,
                    port: candidate.port,
                    path: candidate.path,
                    devServerType: candidate.devServerType,
                    reportedAt: candidate.reportedAt,
                } : null,
                connection: connection ? {
                    tunnelId: connection.tunnelId,
                    candidateId: connection.candidateId,
                    sessionId: connection.sessionId,
                    machineId: connection.machineId,
                    publicUrl: connection.publicUrl,
                    status: connection.status,
                    createdAt: connection.createdAt,
                    leaseExpiresAt: connection.leaseExpiresAt,
                    idleTimeoutMs: connection.idleTimeoutMs,
                    lastActiveAt: connection.lastActiveAt,
                } : null,
            });
        },
    );
}
