import { eventRouter } from "@/app/events/eventRouter";
import { log } from "@/utils/log";
import { Socket } from "socket.io";

/** Long-running RPC methods that need more than 30 seconds to complete. */
const LONG_RUNNING_METHODS = new Set([
  "bash",
  "ripgrep",
  "difftastic",
  "getDirectoryTree",
  "writeFile",
]);
const SHORT_TIMEOUT = 30_000;
const LONG_TIMEOUT = 300_000; // 5 minutes

/** Extract the bare method name from a qualified `${sessionId}:${method}` string. */
function getForwardTimeout(qualifiedMethod: string): number {
  const bare = qualifiedMethod.includes(":")
    ? qualifiedMethod.split(":").pop()!
    : qualifiedMethod;
  return LONG_RUNNING_METHODS.has(bare) ? LONG_TIMEOUT : SHORT_TIMEOUT;
}

export function rpcHandler(
  userId: string,
  socket: Socket,
  rpcListeners: Map<string, Socket>,
) {
  // RPC register - Register this socket as a listener for an RPC method
  // Supports optional ack callback for reliable registration
  socket.on("rpc-register", async (data: any, ack?: (response: any) => void) => {
    try {
      const { method } = data;

      if (!method || typeof method !== "string") {
        if (ack) {
          ack({ ok: false, error: "Invalid method name" });
        } else {
          socket.emit("rpc-error", {
            type: "register",
            error: "Invalid method name",
          });
        }
        return;
      }

      // Register this socket as the listener for this method
      rpcListeners.set(method, socket);

      if (ack) {
        ack({ ok: true, method });
      } else {
        socket.emit("rpc-registered", { method });
      }
    } catch (error) {
      log(
        { module: "websocket", level: "error" },
        `Error in rpc-register: ${error}`,
      );
      if (ack) {
        ack({ ok: false, error: "Internal error" });
      } else {
        socket.emit("rpc-error", { type: "register", error: "Internal error" });
      }
    }
  });

  // RPC unregister - Remove this socket as a listener for an RPC method
  socket.on("rpc-unregister", async (data: any) => {
    try {
      const { method } = data;

      if (!method || typeof method !== "string") {
        socket.emit("rpc-error", {
          type: "unregister",
          error: "Invalid method name",
        });
        return;
      }

      if (rpcListeners.get(method) === socket) {
        rpcListeners.delete(method);
      }

      socket.emit("rpc-unregistered", { method });
    } catch (error) {
      log(
        { module: "websocket", level: "error" },
        `Error in rpc-unregister: ${error}`,
      );
      socket.emit("rpc-error", { type: "unregister", error: "Internal error" });
    }
  });

  // RPC call - Call an RPC method on another socket of the same user
  socket.on(
    "rpc-call",
    async (data: any, callback: (response: any) => void) => {
      try {
        const { method, params } = data;

        if (!method || typeof method !== "string") {
          if (callback) {
            callback({
              ok: false,
              error: "Invalid parameters: method is required",
            });
          }
          return;
        }

        const targetSocket = rpcListeners.get(method);
        if (!targetSocket || !targetSocket.connected) {
          // log({ module: 'websocket-rpc' }, `RPC call failed: Method ${method} not available (disconnected or not registered)`);
          if (callback) {
            callback({
              ok: false,
              error: "RPC method not available",
            });
          }
          return;
        }

        // Don't allow calling your own socket
        if (targetSocket === socket) {
          // log({ module: 'websocket-rpc' }, `RPC call failed: Attempted self-call on method ${method}`);
          if (callback) {
            callback({
              ok: false,
              error: "Cannot call RPC on the same socket",
            });
          }
          return;
        }

        // Log RPC call initiation
        const startTime = Date.now();
        log(
          { module: "websocket-rpc" },
          `RPC call: ${method} from socket ${socket.id} -> target ${targetSocket.id}`,
        );

        // Forward the RPC request to the target socket using emitWithAck
        try {
          const response = await targetSocket
            .timeout(getForwardTimeout(method))
            .emitWithAck("rpc-request", {
              method,
              params,
            });

          const duration = Date.now() - startTime;
          log({ module: "websocket-rpc" }, `RPC ok: ${method} (${duration}ms)`);

          // Forward the response back to the caller via callback
          if (callback) {
            callback({
              ok: true,
              result: response,
            });
          }
        } catch (error) {
          const duration = Date.now() - startTime;
          const errorMsg =
            error instanceof Error ? error.message : "RPC call failed";
          log(
            { module: "websocket-rpc", level: "error" },
            `RPC fail: ${method} - ${errorMsg} (${duration}ms)`,
          );

          // Timeout or error occurred
          if (callback) {
            callback({
              ok: false,
              error: errorMsg,
            });
          }
        }
      } catch (error) {
        // log({ module: 'websocket', level: 'error' }, `Error in rpc-call: ${error}`);
        if (callback) {
          callback({
            ok: false,
            error: "Internal error",
          });
        }
      }
    },
  );

  // NOTE: disconnect cleanup is handled in socket.ts (the authoritative handler)
  // to avoid duplicate cleanup and the invalid rpcListeners.delete(userId) call.
}
