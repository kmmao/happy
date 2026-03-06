// Web-specific AES-GCM implementation using native Web Crypto API.
//
// Replaces rn-encryption/web-secure-encryption which uses
// `btoa(String.fromCharCode(...largeArray))` causing stack overflow
// on Android mobile browsers with large payloads (>32KB).

import { decodeBase64, encodeBase64 } from "@/encryption/base64";
import { decodeUTF8, encodeUTF8 } from "./text";

async function importAESKey(key64: string): Promise<CryptoKey> {
  const raw = decodeBase64(key64);
  return await crypto.subtle.importKey(
    "raw",
    raw.buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptAESGCMString(
  data: string,
  key64: string,
): Promise<string> {
  const key = await importAESKey(key64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(data);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );

  // Combine IV + ciphertext without spread operator
  const encryptedBytes = new Uint8Array(encrypted);
  const combined = new Uint8Array(iv.length + encryptedBytes.length);
  combined.set(iv, 0);
  combined.set(encryptedBytes, iv.length);

  // Use our safe base64 encoder (no btoa, no spread)
  return encodeBase64(combined);
}

export async function decryptAESGCMString(
  data: string,
  key64: string,
): Promise<string | null> {
  const key = await importAESKey(key64);
  const combined = decodeBase64(data);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

export async function encryptAESGCM(
  data: Uint8Array,
  key64: string,
): Promise<Uint8Array> {
  const encrypted = (await encryptAESGCMString(decodeUTF8(data), key64)).trim();
  return decodeBase64(encrypted);
}

export async function decryptAESGCM(
  data: Uint8Array,
  key64: string,
): Promise<Uint8Array | null> {
  const raw = await decryptAESGCMString(encodeBase64(data), key64);
  return raw ? encodeUTF8(raw) : null;
}
