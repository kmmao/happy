/**
 * RpcHandlerManager — socket-bound wrapper around `dispatchRpcMethod`
 * (from `@kmmao/happy-wire`).
 *
 * The plaintext routing core + the type contract live in wire so both
 * `@kmmao/happy-coder` and `@kmmao/happy-agent` share one implementation
 * (see wire's `rpcDispatch.ts` for the rationale). What's left here is
 * the per-package responsibilities that wire's pure-types invariant
 * doesn't cover: the socket.io lifecycle, retry policy, fast-retry timer,
 * and periodic re-register safety net. None of those are pure functions
 * — they all touch real timers + a live Socket — so they stay out of
 * wire and stay in the consumer.
 *
 * If the lifecycle ever drifts between this file and the matching Agent
 * file, the duplication is the smell — extract the lifecycle into a
 * separate `@kmmao/happy-rpc-runtime` package at that point.
 */

import { logger as defaultLogger } from "@/ui/logger";
import type { Cipher } from "@/api/encryption";
import { dispatchRpcMethod } from "@kmmao/happy-wire";
import { Socket } from "socket.io-client";

import type {
  RpcHandler,
  RpcHandlerConfig,
  RpcHandlerMap,
  RpcLogger,
  RpcRequest,
} from "./types";

export class RpcHandlerManager {
  private handlers: RpcHandlerMap = new Map();
  private readonly scopePrefix: string;
  private readonly cipher: Cipher;
  private readonly logger: RpcLogger;
  private socket: Socket | null = null;
  private reregisterInterval: ReturnType<typeof setInterval> | null = null;
  private fastRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: RpcHandlerConfig) {
    this.scopePrefix = config.scopePrefix;
    this.cipher = config.cipher;
    this.logger =
      config.logger || ((msg, data) => defaultLogger.debug(msg, data));
  }

  /**
   * Register an RPC handler for a specific method.
   * @param method - The method name (without prefix).
   * @param handler - The handler function.
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
   * Route a decrypted RPC call to its handler. Delegates to wire's
   * `dispatchRpcMethod` — TOTAL, returns `{ error }` instead of
   * rejecting. Routing-behaviour tests live in wire.
   */
  async dispatch(method: string, params: unknown): Promise<unknown> {
    return dispatchRpcMethod(this.handlers, method, params, this.logger);
  }

  /**
   * Handle an incoming wire RPC request: decrypt params, dispatch in
   * plaintext, encrypt the result. The `Cipher` is the only encryption
   * seam; on decrypt failure the handler is still dispatched with `null`
   * params (preserving the previous behaviour where a corrupt payload
   * decrypted to `null`).
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
    const prefixedMethod = this.getPrefixedMethod(method);
    return this.handlers.has(prefixedMethod);
  }

  clearHandlers(): void {
    this.handlers.clear();
    this.logger("Cleared all RPC handlers");
  }

  /**
   * Register a single method with ack + retry. Falls back to
   * fire-and-forget emit after all retries are exhausted.
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
        .emit("rpc-register", { method }, (err: any, ackResponse: any) => {
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
        });
    };
    attempt(maxRetries);
  }

  private registerAllHandlers(socket: Socket): void {
    for (const [prefixedMethod] of this.handlers) {
      this.emitRegisterWithRetry(socket, prefixedMethod);
    }
  }

  /**
   * Fast retry: 5s after initial connect, re-register all handlers once.
   * Covers the case where the first batch of registrations failed
   * silently (e.g. server not fully ready yet after restart).
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
   * Periodic re-registration every 30s as a safety net. If the server
   * lost our registrations (deploy, network glitch), this restores them
   * without requiring a daemon restart.
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

/**
 * Factory function to create an RPC handler manager.
 */
export function createRpcHandlerManager(
  config: RpcHandlerConfig,
): RpcHandlerManager {
  return new RpcHandlerManager(config);
}
