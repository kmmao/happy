/**
 * WebSocket proxy gateway for preview tunnels.
 *
 * Intercepts HTTP upgrade requests on `/preview/:tunnelId/…` and bridges
 * them to the CLI daemon's local dev server via Socket.IO events.
 *
 * This enables Vite HMR, webpack-dev-server hot reload, and any other
 * WebSocket-based dev tooling to work through the preview tunnel.
 *
 * Architecture:
 *   Browser  ←WS→  Server (this file)  ←Socket.IO→  CLI daemon  ←WS→  localhost:port
 */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { previewStore } from "@/app/preview/previewStore";
import { eventRouter } from "@/app/events/eventRouter";
import { log } from "@/utils/log";

const PREVIEW_PATH_RE = /^\/preview\/([^/]+)(\/.*)?$/;

/**
 * Attach a WebSocket upgrade handler to the raw HTTP server.
 *
 * Must be called AFTER `app.listen()` and `startSocket()` so the
 * Socket.IO server has already claimed its own upgrade path (`/v1/updates`).
 */
export function attachPreviewWsGateway(server: HttpServer): void {
    // Create a bare WebSocket server — we handle upgrade manually.
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        const url = request.url ?? "";

        // Only handle /preview/:tunnelId/… upgrades
        const match = PREVIEW_PATH_RE.exec(url);
        if (!match) return; // Let Socket.IO or other handlers deal with it

        const tunnelId = match[1]!;
        const path = match[2] ?? "/";

        // Look up the tunnel
        const connection = previewStore.getConnection(tunnelId);
        if (!connection) {
            socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
            socket.destroy();
            return;
        }

        // Find the machine socket
        const machineSocket = eventRouter.findMachineSocket(connection.machineId);
        if (!machineSocket) {
            socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
            socket.destroy();
            return;
        }

        // Accept the WebSocket upgrade
        wss.handleUpgrade(request, socket, head, (browserWs) => {
            handlePreviewWs(browserWs, tunnelId, path, connection.machineId, machineSocket);
        });
    });

    log({ module: "preview" }, "Preview WebSocket gateway attached");
}

/**
 * Bridge a single browser WebSocket to the CLI daemon's local WebSocket.
 */
function handlePreviewWs(
    browserWs: WebSocket,
    tunnelId: string,
    path: string,
    _machineId: string,
    machineSocket: any, // Socket.IO socket
): void {
    const requestId = randomKeyNaked(12);

    // ── Step 1: Ask CLI daemon to open a local WebSocket ─────────────────

    machineSocket.emit("preview-ws-connect", {
        tunnelId,
        requestId,
        path,
        headers: {},
    });

    // ── Step 2: Bridge frames Browser → CLI ──────────────────────────────

    browserWs.on("message", (data: Buffer | string, isBinary: boolean) => {
        const payload = isBinary
            ? Buffer.from(data as Buffer).toString("base64")
            : String(data);

        machineSocket.emit("preview-ws-frame-to-local", {
            tunnelId,
            requestId,
            data: payload,
            isBinary,
        });
    });

    browserWs.on("close", (code: number, reason: Buffer) => {
        machineSocket.emit("preview-ws-close-local", {
            tunnelId,
            requestId,
            code,
            reason: reason.toString("utf-8"),
        });
    });

    browserWs.on("error", () => {
        machineSocket.emit("preview-ws-close-local", {
            tunnelId,
            requestId,
            code: 1011,
            reason: "Browser WebSocket error",
        });
    });

    // ── Step 3: Bridge frames CLI → Browser ──────────────────────────────

    const onFrame = (msg: { requestId: string; data: string; isBinary: boolean }) => {
        if (msg.requestId !== requestId) return;
        if (browserWs.readyState !== WebSocket.OPEN) return;

        try {
            if (msg.isBinary) {
                browserWs.send(Buffer.from(msg.data, "base64"));
            } else {
                browserWs.send(msg.data);
            }
        } catch {
            // Browser socket already closed
        }
    };

    const onClose = (msg: { requestId: string; code: number; reason?: string }) => {
        if (msg.requestId !== requestId) return;
        cleanup();
        if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.close(msg.code, msg.reason);
        }
    };

    const onReject = (msg: { requestId: string; message: string }) => {
        if (msg.requestId !== requestId) return;
        cleanup();
        if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.close(1011, msg.message);
        }
    };

    machineSocket.on("preview-ws-frame-from-local", onFrame);
    machineSocket.on("preview-ws-close-from-local", onClose);
    machineSocket.on("preview-ws-reject", onReject);

    // ── Cleanup ──────────────────────────────────────────────────────────

    function cleanup() {
        machineSocket.off("preview-ws-frame-from-local", onFrame);
        machineSocket.off("preview-ws-close-from-local", onClose);
        machineSocket.off("preview-ws-reject", onReject);
    }

    // If the machine disconnects, close the browser WS
    machineSocket.once("disconnect", () => {
        cleanup();
        if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.close(1001, "Daemon disconnected");
        }
    });
}
