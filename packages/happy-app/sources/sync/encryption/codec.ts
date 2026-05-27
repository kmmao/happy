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
