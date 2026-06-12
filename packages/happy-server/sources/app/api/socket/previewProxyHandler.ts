import { Socket } from "socket.io";
import { log } from "@/utils/log";
import { PreviewCandidateReportSchema, PreviewProxyResponseStartSchema, PreviewProxyResponseBodySchema, PreviewProxyResponseEndSchema, PreviewProxyResponseErrorSchema } from "@kmmao/happy-wire";
import { previewStore } from "@/app/preview/previewStore";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { db } from "@/storage/db";

/**
 * Socket handler for machine-scoped preview proxy operations.
 * Listens for preview events from CLI daemon and routes them to clients.
 */
export function previewProxyHandler(userId: string, socket: Socket, machineId: string) {
    // Listen for preview candidate reports from CLI daemon
    socket.on("preview-candidate-report", async (data: any, callback?: (response: any) => void) => {
        try {
            // Validate input
            const parsed = PreviewCandidateReportSchema.safeParse(data);
            if (!parsed.success) {
                callback?.({ ok: false, error: "invalid-input" });
                return;
            }

            const reportData = parsed.data;

            // Verify session belongs to user
            const session = await db.session.findFirst({
                where: { id: reportData.sessionId, accountId: userId },
                select: { id: true },
            });
            if (!session) {
                callback?.({ ok: false, error: "session-not-found" });
                return;
            }

            // Generate candidate ID
            const candidateId = socket.id + ":" + Date.now(); // Use socket ID + timestamp for uniqueness

            // Store candidate in memory
            const candidate = {
                id: candidateId,
                sessionId: reportData.sessionId,
                machineId,
                state: "available",
                protocol: reportData.protocol || "http",
                host: reportData.host,
                port: reportData.port,
                path: reportData.path,
                devServerType: reportData.devServerType,
                command: reportData.command,
                cwd: reportData.cwd,
                pid: reportData.pid,
                reportedAt: Date.now(),
            };

            previewStore.addCandidate(candidate);

            // Emit ephemeral to all clients interested in this session.
            await emitSyncEphemeral(userId, {
                t: "preview-candidate-reported",
                sessionId: reportData.sessionId,
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

            log({ module: "preview" }, `Candidate reported from daemon: ${candidateId} for session ${reportData.sessionId}`);
            callback?.({ ok: true, candidateId });
        } catch (error) {
            log({ module: "preview", level: "error" }, `Error in preview-candidate-report: ${error}`);
            callback?.({ ok: false, error: "internal-error" });
        }
    });

    // Listen for proxy response start from CLI daemon
    socket.on("preview-proxy-response-start", async (data: any) => {
        try {
            // Validate input
            const parsed = PreviewProxyResponseStartSchema.safeParse(data);
            if (!parsed.success) {
                log({ module: "preview", level: "warn" }, `Invalid response-start: ${parsed.error}`);
                return;
            }

            const response = parsed.data;

            // Route to pending request
            previewStore.resolveResponseStart(response.requestId, response);
        } catch (error) {
            log({ module: "preview", level: "error" }, `Error in preview-proxy-response-start: ${error}`);
        }
    });

    // Listen for proxy response body chunks from CLI daemon
    socket.on("preview-proxy-response-body", async (data: any) => {
        try {
            // Validate input
            const parsed = PreviewProxyResponseBodySchema.safeParse(data);
            if (!parsed.success) {
                log({ module: "preview", level: "warn" }, `Invalid response-body: ${parsed.error}`);
                return;
            }

            const response = parsed.data;

            // Route to pending request
            previewStore.resolveResponseBody(response.requestId, response.chunk);
        } catch (error) {
            log({ module: "preview", level: "error" }, `Error in preview-proxy-response-body: ${error}`);
        }
    });

    // Listen for proxy response end from CLI daemon
    socket.on("preview-proxy-response-end", async (data: any) => {
        try {
            // Validate input
            const parsed = PreviewProxyResponseEndSchema.safeParse(data);
            if (!parsed.success) {
                log({ module: "preview", level: "warn" }, `Invalid response-end: ${parsed.error}`);
                return;
            }

            const response = parsed.data;

            // Route to pending request
            previewStore.resolveResponseEnd(response.requestId);
        } catch (error) {
            log({ module: "preview", level: "error" }, `Error in preview-proxy-response-end: ${error}`);
        }
    });

    // Listen for proxy response error from CLI daemon
    socket.on("preview-proxy-response-error", async (data: any) => {
        try {
            // Validate input
            const parsed = PreviewProxyResponseErrorSchema.safeParse(data);
            if (!parsed.success) {
                log({ module: "preview", level: "warn" }, `Invalid response-error: ${parsed.error}`);
                return;
            }

            const response = parsed.data;

            // Route to pending request
            previewStore.resolveResponseError(response.requestId, response.message);
        } catch (error) {
            log({ module: "preview", level: "error" }, `Error in preview-proxy-response-error: ${error}`);
        }
    });
}
