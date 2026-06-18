/**
 * SessionCryptoCodec — typed encrypt/decode seam for one Session's
 * AccessKey.
 *
 * Why a codec
 * -----------
 * `ApiSessionClient` previously called `this.cipher.encrypt(x)` /
 * `this.cipher.decrypt(x)` at 9 scattered sites — incoming envelope,
 * incoming Metadata, incoming AgentState, replay path, outgoing message,
 * outgoing Metadata + answer (success + version-mismatch), outgoing
 * AgentState + answer (success + version-mismatch). Each site:
 *
 *   - inlined a generic `(value as Metadata)` / `(value as AgentState)`
 *     cast on the decrypted payload (no type narrowing at the seam),
 *   - re-implemented the `result.ok ? result.value : null` fall-through
 *     by hand,
 *   - had to be edited again every time a new encrypted content shape
 *     (now Metadata, AgentState, message content; tomorrow maybe a
 *     prefs blob or a thinking-config record) was added.
 *
 * This module collapses the wire-call cipher surface into one object
 * with intent-named methods (`encryptMetadata`, `decodeMetadata`,
 * `encryptAgentState`, …). The underlying `Cipher` (NaCl secretbox /
 * AES-GCM dataKey) is unchanged — the codec is a thin typed wrapper.
 *
 * ADR-0001 (zero-knowledge server) is unaffected: this is purely
 * internal client-side seam organisation. The wire format and the
 * cipher primitives are identical; only the call sites get a typed
 * surface instead of a raw `any`.
 *
 * Codec extends `Cipher`
 * ----------------------
 * The codec implements the same `{ encrypt(unknown): string;
 * decrypt(string): DecryptResult }` shape as `Cipher` itself, so it
 * structurally satisfies wire's `RpcCipher` and can be passed to
 * `RpcHandlerManager` unchanged. The typed methods are additional —
 * callers that only need raw encrypt/decrypt keep calling them.
 *
 * Future hooks
 * ------------
 * Concentrating the cipher surface here makes it the natural place for
 * future invariants — AccessKey refetch on decrypt failure, decrypt
 * telemetry, audit logging — without scattering them across the 9 wire-
 * call sites. Today none of those exist; the codec is the seam they
 * would land in.
 */

import type { AgentState, Metadata } from "./types";
import type { Cipher, DecryptResult } from "./encryption";

export type CodecDecryptResult<T> =
  | { ok: true; value: T }
  | { ok: false };

export interface SessionCryptoCodec extends Cipher {
  // Inherited from Cipher (so the codec satisfies RpcCipher
  // structurally and the existing `cipher: this.cipher` wiring for
  // RpcHandlerManager works unchanged):
  //   encrypt(data: unknown): string
  //   decrypt(data: string): DecryptResult

  // Intent-named convenience methods — preferred at the 9 known call
  // sites in apiSession. Each is a one-line delegate to the underlying
  // Cipher plus a typed narrowing of the result.

  /** Encrypt an outgoing SessionMessage content body. */
  encryptMessageContent(content: unknown): string;

  /** Decrypt an incoming SessionMessage content body. */
  decodeMessageContent(wire: string): CodecDecryptResult<unknown>;

  /** Encrypt the `Metadata` payload on an `update-metadata` request. */
  encryptMetadata(value: Metadata): string;

  /**
   * Decrypt a `Metadata` blob from the server. The cast is narrowed at
   * the seam so callers don't repeat `(decrypted.value as Metadata)`.
   */
  decodeMetadata(wire: string): CodecDecryptResult<Metadata>;

  /** Encrypt the `AgentState` payload on an `update-state` request. */
  encryptAgentState(value: AgentState): string;

  /**
   * Decrypt an `AgentState` blob from the server. The cast is narrowed
   * at the seam.
   */
  decodeAgentState(wire: string): CodecDecryptResult<AgentState>;
}

/**
 * Wrap a `Cipher` in the typed codec surface. Behaviour-equivalent —
 * every method delegates to `cipher.encrypt` / `cipher.decrypt`; only
 * the call-site ergonomics change.
 */
export function createSessionCryptoCodec(cipher: Cipher): SessionCryptoCodec {
  // Inherited Cipher methods. Bound here so destructuring or pass-by-
  // reference doesn't drop the underlying cipher's `this` context (the
  // current `createCipher` factory returns plain object methods that
  // don't depend on `this`, but binding is a cheap hedge against a
  // future implementation that does).
  const encrypt: Cipher["encrypt"] = (data) => cipher.encrypt(data);
  const decrypt: Cipher["decrypt"] = (data) => cipher.decrypt(data);

  const narrow = <T>(result: DecryptResult): CodecDecryptResult<T> =>
    result.ok ? { ok: true, value: result.value as T } : { ok: false };

  return {
    encrypt,
    decrypt,
    encryptMessageContent: (content) => encrypt(content),
    decodeMessageContent: (wire) => narrow<unknown>(decrypt(wire)),
    encryptMetadata: (value) => encrypt(value),
    decodeMetadata: (wire) => narrow<Metadata>(decrypt(wire)),
    encryptAgentState: (value) => encrypt(value),
    decodeAgentState: (wire) => narrow<AgentState>(decrypt(wire)),
  };
}
