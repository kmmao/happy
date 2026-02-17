// Shared image upload utilities used by both native and web platform files.
//
// Contains constants, types, validation, and the core upload-via-RPC logic.
// Platform-specific resize functions live in imageUpload.ts (native) and
// imageUpload.web.ts (web).

import { getRandomBytes } from "expo-crypto";
import { sessionWriteFile } from "@/sync/ops";
import { apiSocket } from "@/sync/apiSocket";
import { storage } from "@/sync/storage"; // Used by evictStaleCache
import { HappyError } from "@/utils/errors";

export const MAX_IMAGES = 5;

export type MultiImageUploadResult = { paths: string[]; failedCount: number };

export const MAX_DIMENSION = 1024;
export const JPEG_QUALITY = 0.7;
export const MAX_BASE64_SIZE = 400_000; // 400KB — safe after encryption re-encoding (~533KB) stays well under Socket.IO 1MB limit

/** Per-session cache of the CLI's upload directory. Evicts when session disappears. */
const uploadDirCache = new Map<string, string>();

/** Generate a random hex filename to prevent collision and enumeration. */
function randomFilename(): string {
  const bytes = getRandomBytes(16);
  return (
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + ".jpg"
  );
}

/** Validate that base64 data starts with JPEG or PNG magic bytes. */
export function isValidImageBase64(base64: string): boolean {
  // JPEG starts with /9j/ in base64 (FFD8FF in hex)
  // PNG starts with iVBOR in base64 (89504E47 in hex)
  return base64.startsWith("/9j/") || base64.startsWith("iVBOR");
}

/** Get the upload dir via the CLI's `getUploadDir` RPC. Returns null on failure. */
async function getUploadDir(sessionId: string): Promise<string | null> {
  try {
    const result = await apiSocket.sessionRPC<
      { success: boolean; path?: string },
      Record<string, never>
    >(sessionId, "getUploadDir", {});
    if (!result.success || !result.path) {
      console.error(
        "[imageUpload] getUploadDir RPC returned unsuccessful:",
        result,
      );
      return null;
    }
    return result.path;
  } catch (error) {
    console.error("[imageUpload] getUploadDir RPC failed:", error);
    return null;
  }
}

/** Write base64 image data to a file on the CLI machine via the writeFile RPC.
 *  Returns true on success. */
async function writeImageFile(
  sessionId: string,
  remotePath: string,
  base64: string,
): Promise<boolean> {
  try {
    // expectedHash=null tells the CLI this is a new file (creates parent dirs automatically)
    const result = await sessionWriteFile(sessionId, remotePath, base64, null);
    if (!result.success) {
      console.error(
        "[imageUpload] writeImageFile failed for path:",
        remotePath,
        "result:",
        result,
      );
    }
    return result.success;
  } catch (error) {
    console.error(
      "[imageUpload] writeImageFile threw error for path:",
      remotePath,
      error,
    );
    return false;
  }
}

/** Evict cache entries for sessions that no longer exist. Debounced to once per minute. */
let lastEvictionTime = 0;
const EVICTION_INTERVAL = 60_000; // 1 minute

function evictStaleCache(): void {
  const now = Date.now();
  if (now - lastEvictionTime < EVICTION_INTERVAL) return;
  lastEvictionTime = now;

  const sessions = storage.getState().sessions;
  for (const key of uploadDirCache.keys()) {
    if (!sessions[key]) {
      uploadDirCache.delete(key);
    }
  }
}

/** Upload base64 image data to the CLI machine's OS temp dir. */
export async function uploadImage(
  sessionId: string,
  base64: string,
): Promise<string> {
  if (base64.length > MAX_BASE64_SIZE) {
    throw new HappyError("Image is too large to send", false);
  }
  if (!isValidImageBase64(base64)) {
    throw new HappyError("Invalid image format", false);
  }

  // Periodically evict stale cache entries
  evictStaleCache();

  const filename = randomFilename();

  // Use cache if available (the CLI already returns a session-scoped directory)
  const cached = uploadDirCache.get(sessionId);
  if (cached) {
    const remotePath = `${cached}/${filename}`;
    if (await writeImageFile(sessionId, remotePath, base64)) {
      return remotePath;
    }
    // Cached dir failed — clear and retry below
    console.error(
      "[imageUpload] cached dir write failed, retrying with fresh dir",
    );
    uploadDirCache.delete(sessionId);
  }

  // Upload to OS temp dir via getUploadDir RPC (cleaned by OS on reboot)
  const tempDir = await getUploadDir(sessionId);
  if (tempDir) {
    const remotePath = `${tempDir}/${filename}`;
    if (await writeImageFile(sessionId, remotePath, base64)) {
      uploadDirCache.set(sessionId, tempDir);
      return remotePath;
    }
    console.error("[imageUpload] fresh dir write also failed");
  } else {
    console.error("[imageUpload] getUploadDir returned null — cannot upload");
  }

  throw new HappyError("Failed to upload image", false);
}
