/**
 * Local re-exports of the RPC type contract.
 *
 * The shared types + the plaintext dispatch core now live in
 * `@kmmao/happy-wire/rpcDispatch` so both `@kmmao/happy-coder` (this
 * package) and `@kmmao/happy-agent` reuse one contract — see the wire
 * file for the rationale (one of the "two adapters = real seam"
 * deepenings). The local re-export keeps existing import sites
 * (`from '@/api/rpc/types'`) working unchanged.
 *
 * The local `RpcHandlerConfig` narrows `cipher` to the package-local
 * `Cipher` type so consumers keep their stronger types when constructing
 * the manager; the wire-level interface uses the structural `RpcCipher`.
 */

import type { Cipher } from "@/api/encryption";
import type {
  RpcHandler as WireRpcHandler,
  RpcHandlerMap as WireRpcHandlerMap,
  RpcRequest as WireRpcRequest,
  RpcResponseCallback as WireRpcResponseCallback,
  RpcLogger as WireRpcLogger,
  RpcCipher as WireRpcCipher,
  RpcHandlerResult as WireRpcHandlerResult,
} from "@kmmao/happy-wire";

export type RpcHandler<TRequest = any, TResponse = any> = WireRpcHandler<
  TRequest,
  TResponse
>;
export type RpcHandlerMap = WireRpcHandlerMap;
export type RpcRequest = WireRpcRequest;
export type RpcResponseCallback = WireRpcResponseCallback;
export type RpcLogger = WireRpcLogger;
export type RpcCipher = WireRpcCipher;
export type RpcHandlerResult<T = any> = WireRpcHandlerResult<T>;

/**
 * Constructor config — `cipher` is the package-local `Cipher` (NaCl /
 * AES-GCM) which structurally satisfies the wire's `RpcCipher`.
 */
export interface RpcHandlerConfig {
  scopePrefix: string;
  cipher: Cipher;
  logger?: WireRpcLogger;
}
