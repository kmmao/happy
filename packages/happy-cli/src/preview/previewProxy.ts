/**
 * Preview proxy — handles incoming preview-proxy-request events from the server,
 * fetches from the local dev server, and streams the response back.
 *
 * Also proxies WebSocket connections for HMR (Vite, webpack-dev-server, etc.).
 */

import { Socket } from "socket.io-client";
import WebSocket from "ws";
import { logger } from "@/ui/logger";
import { injectAnnotationRuntime } from "./annotationRuntime";
import { PREVIEW_PROXY_CHUNK_SIZE } from "@kmmao/happy-wire";

export interface PreviewCandidate {
  protocol: string;
  host: string;
  port: number;
}

interface ProxyRequest {
  tunnelId: string;
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  bodyChunks: string[]; // base64
}

/**
 * Register preview proxy handlers on a machine-scoped socket.
 * Called when a preview tunnel is active for this machine.
 */
export function registerPreviewProxy(
  socket: Socket,
  candidate: PreviewCandidate,
): () => void {
  const handler = async (request: ProxyRequest) => {
    const { tunnelId, requestId, method, path, headers } = request;
    const localUrl = `${candidate.protocol}://${candidate.host}:${candidate.port}${path}`;

    try {
      // Strip security headers from incoming request
      const sanitizedHeaders = sanitizeRequestHeaders(headers);
      // Force identity encoding so we can inspect/inject HTML
      sanitizedHeaders["accept-encoding"] = "identity";

      // Reconstruct body from base64 chunks
      let body: Buffer | undefined;
      if (request.bodyChunks.length > 0) {
        const buffers = request.bodyChunks.map((c) => Buffer.from(c, "base64"));
        body = Buffer.concat(buffers);
      }

      // Local fetch
      const resp = await fetch(localUrl, {
        method,
        headers: sanitizedHeaders,
        body: body && method !== "GET" && method !== "HEAD" ? body : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(5 * 60 * 1000), // 5 min
      });

      // Check if HTML → inject annotation script
      const contentType = resp.headers.get("content-type") ?? "";
      const isHtml =
        contentType.includes("text/html") && method !== "HEAD";

      let responseHeaders = sanitizeResponseHeaders(resp.headers);

      if (isHtml && resp.body) {
        const html = await resp.text();
        const injected = injectAnnotationRuntime(html);
        const bodyBuffer = Buffer.from(injected, "utf-8");

        // Update content-length, strip content-encoding
        responseHeaders["content-length"] = String(bodyBuffer.byteLength);
        delete responseHeaders["content-encoding"];
        responseHeaders["cache-control"] = "no-store";

        // Send as single response
        socket.emit("preview-proxy-response-start", {
          tunnelId,
          requestId,
          status: resp.status,
          statusText: resp.statusText,
          headers: responseHeaders,
          hasBody: true,
        });

        // Chunk and send body
        for (
          let offset = 0;
          offset < bodyBuffer.byteLength;
          offset += PREVIEW_PROXY_CHUNK_SIZE
        ) {
          const chunk = bodyBuffer.subarray(
            offset,
            offset + PREVIEW_PROXY_CHUNK_SIZE,
          );
          socket.emit("preview-proxy-response-body", {
            tunnelId,
            requestId,
            chunk: chunk.toString("base64"),
          });
        }

        socket.emit("preview-proxy-response-end", { tunnelId, requestId });
      } else {
        // Non-HTML: stream response
        responseHeaders["cache-control"] = "no-store";
        socket.emit("preview-proxy-response-start", {
          tunnelId,
          requestId,
          status: resp.status,
          statusText: resp.statusText,
          headers: responseHeaders,
          hasBody: resp.body !== null,
        });

        if (resp.body) {
          const reader = resp.body.getReader();
          let done = false;
          while (!done) {
            const result = await reader.read();
            done = result.done;
            if (result.value) {
              // Chunk the value
              const buf = Buffer.from(result.value);
              for (
                let offset = 0;
                offset < buf.byteLength;
                offset += PREVIEW_PROXY_CHUNK_SIZE
              ) {
                socket.emit("preview-proxy-response-body", {
                  tunnelId,
                  requestId,
                  chunk: buf
                    .subarray(offset, offset + PREVIEW_PROXY_CHUNK_SIZE)
                    .toString("base64"),
                });
              }
            }
          }
        }

        socket.emit("preview-proxy-response-end", { tunnelId, requestId });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      logger.debug(`[PREVIEW] Proxy error for ${requestId}: ${message}`);
      socket.emit("preview-proxy-response-error", {
        tunnelId,
        requestId,
        message: `Local fetch failed: ${message}`,
      });
    }
  };

  socket.on("preview-proxy-request", handler);

  // ── WebSocket proxy for HMR ──────────────────────────────────────────

  /** Active local WebSocket connections keyed by requestId. */
  const localWebSockets = new Map<string, WebSocket>();

  const wsConnectHandler = (msg: {
    tunnelId: string;
    requestId: string;
    path: string;
    headers: Record<string, string>;
  }) => {
    const { requestId, path } = msg;
    const wsUrl = `ws://${candidate.host}:${candidate.port}${path}`;

    logger.debug(`[PREVIEW] WS connect ${requestId} → ${wsUrl}`);

    try {
      const localWs = new WebSocket(wsUrl, {
        headers: sanitizeRequestHeaders(msg.headers),
        handshakeTimeout: 10_000,
      });

      localWebSockets.set(requestId, localWs);

      localWs.on("open", () => {
        logger.debug(`[PREVIEW] WS opened ${requestId}`);
      });

      localWs.on("message", (data: Buffer | string, isBinary: boolean) => {
        const payload = isBinary
          ? Buffer.from(data as Buffer).toString("base64")
          : String(data);

        socket.emit("preview-ws-frame-from-local", {
          tunnelId: msg.tunnelId,
          requestId,
          data: payload,
          isBinary,
        });
      });

      localWs.on("close", (code: number, reason: Buffer) => {
        localWebSockets.delete(requestId);
        socket.emit("preview-ws-close-from-local", {
          tunnelId: msg.tunnelId,
          requestId,
          code,
          reason: reason.toString("utf-8"),
        });
      });

      localWs.on("error", (err: Error) => {
        localWebSockets.delete(requestId);
        logger.debug(`[PREVIEW] WS error ${requestId}: ${err.message}`);
        socket.emit("preview-ws-reject", {
          tunnelId: msg.tunnelId,
          requestId,
          message: `Local WebSocket error: ${err.message}`,
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.debug(`[PREVIEW] WS connect failed ${requestId}: ${message}`);
      socket.emit("preview-ws-reject", {
        tunnelId: msg.tunnelId,
        requestId,
        message: `Failed to connect local WebSocket: ${message}`,
      });
    }
  };

  /** Forward a frame from the browser to the local WebSocket. */
  const wsFrameToLocalHandler = (msg: {
    requestId: string;
    data: string;
    isBinary: boolean;
  }) => {
    const localWs = localWebSockets.get(msg.requestId);
    if (!localWs || localWs.readyState !== WebSocket.OPEN) return;

    try {
      if (msg.isBinary) {
        localWs.send(Buffer.from(msg.data, "base64"));
      } else {
        localWs.send(msg.data);
      }
    } catch {
      // Local socket already closed
    }
  };

  /** Close the local WebSocket when the browser side closes. */
  const wsCloseLocalHandler = (msg: {
    requestId: string;
    code: number;
    reason?: string;
  }) => {
    const localWs = localWebSockets.get(msg.requestId);
    if (!localWs) return;
    localWebSockets.delete(msg.requestId);
    if (localWs.readyState === WebSocket.OPEN) {
      localWs.close(msg.code, msg.reason);
    }
  };

  socket.on("preview-ws-connect", wsConnectHandler);
  socket.on("preview-ws-frame-to-local", wsFrameToLocalHandler);
  socket.on("preview-ws-close-local", wsCloseLocalHandler);

  // Return cleanup function
  return () => {
    socket.off("preview-proxy-request", handler);
    socket.off("preview-ws-connect", wsConnectHandler);
    socket.off("preview-ws-frame-to-local", wsFrameToLocalHandler);
    socket.off("preview-ws-close-local", wsCloseLocalHandler);

    // Close all active local WebSockets
    for (const [id, ws] of localWebSockets) {
      localWebSockets.delete(id);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1001, "Preview proxy stopped");
      }
    }
  };
}

function sanitizeRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  const SKIP = new Set([
    "authorization",
    "cookie",
    "proxy-authorization",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-forwarded-host",
    "host",
    "connection",
    "upgrade",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
  ]);
  for (const [key, value] of Object.entries(headers)) {
    if (!SKIP.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

function sanitizeResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  const SKIP = new Set([
    "set-cookie",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
  ]);
  headers.forEach((value, key) => {
    if (!SKIP.has(key.toLowerCase())) {
      result[key] = value;
    }
  });
  return result;
}
