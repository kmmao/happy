// Pure JS base64 encode/decode — no btoa/atob, no spread operator.
// Safe on all platforms including Android mobile WebView where btoa() and
// String.fromCharCode(...spread) can overflow the call stack with large buffers.

const B64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

export function decodeBase64(
  base64: string,
  encoding: "base64" | "base64url" = "base64",
): Uint8Array {
  let input = base64;

  if (encoding === "base64url") {
    input = input.replace(/-/g, "+").replace(/_/g, "/");
    const padding = input.length % 4;
    if (padding) {
      input += "=".repeat(4 - padding);
    }
  }

  // Strip padding to calculate output length
  let cleanLen = input.length;
  while (cleanLen > 0 && input.charCodeAt(cleanLen - 1) === 61 /* '=' */) {
    cleanLen--;
  }

  const outLen = (cleanLen * 3) >>> 2;
  const bytes = new Uint8Array(outLen);
  let j = 0;

  for (let i = 0; i < input.length; i += 4) {
    const a = B64_LOOKUP[input.charCodeAt(i)];
    const b = B64_LOOKUP[input.charCodeAt(i + 1)];
    const c = B64_LOOKUP[input.charCodeAt(i + 2)];
    const d = B64_LOOKUP[input.charCodeAt(i + 3)];

    bytes[j++] = (a << 2) | (b >> 4);
    if (j < outLen) bytes[j++] = ((b & 0x0f) << 4) | (c >> 2);
    if (j < outLen) bytes[j++] = ((c & 0x03) << 6) | d;
  }

  return bytes;
}

export function encodeBase64(
  buffer: Uint8Array,
  encoding: "base64" | "base64url" = "base64",
): string {
  const len = buffer.length;
  // Pre-allocate result array for 4 chars per 3-byte group
  const parts: string[] = [];
  const chunkSize = 12_000; // Process 12000 bytes (4000 triplets → 16000 chars) per chunk

  for (let offset = 0; offset < len; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, len);
    let chunk = "";
    let i = offset;

    // Process complete 3-byte groups
    for (; i + 2 < end; i += 3) {
      const n = (buffer[i] << 16) | (buffer[i + 1] << 8) | buffer[i + 2];
      chunk +=
        B64_CHARS[(n >> 18) & 0x3f] +
        B64_CHARS[(n >> 12) & 0x3f] +
        B64_CHARS[(n >> 6) & 0x3f] +
        B64_CHARS[n & 0x3f];
    }

    // Only handle remainder on the last chunk
    if (i < end && offset + chunkSize >= len) {
      const remaining = end - i;
      if (remaining === 1) {
        const n = buffer[i];
        chunk +=
          B64_CHARS[(n >> 2) & 0x3f] +
          B64_CHARS[(n << 4) & 0x3f] +
          "==";
      } else if (remaining === 2) {
        const n = (buffer[i] << 8) | buffer[i + 1];
        chunk +=
          B64_CHARS[(n >> 10) & 0x3f] +
          B64_CHARS[(n >> 4) & 0x3f] +
          B64_CHARS[(n << 2) & 0x3f] +
          "=";
      }
    }

    parts.push(chunk);
  }

  const base64 = parts.join("");

  if (encoding === "base64url") {
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  return base64;
}
