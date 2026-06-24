import { onShutdown } from "@/utils/shutdown";
import { Fastify } from "./types";
import {
  ClientConnection,
  eventRouter,
} from "@/app/events/eventRouter";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { Server, Socket } from "socket.io";
import { debug, log } from "@/utils/log";
import { auth } from "@/app/auth/auth";
import {
  decrementWebSocketConnection,
  incrementWebSocketConnection,
  websocketEventsCounter,
} from "../monitoring/metrics2";
import { usageHandler } from "./socket/usageHandler";
import { rpcHandler } from "./socket/rpcHandler";
import { pingHandler } from "./socket/pingHandler";
import { sessionUpdateHandler } from "./socket/sessionUpdateHandler";
import { sessionAdoptHandler } from "./socket/sessionAdoptHandler";
import { machineUpdateHandler } from "./socket/machineUpdateHandler";
import { webhookStatusHandler } from "./socket/webhookStatusHandler";
import { supervisorRunStatusHandler } from "./socket/supervisorRunStatusHandler";
import { supervisorFixStatusHandler } from "./socket/supervisorFixStatusHandler";
import { artifactUpdateHandler } from "./socket/artifactUpdateHandler";
import { accessKeyHandler } from "./socket/accessKeyHandler";
import { sessionPreferencesHandler } from "./socket/sessionPreferencesHandler";
import { knowledgeHandler } from "./socket/knowledgeHandler";
import { taskLogHandler } from "./socket/taskLogHandler";
import { taskStatusHandler } from "./socket/taskStatusHandler";
import { sessionEventHandler } from "./socket/sessionEventHandler";
import { terminalHandler } from "./socket/terminalHandler";
import { interAgentMessageHandler } from "./socket/interAgentMessageHandler";
import { listRpcReadyScopes } from "./socket/listRpcReadyScopes";
import { previewProxyHandler } from "./socket/previewProxyHandler";

export function startSocket(app: Fastify) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:8081"];
  const io = new Server(app.server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
    },
    transports: ["websocket", "polling"],
    // Allow up to ~50MB per message so the App can attach files up to ~10MB raw
    // (base64 + E2E re-encoding inflates the payload well above the raw size).
    // This is a per-message ceiling, not a preallocation.
    maxHttpBufferSize: 50e6,
    pingTimeout: 45000,
    pingInterval: 15000,
    path: "/v1/updates",
    allowUpgrades: true,
    upgradeTimeout: 10000,
    connectTimeout: 20000,
    serveClient: false, // Don't serve the client files
  });

  let rpcListeners = new Map<string, Map<string, Socket>>();
  io.on("connection", async (socket) => {
    debug(
      { module: "websocket" },
      `New connection attempt from socket: ${socket.id}`,
    );
    const token = socket.handshake.auth.token as string;
    const clientType = socket.handshake.auth.clientType as
      | "session-scoped"
      | "user-scoped"
      | "machine-scoped"
      | undefined;
    const sessionId = socket.handshake.auth.sessionId as string | undefined;
    const machineId = socket.handshake.auth.machineId as string | undefined;

    if (!token) {
      log({ module: "websocket" }, `No token provided`);
      socket.emit("error", { message: "Missing authentication token" });
      socket.disconnect();
      return;
    }

    // Validate session-scoped clients have sessionId
    if (clientType === "session-scoped" && !sessionId) {
      log({ module: "websocket" }, `Session-scoped client missing sessionId`);
      socket.emit("error", {
        message: "Session ID required for session-scoped clients",
      });
      socket.disconnect();
      return;
    }

    // Validate machine-scoped clients have machineId
    if (clientType === "machine-scoped" && !machineId) {
      log({ module: "websocket" }, `Machine-scoped client missing machineId`);
      socket.emit("error", {
        message: "Machine ID required for machine-scoped clients",
      });
      socket.disconnect();
      return;
    }

    const verified = await auth.verifyToken(token);
    if (!verified) {
      log({ module: "websocket" }, `Invalid token provided`);
      socket.emit("error", { message: "Invalid authentication token" });
      socket.disconnect();
      return;
    }

    const userId = verified.userId;
    debug(
      { module: "websocket" },
      `Token verified: ${userId}, clientType: ${clientType || "user-scoped"}, sessionId: ${sessionId || "none"}, machineId: ${machineId || "none"}, socketId: ${socket.id}`,
    );

    // Store connection based on type
    const metadata = {
      clientType: clientType || "user-scoped",
      sessionId,
      machineId,
    };
    let connection: ClientConnection;
    if (metadata.clientType === "session-scoped" && sessionId) {
      connection = {
        connectionType: "session-scoped",
        socket,
        userId,
        sessionId,
      };
    } else if (metadata.clientType === "machine-scoped" && machineId) {
      connection = {
        connectionType: "machine-scoped",
        socket,
        userId,
        machineId,
      };
    } else {
      connection = {
        connectionType: "user-scoped",
        socket,
        userId,
      };
    }
    eventRouter.addConnection(userId, connection);
    incrementWebSocketConnection(connection.connectionType);

    // Broadcast daemon online status.
    if (connection.connectionType === "machine-scoped") {
      void emitSyncEphemeral(userId, {
        t: "machine-activity",
        machineId: machineId!,
        active: true,
        activeAt: Date.now(),
      });
    }

    socket.on("disconnect", () => {
      websocketEventsCounter.inc({ event_type: "disconnect" });

      // Cleanup connections
      eventRouter.removeConnection(userId, connection);
      decrementWebSocketConnection(connection.connectionType);

      debug({ module: "websocket" }, `User disconnected: ${userId}`);

      // Broadcast daemon offline status.
      if (connection.connectionType === "machine-scoped") {
        void emitSyncEphemeral(userId, {
          t: "machine-activity",
          machineId: connection.machineId,
          active: false,
          activeAt: Date.now(),
        });
      }
    });

    // Handlers — always reuse the same Map instance per userId.
    // CRITICAL: Never replace with a new Map, because other sockets for
    // the same userId hold a reference to the existing Map. Replacing it
    // would leave those sockets querying a stale (empty) Map.
    let userRpcListeners = rpcListeners.get(userId);
    if (!userRpcListeners) {
      userRpcListeners = new Map<string, Socket>();
      rpcListeners.set(userId, userRpcListeners);
    }

    if (connection.connectionType === "user-scoped") {
      // Direct catch-up emit to the just-connected socket only (NOT
      // broadcast). The SyncEphemeral seam's rpc-ready variant would
      // broadcast to every user-scoped socket; that is wrong here — we
      // are replaying ready state to one socket. Construct the wire
      // payload inline (same shape as the seam's rpc-ready Payload).
      for (const readyScope of listRpcReadyScopes(userRpcListeners)) {
        socket.emit("ephemeral", {
          type: "rpc-ready",
          scope: readyScope.scope,
          id: readyScope.id,
          ready: true,
        });
      }
    }

    rpcHandler({
      userId,
      socket,
      rpcListeners: userRpcListeners,
      clientType: metadata.clientType,
    });
    // Safety-net cleanup: remove any orphaned entries for this socket,
    // broadcast rpc-ready:false for affected scopes, then delete the user's Map if empty.
    socket.on("disconnect", () => {
      const affectedScopes = new Set<string>();
      for (const [method, registeredSocket] of userRpcListeners.entries()) {
        if (registeredSocket === socket) {
          userRpcListeners.delete(method);
          const colonIndex = method.indexOf(":");
          if (colonIndex > 0) {
            affectedScopes.add(method.substring(0, colonIndex));
          }
        }
      }
      // NOTE: Do NOT delete the userId Map even when empty.
      // Other sockets for the same userId hold a reference to this Map.
      // Deleting it would cause the next socket to create a new Map,
      // leaving existing sockets with a stale (orphaned) reference.
      // Broadcast rpc-ready:false for each scope that lost all its methods
      const rpcScope: "machine" | "session" | null =
          metadata.clientType === "machine-scoped" ? "machine"
              : metadata.clientType === "session-scoped" ? "session"
                  : null;
      if (rpcScope) {
        for (const scopeId of affectedScopes) {
          void emitSyncEphemeral(userId, { t: "rpc-ready", scope: rpcScope, id: scopeId, ready: false });
        }
      }
    });
    usageHandler(userId, socket);
    sessionUpdateHandler(userId, socket, connection);
    sessionAdoptHandler(userId, socket);
    sessionPreferencesHandler(userId, socket, connection);
    pingHandler(socket);
    machineUpdateHandler(userId, socket);
    artifactUpdateHandler(userId, socket);
    accessKeyHandler(userId, socket);
    webhookStatusHandler(socket, userId);
    supervisorRunStatusHandler(socket, userId);
    supervisorFixStatusHandler(socket, userId);
    knowledgeHandler(userId, socket);
    taskLogHandler(userId, socket);
    taskStatusHandler(socket, userId);
    sessionEventHandler(socket, userId);
    terminalHandler(userId, socket);
    interAgentMessageHandler(socket, userId);
    previewProxyHandler(userId, socket, machineId!);

    // F4: when a daemon reconnects, replay active preview tunnels so the
    // daemon-side proxy handler resumes. The CLI's apiMachine reattaches
    // registerPreviewProxyHandlers on every connect, but it only knows the
    // target candidate from a preview-start-proxy event.
    if (metadata.clientType === "machine-scoped" && machineId) {
      void (async () => {
        const { previewStore } = await import("@/app/preview/previewStore");
        const { db } = await import("@/storage/db");
        for (const conn of previewStore.listConnections()) {
          if (conn.machineId !== machineId) continue;
          const candidate = previewStore.getCandidate(conn.candidateId);
          if (!candidate) continue;
          // Verify session still belongs to user (defence in depth)
          const session = await db.session.findFirst({
            where: { id: conn.sessionId, accountId: userId },
            select: { id: true },
          });
          if (!session) continue;
          socket.emit("preview-start-proxy", {
            tunnelId: conn.tunnelId,
            candidate: {
              protocol: candidate.protocol,
              host: candidate.host,
              port: candidate.port,
            },
          });
        }
      })().catch(() => {});
    }

    // Authenticated and all event listeners are now registered. Machine/session
    // clients use this as the reliable readiness barrier before emitting their
    // initial RPC registrations, daemon state, and session-sync payloads.
    socket.emit("auth", { success: true, user: userId });

    // Ready
    debug({ module: "websocket" }, `User connected: ${userId}`);
  });

  onShutdown("api", async () => {
    await io.close();
  });
}
