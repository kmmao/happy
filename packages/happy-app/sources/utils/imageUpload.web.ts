// Web-specific image upload utility.
//
// Resizes images via Canvas API and uploads to the CLI machine.
// Used for clipboard paste on web/desktop (Tauri).

import { HappyError } from "@/utils/errors";
import { encodeBase64 } from "@/encryption/base64";
import {
  MAX_IMAGES,
  MAX_DIMENSION,
  JPEG_QUALITY,
  MAX_BASE64_SIZE,
  isValidImageBase64,
  uploadImage,
  type MultiImageUploadResult,
} from "@/utils/imageUpload.shared";

export { MAX_IMAGES } from "@/utils/imageUpload.shared";
export type { MultiImageUploadResult } from "@/utils/imageUpload.shared";
export { uploadImage as uploadBase64Image } from "@/utils/imageUpload.shared";

// Progressive quality steps: start high, fall back if result exceeds size limit.
const QUALITY_STEPS = [JPEG_QUALITY, 0.6, 0.4];

/** Convert a Blob (from clipboard) to resized JPEG base64 string (without data URI prefix). */
export async function blobToResizedBase64(blob: Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (e) {
    throw new HappyError("Failed to process image", false);
  }

  try {
    const { width, height } = bitmap;

    // Calculate resize dimensions preserving aspect ratio
    let targetW = width;
    let targetH = height;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / Math.max(width, height);
      targetW = Math.round(width * scale);
      targetH = Math.round(height * scale);
    }

    // Use OffscreenCanvas to avoid blocking the main thread (supported in most modern browsers)
    const hasOffscreen = typeof OffscreenCanvas !== "undefined";

    if (hasOffscreen) {
      const offscreen = new OffscreenCanvas(targetW, targetH);
      const ctx = offscreen.getContext("2d");
      if (!ctx) {
        throw new HappyError("Failed to create canvas context", false);
      }
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);

      // Try progressively lower quality until result fits within size limit
      for (const quality of QUALITY_STEPS) {
        const outputBlob = await offscreen.convertToBlob({
          type: "image/jpeg",
          quality,
        });
        const buffer = await outputBlob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        // Use shared chunked encoder to avoid O(n^2) string concatenation
        const base64 = encodeBase64(bytes);
        if (base64.length <= MAX_BASE64_SIZE) {
          if (!isValidImageBase64(base64)) {
            throw new HappyError("Invalid image format", false);
          }
          return base64;
        }
      }
    } else {
      // Fallback: main-thread canvas for older browsers
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new HappyError("Failed to create canvas context", false);
      }
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);

      for (const quality of QUALITY_STEPS) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const parts = dataUrl.split(",");
        if (parts.length < 2) {
          throw new HappyError("Failed to encode image", false);
        }
        const base64 = parts[1];
        if (base64.length <= MAX_BASE64_SIZE) {
          // Release canvas pixel buffer
          canvas.width = 0;
          canvas.height = 0;
          if (!isValidImageBase64(base64)) {
            throw new HappyError("Invalid image format", false);
          }
          return base64;
        }
      }
      canvas.width = 0;
      canvas.height = 0;
    }

    throw new HappyError("Image is too large to send", false);
  } finally {
    bitmap.close();
  }
}

/** Open a native file picker dialog and return base64 data (no upload). Returns null if canceled. */
export async function pickImagesAsBase64(
  currentCount: number,
): Promise<{ id: string; base64: string }[] | null> {
  const remaining = MAX_IMAGES - currentCount;
  if (remaining <= 0) return null;

  const files = await new Promise<FileList | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = remaining > 1;
    input.style.display = "none";
    let resolved = false;
    const done = (result: FileList | null) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
      input.remove();
    };
    input.onchange = () => done(input.files);
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      setTimeout(() => {
        if (!input.files?.length) {
          done(null);
        }
      }, 1000);
    };
    window.addEventListener("focus", onFocus);
    document.body.appendChild(input);
    input.click();
  });

  if (!files || files.length === 0) return null;

  const selected = Array.from(files).slice(0, remaining);

  const results = await Promise.allSettled(
    selected.map(async (file, i) => {
      const base64 = await blobToResizedBase64(file);
      return { id: `img-${Date.now()}-${i}`, base64 };
    }),
  );

  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<{ id: string; base64: string }> =>
      r.status === "fulfilled",
  );

  return fulfilled.map((r) => r.value);
}

/** Open a native file picker dialog, resize selected images, and upload each. */
export async function pickAndUploadImages(
  sessionId: string,
  currentCount: number,
): Promise<MultiImageUploadResult | null> {
  const remaining = MAX_IMAGES - currentCount;
  if (remaining <= 0) return null;

  // Prompt user with a hidden file input
  const files = await new Promise<FileList | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = remaining > 1;
    input.style.display = "none";
    let resolved = false;
    const done = (result: FileList | null) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
      input.remove();
    };
    input.onchange = () => done(input.files);
    // Handle cancel — input fires no change event, but window regains focus.
    // Use 1000ms delay for Safari/slow machines where focus fires late.
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      setTimeout(() => {
        if (!input.files?.length) {
          done(null);
        }
      }, 1000);
    };
    window.addEventListener("focus", onFocus);
    document.body.appendChild(input);
    input.click();
  });

  if (!files || files.length === 0) return null;

  const selected = Array.from(files).slice(0, remaining);

  // Encode concurrently (local CPU work), then upload serially to avoid
  // overwhelming the server→CLI forwarding with multiple large payloads at once.
  const encodeResults = await Promise.allSettled(
    selected.map(async (file) => ({
      base64: await blobToResizedBase64(file),
      displayUri: `data:image/jpeg;base64,`,
    })),
  );

  const paths: string[] = [];
  const displayUris: string[] = [];
  const errorDetails: string[] = [];
  let failedCount = 0;
  for (const r of encodeResults) {
    if (r.status === "rejected") {
      const detail =
        r.reason instanceof Error
          ? `encode: ${r.reason.message}`
          : `encode: ${String(r.reason)}`;
      errorDetails.push(detail);
      failedCount++;
      continue;
    }
    try {
      const path = await uploadImage(sessionId, r.value.base64);
      paths.push(path);
      displayUris.push(`data:image/jpeg;base64,${r.value.base64}`);
    } catch (err) {
      const detail =
        err instanceof Error
          ? `upload: ${err.message}`
          : `upload: ${String(err)}`;
      errorDetails.push(detail);
      failedCount++;
    }
  }

  return { paths, displayUris, failedCount, errorDetails };
}
