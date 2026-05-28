/**
 * Generic RPC handler manager for session and machine clients.
 * Manages RPC method registration, encryption/decryption, and handler execution.
 *
 * Adapted from happy-cli/src/api/rpc/RpcHandlerManager.ts with
 * Agent-local imports (no @/ path alias).
 */

import { logger as defaultLogger } from "../../logger";
import type { Cipher } from "../../encryption";
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
  private readonly cipher: Cipher;
  private readonly logger: (message: string, data?: unknown) => void;
  private socket: Socket | null = null;
  private reregisterInterval: ReturnType<typeof setInterval> | null = null;
  private fastRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: RpcHandlerConfig) {
    this.scopePrefix = config.scopePrefix;
    this.cipher = config.cipher;
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
   * Route a decrypted RPC call to its handler. This is the plaintext core of
   * the manager: it knows nothing about the wire (no base64, no cipher), so it
   * is TOTAL — an unknown method or a throwing handler both resolve to an
   * `{ error }` value rather than rejecting. That makes it the test surface for
   * routing behaviour, exercised without any crypto setup.
   */
  async dispatch(method: string, params: unknown): Promise<unknown> {
    const handler = this.handlers.get(method);
    if (!handler) {
      this.logger("[RPC] [ERROR] Method not found", { method });
      return { error: "Method not found" };
    }
    try {
      this.logger("[RPC] Calling handler", { method });
      const result = await handler(params);
      this.logger("[RPC] Handler returned", {
        method,
        hasResult: result !== undefined,
      });
      return result;
    } catch (error) {
      this.logger("[RPC] [ERROR] Error handling request", { error });
      return { error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  /**
   * Handle an incoming wire RPC request: decrypt params, dispatch in plaintext,
   * encrypt the result. The Cipher is the only encryption seam; on a decrypt
   * failure the handler is still dispatched with `null` params (preserving the
   * previous behaviour where a corrupt payload decrypted to `null`).
   */
  async handleRequest(request: RpcRequest): Promise<string> {
    const decrypted = this.cipher.decrypt(request.params);
    const result = await this.dispatch(
      request.method,
      decrypted.ok ? decrypted.value : null,
    );
    return this.cipher.encrypt(result);
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
