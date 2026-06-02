import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { PreviewCandidateReportSchema } from "@kmmao/happy-wire";
import { previewStore } from "@/app/preview/previewStore";
import { eventRouter, buildPreviewCandidateReportedEphemeral, buildPreviewConnectionUpdatedEphemeral } from "@/app/events/eventRouter";

const DEFAULT_PREVIEW_LEASE_MS = 8 * 60 * 60 * 1000;        // 8 hours
const DEFAULT_PREVIEW_IDLE_TIMEOUT_MS = 45 * 60 * 1000;      // 45 minutes

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

            // Verify session belongs to user
            const session = await db.session.findFirst({
                where: { id: sessionId, accountId: userId },
                select: { id: true },
            });
            if (!session) {
                return reply.status(404).send({ error: "session-not-found" });
            }

            // Generate candidate ID
            const candidateId = randomKeyNaked(12);

            // Store candidate
            const candidate = {
                id: candidateId,
                sessionId,
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

            // Emit ephemeral event to all interested clients
            eventRouter.emitEphemeral({
                userId,
                payload: buildPreviewCandidateReportedEphemeral({
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
                }),
                recipientFilter: { type: "all-interested-in-session", sessionId },
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

            // Verify session belongs to user and get project/machineId
            const session = await db.session.findFirst({
                where: { id: sessionId, accountId: userId },
                select: { id: true, projectId: true },
            });
            if (!session) {
                return reply.status(404).send({ error: "session-not-found" });
            }

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

            // Emit ephemeral event
            eventRouter.emitEphemeral({
                userId,
                payload: buildPreviewConnectionUpdatedEphemeral({
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
                }),
                recipientFilter: { type: "all-interested-in-session", sessionId },
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

            // Verify session belongs to user
            const session = await db.session.findFirst({
                where: { id: sessionId, accountId: userId },
                select: { id: true },
            });
            if (!session) {
                return reply.status(404).send({ error: "session-not-found" });
            }

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

            // Emit ephemeral event with null connection (indicating revoked)
            eventRouter.emitEphemeral({
                userId,
                payload: buildPreviewConnectionUpdatedEphemeral({
                    sessionId,
                    connection: null,
                }),
                recipientFilter: { type: "all-interested-in-session", sessionId },
            });

            return reply.send({ ok: true });
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

            // Verify session belongs to user
            const session = await db.session.findFirst({
                where: { id: sessionId, accountId: userId },
                select: { id: true },
            });
            if (!session) {
                return reply.status(404).send({ error: "session-not-found" });
            }

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
