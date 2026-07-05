import { z } from "zod";
import { decodeBase64, encodeBase64 } from "@/encryption/base64";
import type { Decryptor, Encryptor } from "./encryptor";

//
// Shared single-value codec for the client encryption domain.
//
// Every per-entity facade (session, machine, artifact) and the legacy
// account-level encryptor wrap exactly the same plumbing around an
// `Encryptor & Decryptor`: encode one value to a base64 string, or decode one
// base64 string back to its value. Concentrating it here keeps the
// encode/decode + null-handling rules in one place and — because the adapter
// is a parameter — makes that logic testable with a fake adapter (no real
// crypto backend required).
//

/**
 * Encrypt a single value and return it as a base64 string.
 */
export async function encryptValue(
  encryptor: Encryptor,
  value: unknown,
): Promise<string> {
  const encrypted = await encryptor.encrypt([value]);
  return encodeBase64(encrypted[0], "base64");
}

/**
 * Decrypt a single base64 string to its value, or `null` when the adapter
 * yields a falsy item (e.g. failed authentication). Decode/decrypt errors are
 * NOT caught — callers that need a softer failure mode use {@link decryptValueSafe}.
 */
export async function decryptValue(
  decryptor: Decryptor,
  encrypted: string,
): Promise<any | null> {
  const data = decodeBase64(encrypted, "base64");
  const decrypted = await decryptor.decrypt([data]);
  return decrypted[0] || null;
}

/**
 * Like {@link decryptValue} but swallows decode/decrypt errors, returning `null`.
 */
export async function decryptValueSafe(
  decryptor: Decryptor,
  encrypted: string,
): Promise<any | null> {
  try {
    return await decryptValue(decryptor, encrypted);
  } catch {
    return null;
  }
}

/**
 * Discriminated result of decrypt-then-validate. `{ ok: false }` is the single
 * shape for all three ways a value fails to materialize (empty input, a null
 * decrypt / auth failure, or a schema mismatch) so the caller decides both the
 * fallback value AND whether to cache — only an `ok` result is safe to cache.
 */
export type DecryptParseResult<T> = { ok: true; value: T } | { ok: false };

/**
 * Decrypt one base64 string and validate it against `schema`. Concentrates the
 * decrypt → null-check → safeParse cycle that each per-entity decrypt method
 * (metadata, agentState, preferences) previously re-implemented. Decode/decrypt
 * errors propagate, exactly like {@link decryptValue}; callers wanting a soft
 * failure (as `decryptPreferences` does) wrap the call in try/catch. Testable
 * with a fake `Decryptor` and any schema — no real crypto backend needed.
 */
export async function decryptAndParse<T>(
  decryptor: Decryptor,
  encrypted: string | null | undefined,
  schema: z.ZodType<T>,
): Promise<DecryptParseResult<T>> {
  if (!encrypted) return { ok: false };
  const decrypted = await decryptValue(decryptor, encrypted);
  if (decrypted === null) return { ok: false };
  const parsed = schema.safeParse(decrypted);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}
