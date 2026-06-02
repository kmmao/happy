/**
 * HTTP proxy gateway for preview tunnels.
 *
 * Forwards browser HTTP requests through the CLI daemon to the local dev
 * server. Streams response chunks back as they arrive so large assets and
 * SSE responses work.
 *
 * The CLI side is responsible for injecting the annotation script into HTML
 * responses (single-sourced; see B1).
 */

import { type Fastify } from "../types";
import { previewStore, type ProxyResponseSubscriber } from "@/app/preview/previewStore";
import { eventRouter } from "@/app/events/eventRouter";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { log } from "@/utils/log";
import {
    DEFAULT_PREVIEW_RESOURCE_LIMITS,
    PREVIEW_PROXY_CHUNK_SIZE,
} from "@kmmao/happy-wire";

const REQUEST_TIMEOUT_MS = DEFAULT_PREVIEW_RESOURCE_LIMITS.maxRequestDurationMs;
const MAX_REQUEST_BODY_BYTES = DEFAULT_PREVIEW_RESOURCE_LIMITS.maxRequestBodyBytes;

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
    "host",
    "connection",
    "keep-alive",
    "proxy-authorization",
    "proxy-authenticate",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "cookie",
    "authorization",
]);

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "set-cookie",
]);

/**
 * Proxy an HTTP request through the tunnel using streaming subscriber API.
 */
async function proxyRequest(request: any, reply: any, method: string) {
    const params = request.params as any;
    const tunnelId = params.tunnelId as string;
    const pathParam = (params["*"] as string) || "";

    const connection = previewStore.getConnection(tunnelId);
    if (!connection) {
        return reply.status(404).send({ error: "tunnel-not-found" });
    }

    const machineSocket = eventRouter.findMachineSocket(connection.machineId);
    if (!machineSocket) {
        return reply.status(503).send({ error: "daemon-offline" });
    }

    previewStore.touchConnection(tunnelId);

    const requestId = randomKeyNaked(12);

    // ── Build forward path (preserve query string) ────────────────────────
    const rawUrl = (request.raw?.url as string) ?? "";
    const tunnelPrefix = `/preview/${tunnelId}`;
    let forwardPath = rawUrl.startsWith(tunnelPrefix)
        ? rawUrl.slice(tunnelPrefix.length)
        : "/" + pathParam;
    if (!forwardPath.startsWith("/")) forwardPath = "/" + forwardPath;

    // ── Sanitize request headers ──────────────────────────────────────────
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP_REQUEST_HEADERS.has(lower)) continue;
        if (lower.startsWith("x-forwarded-")) continue;
        if (lower === "if-modified-since" || lower === "if-none-match") continue;
        if (typeof value === "string") headers[key] = value;
        else if (Array.isArray(value)) headers[key] = value[0]!;
    }

    // ── Collect request body (F3: enforce 10MB limit) ─────────────────────
    let bodyChunks: string[] = [];
    if (request.body !== undefined && method !== "GET" && method !== "HEAD") {
        let buf: Buffer | null = null;
        if (Buffer.isBuffer(request.body)) buf = request.body;
        else if (typeof request.body === "string") buf = Buffer.from(request.body);
        else if (request.body && typeof request.body === "object") {
            try {
                buf = Buffer.from(JSON.stringify(request.body));
            } catch {
                buf = null;
            }
        }
        if (buf) {
            if (buf.byteLength > MAX_REQUEST_BODY_BYTES) {
                return reply.status(413).send({ error: "request-body-too-large" });
            }
            for (let off = 0; off < buf.byteLength; off += PREVIEW_PROXY_CHUNK_SIZE) {
                bodyChunks.push(
                    buf.subarray(off, off + PREVIEW_PROXY_CHUNK_SIZE).toString("base64"),
                );
            }
        }
    }

    // ── Stream the response back as chunks arrive ─────────────────────────
    await new Promise<void>((resolve) => {
        let startedHeaders = false;
        let errored = false;
        let timedOut = false;
        let unsubscribe = () => {};

        const timeout = setTimeout(() => {
            timedOut = true;
            unsubscribe();
            if (!startedHeaders && !reply.sent) {
                reply.status(504).send({ error: "gateway-timeout" });
            } else if (!reply.raw.writableEnded) {
                reply.raw.end();
            }
            resolve();
        }, REQUEST_TIMEOUT_MS);

        const subscriber: ProxyResponseSubscriber = {
            onStart(data) {
                if (timedOut || errored) return;
                startedHeaders = true;
                reply.raw.statusCode = data.status || 200;

                for (const [key, value] of Object.entries(data.headers)) {
                    const lower = key.toLowerCase();
                    if (HOP_BY_HOP_RESPONSE_HEADERS.has(lower)) continue;
                    // CSP / X-Frame-Options would block iframe embedding
                    if (lower === "content-security-policy") continue;
                    if (lower === "content-security-policy-report-only") continue;
                    if (lower === "x-frame-options") continue;
                    if (typeof value === "string") reply.raw.setHeader(key, value);
                }

                reply.raw.setHeader("cache-control", "no-store");
                reply.raw.setHeader("access-control-allow-origin", "*");
                reply.raw.setHeader(
                    "access-control-allow-methods",
                    "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
                );
                reply.raw.setHeader(
                    "access-control-allow-headers",
                    "Content-Type, Authorization",
                );

                if (!data.hasBody) {
                    reply.raw.end();
                    clearTimeout(timeout);
                    unsubscribe();
                    resolve();
                }
            },
            onBody(chunk) {
                if (timedOut || errored || !startedHeaders) return;
                try {
                    reply.raw.write(chunk);
                } catch {
                    // Connection broken — let onClose / timeout handle
                }
            },
            onEnd() {
                if (timedOut || errored) return;
                clearTimeout(timeout);
                unsubscribe();
                if (!reply.raw.writableEnded) reply.raw.end();
                resolve();
            },
            onError(message) {
                if (timedOut) return;
                errored = true;
                clearTimeout(timeout);
                unsubscribe();
                log({ module: "preview", level: "warn" }, `Proxy error ${requestId}: ${message}`);
                if (!startedHeaders && !reply.sent) {
                    reply.status(502).send({ error: "proxy-error", message });
                } else if (!reply.raw.writableEnded) {
                    reply.raw.end();
                }
                resolve();
            },
        };

        unsubscribe = previewStore.subscribeProxyResponse(requestId, tunnelId, subscriber);

        // Cancel pending request if client disconnects mid-stream
        reply.raw.on("close", () => {
            if (!startedHeaders) return; // covered by timeout / error
            if (!errored && !timedOut) {
                clearTimeout(timeout);
                unsubscribe();
                resolve();
            }
        });

        // Fire the request to the CLI daemon
        machineSocket.emit("preview-proxy-request", {
            tunnelId,
            requestId,
            method,
            path: forwardPath,
            headers,
            bodyChunks,
        });
    });
}

/**
 * HTTP proxy gateway. Public route — no auth.
 * The tunnelId in the path is the authentication token.
 */
export function previewGateway(app: Fastify) {
    const route = "/preview/:tunnelId/*";
    app.get(route, async (request, reply) => proxyRequest(request, reply, "GET"));
    app.post(route, async (request, reply) => proxyRequest(request, reply, "POST"));
    app.put(route, async (request, reply) => proxyRequest(request, reply, "PUT"));
    app.delete(route, async (request, reply) => proxyRequest(request, reply, "DELETE"));
    app.patch(route, async (request, reply) => proxyRequest(request, reply, "PATCH"));
    app.options(route, async (request, reply) => proxyRequest(request, reply, "OPTIONS"));
    // Note: HEAD is auto-registered by Fastify for every GET route
}
