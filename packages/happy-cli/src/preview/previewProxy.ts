/**
 * Preview proxy — handles incoming preview-proxy-request events from the server,
 * fetches from the local dev server, and streams the response back.
 *
 * Also proxies WebSocket connections for HMR (Vite, webpack-dev-server, etc.).
 */

import { Socket } from "socket.io-client";
import { setImmediate as setImmediateAsync } from "node:timers/promises";
import WebSocket from "ws";
import { logger } from "@/ui/logger";
import { injectAnnotationRuntime } from "./annotationRuntime";
import {
  PREVIEW_PROXY_CHUNK_SIZE,
  DEFAULT_PREVIEW_RESOURCE_LIMITS,
} from "@kmmao/happy-wire";

const MAX_REQUEST_BODY_BYTES = DEFAULT_PREVIEW_RESOURCE_LIMITS.maxRequestBodyBytes;
const MAX_RESPONSE_BODY_BYTES = DEFAULT_PREVIEW_RESOURCE_LIMITS.maxResponseBodyBytes;
const MAX_REQUEST_DURATION_MS = DEFAULT_PREVIEW_RESOURCE_LIMITS.maxRequestDurationMs;

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

      // Reconstruct body from base64 chunks; enforce request body limit
      let body: Buffer | undefined;
      if (request.bodyChunks.length > 0) {
        const buffers = request.bodyChunks.map((c) => Buffer.from(c, "base64"));
        body = Buffer.concat(buffers);
        if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
          throw new Error(
            `Request body exceeds ${MAX_REQUEST_BODY_BYTES} byte limit`,
          );
        }
      }

      // Local fetch — AbortController unifies user-cancel with the request
      // duration limit; AbortSignal.timeout would have been enough on its own
      // but a controller lets us abort downstream if the response is too big.
      const abortController = new AbortController();
      const durationTimer = setTimeout(
        () => abortController.abort(new Error("Request duration limit exceeded")),
        MAX_REQUEST_DURATION_MS,
      );
      let resp: Response;
      try {
        resp = await fetch(localUrl, {
          method,
          headers: sanitizedHeaders,
          body:
            body && method !== "GET" && method !== "HEAD" ? body : undefined,
          redirect: "manual",
          signal: abortController.signal,
        });
      } catch (e) {
        clearTimeout(durationTimer);
        throw e;
      }

      const contentType = resp.headers.get("content-type") ?? "";
      const isHtml =
        contentType.includes("text/html") && method !== "HEAD";

      const responseHeaders = sanitizeResponseHeaders(resp.headers);
      rewriteLocationHeader(responseHeaders, candidate);

      if (isHtml && resp.body) {
        const html = await resp.text();
        clearTimeout(durationTimer);
        const injected = injectAnnotationRuntime(html);
        const bodyBuffer = Buffer.from(injected, "utf-8");

        if (bodyBuffer.byteLength > MAX_RESPONSE_BODY_BYTES) {
          throw new Error(
            `HTML response exceeds ${MAX_RESPONSE_BODY_BYTES} byte limit`,
          );
        }

        responseHeaders["content-length"] = String(bodyBuffer.byteLength);
        delete responseHeaders["content-encoding"];
        responseHeaders["cache-control"] = "no-store";

        socket.emit("preview-proxy-response-start", {
          tunnelId,
          requestId,
          status: resp.status,
          statusText: resp.statusText,
          headers: responseHeaders,
          hasBody: true,
        });

        await emitChunks(socket, tunnelId, requestId, bodyBuffer);
        socket.emit("preview-proxy-response-end", { tunnelId, requestId });
      } else {
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
          let totalBytes = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              const buf = Buffer.from(value);
              totalBytes += buf.byteLength;
              if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
                abortController.abort();
                throw new Error(
                  `Response exceeds ${MAX_RESPONSE_BODY_BYTES} byte limit`,
                );
              }
              await emitChunks(socket, tunnelId, requestId, buf);
            }
          }
        }

        clearTimeout(durationTimer);
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
        // F10: send binary frames as Buffer — socket.io v4 transports
        // them as a binary attachment (no base64 inflation). Text frames
        // remain plain strings.
        socket.emit("preview-ws-frame-from-local", {
          tunnelId: msg.tunnelId,
          requestId,
          data: isBinary ? (data as Buffer) : String(data),
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

  /**
   * Forward a frame from the browser to the local WebSocket.
   * F10: accept binary as native Buffer/Uint8Array (preferred) or base64
   * string (backward compat with older servers).
   */
  const wsFrameToLocalHandler = (msg: {
    requestId: string;
    data: Buffer | Uint8Array | string;
    isBinary: boolean;
  }) => {
    const localWs = localWebSockets.get(msg.requestId);
    if (!localWs || localWs.readyState !== WebSocket.OPEN) return;

    try {
      if (msg.isBinary) {
        const buf = Buffer.isBuffer(msg.data)
          ? msg.data
          : msg.data instanceof Uint8Array
            ? Buffer.from(msg.data)
            : Buffer.from(String(msg.data), "base64");
        localWs.send(buf);
      } else {
        const text =
          typeof msg.data === "string"
            ? msg.data
            : Buffer.from(msg.data as Uint8Array).toString("utf-8");
        localWs.send(text);
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

/**
 * Emit a Buffer as base64 chunks over Socket.IO, yielding to the event loop
 * between chunks so we don't starve other I/O or saturate the send buffer.
 * This is a coarse backpressure mechanism — socket.io-client doesn't surface
 * its internal buffer state, so we yield every chunk and rely on the event
 * loop to drain naturally.
 */
async function emitChunks(
  socket: Socket,
  tunnelId: string,
  requestId: string,
  buf: Buffer,
): Promise<void> {
  for (let offset = 0; offset < buf.byteLength; offset += PREVIEW_PROXY_CHUNK_SIZE) {
    const chunk = buf.subarray(offset, offset + PREVIEW_PROXY_CHUNK_SIZE);
    socket.emit("preview-proxy-response-body", {
      tunnelId,
      requestId,
      chunk: chunk.toString("base64"),
    });
    // Yield to the event loop after each chunk — lets reconnect / heartbeats
    // run, and prevents a huge synchronous emit burst.
    await setImmediateAsync();
  }
}

/**
 * Rewrite a Location header pointing at the local dev server into a relative
 * URL so the browser stays on the preview tunnel origin.
 *
 * Without this, a 301 redirect from `http://localhost:5173/` to
 * `http://localhost:5173/login` would send the browser to localhost directly
 * (and fail) instead of `/preview/{tunnelId}/login`.
 */
function rewriteLocationHeader(
  headers: Record<string, string>,
  candidate: PreviewCandidate,
): void {
  const loc = headers["location"] ?? headers["Location"];
  if (!loc || !/^https?:\/\//i.test(loc)) return;
  try {
    const url = new URL(loc);
    const expectedHost = `${candidate.host}:${candidate.port}`;
    if (url.host === expectedHost || url.hostname === candidate.host) {
      const relative = url.pathname + url.search + url.hash;
      delete headers["Location"];
      headers["location"] = relative;
    }
  } catch {
    // Malformed URL — leave it alone
  }
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
