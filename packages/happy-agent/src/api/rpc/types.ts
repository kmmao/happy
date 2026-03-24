/**
 * Common RPC types and interfaces for both session and machine clients.
 * Mirrors happy-cli/src/api/rpc/types.ts
 */

/**
 * Generic RPC handler function type
 */
export type RpcHandler<TRequest = any, TResponse = any> = (
  data: TRequest,
) => TResponse | Promise<TResponse>;

/**
 * Map of method names to their handlers
 */
export type RpcHandlerMap = Map<string, RpcHandler>;

/**
 * RPC request data from server
 */
export interface RpcRequest {
  method: string;
  params: string; // Base64 encoded encrypted params
}

/**
 * RPC response callback
 */
export type RpcResponseCallback = (response: string) => void;

/**
 * Configuration for RPC handler manager
 */
export interface RpcHandlerConfig {
  scopePrefix: string;
  encryptionKey: Uint8Array;
  encryptionVariant: "legacy" | "dataKey";
  logger?: (message: string, data?: unknown) => void;
}

/**
 * Result of RPC handler execution
 */
export type RpcHandlerResult<T = any> =
  | { success: true; data: T }
  | { success: false; error: string };
