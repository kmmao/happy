/**
 * Generic RPC handler manager for session and machine clients.
 * Manages RPC method registration, encryption/decryption, and handler execution.
 *
 * Adapted from happy-cli/src/api/rpc/RpcHandlerManager.ts with
 * Agent-local imports (no @/ path alias).
 */

import { logger as defaultLogger } from "../../logger";
import {
  decodeBase64,
  encodeBase64,
  encrypt,
  decrypt,
} from "../../encryption";
import type {
  RpcHandler,
  RpcHandlerMap,
  RpcRequest,
  RpcHandlerConfig,
} from "./types";
import type { Socket } from "socket.io-client";

export class RpcHandlerManager {
  private handlers: RpcHandlerMap = new Map();
  private readonly scopePrefix: string;
  private readonly encryptionKey: Uint8Array;
  private readonly encryptionVariant: "legacy" | "dataKey";
  private readonly logger: (message: string, data?: unknown) => void;
  private socket: Socket | null = null;
  private reregisterInterval: ReturnType<typeof setInterval> | null = null;
  private fastRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: RpcHandlerConfig) {
    this.scopePrefix = config.scopePrefix;
    this.encryptionKey = config.encryptionKey;
    this.encryptionVariant = config.encryptionVariant;
    this.logger =
      config.logger ?? ((msg, data) => defaultLogger.debug(msg, data));
  }

  /**
   * Register an RPC handler for a specific method
   */
  registerHandler<TRequest = any, TResponse = any>(
    method: string,
    handler: RpcHandler<TRequest, TResponse>,
  ): void {
    const prefixedMethod = this.getPrefixedMethod(method);
    this.handlers.set(prefixedMethod, handler);

    if (this.socket) {
      this.emitRegisterWithRetry(this.socket, prefixedMethod);
    }
  }

  /**
   * Handle an incoming RPC request
   */
  async handleRequest(request: RpcRequest): Promise<string> {
    try {
      const handler = this.handlers.get(request.method);

      if (!handler) {
        this.logger("[RPC] [ERROR] Method not found", {
          method: request.method,
        });
        const errorResponse = { error: "Method not found" };
        return encodeBase64(
          encrypt(this.encryptionKey, this.encryptionVariant, errorResponse),
        );
      }

      // Decrypt the incoming params
      const decryptedParams = decrypt(
        this.encryptionKey,
        this.encryptionVariant,
        decodeBase64(request.params),
      );

      // Call the handler
      this.logger("[RPC] Calling handler", { method: request.method });
      const result = await handler(decryptedParams);
      this.logger("[RPC] Handler returned", {
        method: request.method,
        hasResult: result !== undefined,
      });

      // Encrypt and return the response
      const encryptedResponse = encodeBase64(
        encrypt(this.encryptionKey, this.encryptionVariant, result),
      );
      return encryptedResponse;
    } catch (error) {
      this.logger("[RPC] [ERROR] Error handling request", { error });
      const errorResponse = {
        error: error instanceof Error ? error.message : "Unknown error",
      };
      return encodeBase64(
        encrypt(this.encryptionKey, this.encryptionVariant, errorResponse),
      );
    }
  }

  onSocketConnect(socket: Socket): void {
    this.socket = socket;
    this.registerAllHandlers(socket);
    this.scheduleFastRetry(socket);
    this.startReregisterInterval();
  }

  onSocketDisconnect(): void {
    this.socket = null;
    this.stopReregisterInterval();
    this.cancelFastRetry();
  }

  getHandlerCount(): number {
    return this.handlers.size;
  }

  hasHandler(method: string): boolean {
    return this.handlers.has(this.getPrefixedMethod(method));
  }

  clearHandlers(): void {
    this.handlers.clear();
    this.logger("Cleared all RPC handlers");
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Register a single method with ack + retry.
   * Falls back to fire-and-forget emit after all retries exhausted.
   */
  private emitRegisterWithRetry(
    socket: Socket,
    method: string,
    maxRetries = 3,
  ): void {
    const attempt = (remaining: number) => {
      if (this.socket !== socket) return;
      socket
        .timeout(5000)
        .emit(
          "rpc-register",
          { method },
          (err: unknown, ackResponse: { ok?: boolean; error?: string }) => {
            if (this.socket !== socket) return;
            if (err && remaining > 0) {
              this.logger("[RPC] rpc-register ack timeout, retrying", {
                method,
                remaining,
              });
              setTimeout(() => attempt(remaining - 1), 1000);
            } else if (err) {
              this.logger(
                "[RPC] [WARN] rpc-register failed after retries, falling back to emit",
                { method },
              );
              socket.emit("rpc-register", { method });
            } else if (!ackResponse?.ok) {
              this.logger("[RPC] [WARN] rpc-register rejected by server", {
                method,
                error: ackResponse?.error,
              });
            }
          },
        );
    };
    attempt(maxRetries);
  }

  private registerAllHandlers(socket: Socket): void {
    for (const [prefixedMethod] of this.handlers) {
      this.emitRegisterWithRetry(socket, prefixedMethod);
    }
  }

  /**
   * Fast retry: 5 seconds after initial connect, re-register all handlers once.
   * Covers the case where the first batch of registrations failed silently.
   */
  private scheduleFastRetry(socket: Socket): void {
    this.cancelFastRetry();
    this.fastRetryTimer = setTimeout(() => {
      this.fastRetryTimer = null;
      if (this.socket === socket && this.handlers.size > 0) {
        this.logger("[RPC] Fast retry: re-registering all handlers");
        this.registerAllHandlers(socket);
      }
    }, 5_000);
  }

  private cancelFastRetry(): void {
    if (this.fastRetryTimer) {
      clearTimeout(this.fastRetryTimer);
      this.fastRetryTimer = null;
    }
  }

  /**
   * Periodic re-registration every 30s as a safety net.
   */
  private startReregisterInterval(): void {
    this.stopReregisterInterval();
    this.reregisterInterval = setInterval(() => {
      if (this.socket && this.handlers.size > 0) {
        this.registerAllHandlers(this.socket);
      }
    }, 30_000);
  }

  private stopReregisterInterval(): void {
    if (this.reregisterInterval) {
      clearInterval(this.reregisterInterval);
      this.reregisterInterval = null;
    }
  }

  private getPrefixedMethod(method: string): string {
    return `${this.scopePrefix}:${method}`;
  }
}

export function createRpcHandlerManager(
  config: RpcHandlerConfig,
): RpcHandlerManager {
  return new RpcHandlerManager(config);
}
