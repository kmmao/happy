/**
 * rpcDispatch — shared RPC types + the pure dispatch core consumed by
 * `RpcHandlerManager` in both `@kmmao/happy-coder` (CLI) and
 * `@kmmao/happy-agent`.
 *
 * Why this lives in wire
 * ----------------------
 * Before this seam each package carried a near-identical 200-line
 * `RpcHandlerManager.ts` (CLI 4-space, Agent 2-space — that was the only
 * substantive difference). The plaintext routing core + the type contract
 * are genuinely shared. The socket lifecycle (timers, re-register on
 * connect, fast retry) stays in each package because that touches
 * `socket.io-client` directly — wire's invariant is "pure type/schema
 * package with no runtime side effects" (see wire's CLAUDE.md), and
 * `setInterval`/`setTimeout` count as side effects.
 *
 * What's here
 * -----------
 *   • Type contract — `RpcHandler`, `RpcHandlerMap`, `RpcRequest`,
 *     `RpcCipher` (structural — wire doesn't depend on the per-package
 *     crypto module), `RpcHandlerConfig`, `RpcLogger`.
 *   • `dispatchRpcMethod` — the plaintext routing core. Total fn: unknown
 *     method and throwing handler both resolve to `{ error }` instead of
 *     rejecting. The test surface for routing behaviour, exercised
 *     without any cipher or socket setup.
 *
 * What stays in each package
 * --------------------------
 *   • The `RpcHandlerManager` class (timers, re-register interval, fast
 *     retry, socket lifecycle, `handleRequest` wiring through the local
 *     `Cipher`).
 */

/**
 * A registered handler for one RPC method. Receives plaintext params,
 * returns a plaintext result (sync or async). The handler does NOT see
 * the wire envelope or the cipher.
 */
export type RpcHandler<TRequest = any, TResponse = any> = (
  data: TRequest,
) => TResponse | Promise<TResponse>;

/**
 * Method name → handler. Method names are prefix-scoped by the manager
 * (e.g. `session-<sid>:openFile`); the map's key is the already-prefixed
 * form.
 */
export type RpcHandlerMap = Map<string, RpcHandler>;

/**
 * RPC request as it arrives from the server. `params` is the base64
 * envelope produced by the matching `RpcCipher.encrypt`.
 */
export interface RpcRequest {
  method: string;
  params: string;
}

/**
 * Response callback shape — kept here so both packages share the type.
 */
export type RpcResponseCallback = (response: string) => void;

/**
 * Structural cipher contract — wire intentionally does NOT depend on
 * either package's crypto module. The CLI's `Cipher` (NaCl secretbox /
 * AES-256-GCM) and the Agent's `Cipher` both satisfy this shape
 * structurally; they pass themselves in unchanged.
 *
 * `decrypt` never throws — it returns a tagged result so the caller can
 * distinguish "decrypt failed" from "decrypted to a legitimate falsy
 * value" without collapsing both to `null`.
 */
export interface RpcCipher {
  encrypt(data: unknown): string;
  decrypt(data: string): { ok: true; value: any } | { ok: false };
}

/**
 * Logger fn shape. Manager-level fallback to `defaultLogger.debug` lives
 * in each package's class wrapper.
 */
export type RpcLogger = (message: string, data?: unknown) => void;

/**
 * Constructor config for `RpcHandlerManager` in either package. The class
 * narrows `cipher` to its local `Cipher` type at the constructor signature
 * (so existing call sites keep their stronger types), but the wire-level
 * shape is the structural `RpcCipher`.
 */
export interface RpcHandlerConfig {
  scopePrefix: string;
  cipher: RpcCipher;
  logger?: RpcLogger;
}

/**
 * Tagged result of handler execution. Currently only the CLI's
 * `RpcHandlerManager` exposes this type via re-export; declared here so
 * both consumer packages can adopt it in lockstep when they need a typed
 * fallible result.
 */
export type RpcHandlerResult<T = any> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Plaintext routing core — the test surface for routing behaviour.
 *
 * Given an already-decrypted (method, params) pair, route to the
 * registered handler and return its result. TOTAL: an unknown method or
 * a throwing handler both resolve to a typed `{ error }` value rather
 * than rejecting, so callers and tests don't have to wrap every dispatch
 * in `try`/`catch`.
 *
 * Knows nothing about the wire, the cipher, or sockets — every test for
 * routing behaviour can exercise this fn directly.
 */
export async function dispatchRpcMethod(
  handlers: RpcHandlerMap,
  method: string,
  params: unknown,
  logger: RpcLogger,
): Promise<unknown> {
  const handler = handlers.get(method);
  if (!handler) {
    logger("[RPC] [ERROR] Method not found", { method });
    return { error: "Method not found" };
  }
  try {
    logger("[RPC] Calling handler", { method });
    const result = await handler(params);
    logger("[RPC] Handler returned", {
      method,
      hasResult: result !== undefined,
    });
    return result;
  } catch (error) {
    logger("[RPC] [ERROR] Error handling request", { error });
    return {
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
