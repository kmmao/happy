import { type Fastify } from "../types";
import { previewStore } from "@/app/preview/previewStore";
import { eventRouter } from "@/app/events/eventRouter";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { log } from "@/utils/log";
import * as privacyKit from "privacy-kit";

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const ANNOTATION_INJECT_SCRIPT = `
<script>
// Preview annotation script (injected by Happy Server)
window.__happyPreviewTunnel = {
    tunnelId: typeof tunnelId !== 'undefined' ? tunnelId : null,
};
</script>
`;

/**
 * Proxy a request to the CLI daemon.
 */
async function proxyRequest(request: any, reply: any, method: string) {
    const params = request.params as any;
    const tunnelId = params.tunnelId as string;
    const pathParam = params["*"] as string || "";

    // Look up tunnel
    const connection = previewStore.getConnection(tunnelId);
    if (!connection) {
        return reply.status(404).send({ error: "tunnel-not-found" });
    }

    // Get the machine socket
    const machineSocket = eventRouter.findMachineSocket(connection.machineId);
    if (!machineSocket) {
        return reply.status(503).send({ error: "daemon-offline" });
    }

    // Generate request ID for matching response
    const requestId = randomKeyNaked(12);

    // Collect request headers (strip security-sensitive ones)
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
        if (key.toLowerCase() === "cookie") continue;
        if (key.toLowerCase() === "authorization") continue;
        if (typeof value === "string") {
            headers[key] = value;
        } else if (Array.isArray(value)) {
            headers[key] = value[0];
        }
    }

    // Collect request body (base64 encoded)
    let bodyChunks: string[] = [];
    if (request.body && typeof request.body === "object") {
        try {
            const bodyStr = JSON.stringify(request.body);
            bodyChunks = [privacyKit.encodeBase64(Buffer.from(bodyStr))];
        } catch {
            // Ignore if body cannot be serialized
        }
    } else if (request.body && typeof request.body === "string") {
        bodyChunks = [privacyKit.encodeBase64(Buffer.from(request.body))];
    }

    // Create pending request promise
    let responseStarted = false;
    let responseChunks: Buffer[] = [];
    const responsePromise = previewStore.createPendingRequest(requestId, REQUEST_TIMEOUT_MS);

    try {
        // Emit proxy request to CLI daemon
        machineSocket.emit("preview-proxy-request", {
            tunnelId,
            requestId,
            method,
            path: "/" + pathParam,
            headers,
            bodyChunks,
        });

        // Wait for response start
        const responseStart = await responsePromise;
        if (responseStart.type !== "start") {
            return reply.status(500).send({ error: "invalid-response" });
        }

        responseStarted = true;

        // Forward response status and headers (strip Set-Cookie)
        const responseHeaders: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(responseStart.headers || {})) {
            if (key.toLowerCase() === "set-cookie") continue;
            if (typeof value === "string") {
                responseHeaders[key] = value;
            }
        }

        // Set CORS headers
        responseHeaders["Access-Control-Allow-Origin"] = "*";
        responseHeaders["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, PATCH, OPTIONS";
        responseHeaders["Access-Control-Allow-Headers"] = "Content-Type, Authorization";

        // Start response
        reply.code(responseStart.status || 200);
        Object.entries(responseHeaders).forEach(([key, value]) => {
            reply.header(key, value);
        });

        // Inject annotation script into HTML responses
        const contentType = responseStart.headers["content-type"] || "";
        const shouldInject = contentType.includes("text/html");

        // Stream response body
        if (responseStart.hasBody) {
            // For now, collect chunks; in future, stream them directly
            // Listen for body chunks via event listener
            const bodyListener = (data: any) => {
                if (data.requestId === requestId && data.chunk) {
                    try {
                        const decoded = privacyKit.decodeBase64(data.chunk);
                        responseChunks.push(Buffer.from(decoded));
                    } catch {
                        log({ module: "preview", level: "warn" }, `Failed to decode chunk for ${requestId}`);
                    }
                }
            };
            const endListener = (data: any) => {
                if (data.requestId === requestId) {
                    machineSocket.off("preview-proxy-body", bodyListener);
                    machineSocket.off("preview-proxy-end", endListener);
                }
            };

            machineSocket.on("preview-proxy-body", bodyListener);
            machineSocket.on("preview-proxy-end", endListener);

            // Wait for all chunks (with timeout)
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    machineSocket.off("preview-proxy-body", bodyListener);
                    machineSocket.off("preview-proxy-end", endListener);
                    reject(new Error("Response timeout"));
                }, REQUEST_TIMEOUT_MS);

                const checkComplete = () => {
                    // This is a simplified check — in production, we'd track end properly
                    machineSocket.off("preview-proxy-end", checkComplete);
                    clearTimeout(timeout);
                    resolve();
                };

                machineSocket.on("preview-proxy-end", checkComplete);
            });
        }

        // Combine chunks into final body
        let body = responseChunks.length > 0 ? Buffer.concat(responseChunks) : Buffer.alloc(0);

        // Inject annotation script before </body> if HTML
        if (shouldInject && body.length > 0) {
            const bodyStr = body.toString("utf-8");
            if (bodyStr.includes("</body>")) {
                const injected = bodyStr.replace("</body>", ANNOTATION_INJECT_SCRIPT + "\n</body>");
                body = Buffer.from(injected, "utf-8");
                reply.header("Content-Length", body.length.toString());
            }
        }

        return reply.send(body);
    } catch (error) {
        if (responseStarted) {
            // Response already started, cannot send error
            log({ module: "preview", level: "error" }, `Error after response started: ${error}`);
        } else {
            log({ module: "preview", level: "error" }, `Proxy request failed: ${error}`);
            return reply.status(503).send({ error: "request-failed", message: String(error) });
        }
    }
}

/**
 * HTTP proxy gateway that forwards browser requests to the CLI daemon via Socket.IO.
 *
 * This route is public — no auth required. The tunnel ID serves as the authentication token.
 * All requests are proxied to the connected CLI daemon, which forwards them to the local
 * dev server and returns the response.
 */
export function previewGateway(app: Fastify) {
    // GET /preview/:tunnelId/*
    app.get("/preview/:tunnelId/*", async (request, reply) => {
        return proxyRequest(request, reply, "GET");
    });

    // POST /preview/:tunnelId/*
    app.post("/preview/:tunnelId/*", async (request, reply) => {
        return proxyRequest(request, reply, "POST");
    });

    // PUT /preview/:tunnelId/*
    app.put("/preview/:tunnelId/*", async (request, reply) => {
        return proxyRequest(request, reply, "PUT");
    });

    // DELETE /preview/:tunnelId/*
    app.delete("/preview/:tunnelId/*", async (request, reply) => {
        return proxyRequest(request, reply, "DELETE");
    });

    // PATCH /preview/:tunnelId/*
    app.patch("/preview/:tunnelId/*", async (request, reply) => {
        return proxyRequest(request, reply, "PATCH");
    });

    // OPTIONS /preview/:tunnelId/*
    app.options("/preview/:tunnelId/*", async (request, reply) => {
        return proxyRequest(request, reply, "OPTIONS");
    });

    // Note: HEAD is auto-registered by Fastify for every GET route
}
