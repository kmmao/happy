// Image upload utility for native (iOS/Android).
//
// Picks images from gallery via expo-image-picker, resizes via
// expo-image-manipulator, and uploads to the CLI machine via RPC writeFile.

import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { HappyError } from "@/utils/errors";
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

/** Resize image URI via expo-image-manipulator, return JPEG base64 */
async function resizeAndEncode(
  uri: string,
  width: number,
  height: number,
): Promise<string> {
  const context = ImageManipulator.manipulate(uri);

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    if (width >= height) {
      context.resize({ width: MAX_DIMENSION });
    } else {
      context.resize({ height: MAX_DIMENSION });
    }
  }

  const ref = await context.renderAsync();

  // Try progressively lower quality until result fits within size limit
  for (const quality of QUALITY_STEPS) {
    const result = await ref.saveAsync({
      base64: true,
      compress: quality,
      format: SaveFormat.JPEG,
    });

    if (!result.base64) {
      throw new HappyError("Failed to process image", false);
    }

    if (!isValidImageBase64(result.base64)) {
      throw new HappyError("Invalid image format", false);
    }

    if (result.base64.length <= MAX_BASE64_SIZE) {
      return result.base64;
    }
  }

  throw new HappyError("Image is too large to send", false);
}

/** Pick multiple images from gallery and return base64 data (no upload). Returns null if canceled. */
export async function pickImagesAsBase64(
  currentCount: number,
): Promise<{ id: string; base64: string }[] | null> {
  const remaining = MAX_IMAGES - currentCount;
  if (remaining <= 0) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1, // Get lossless from picker; resizeAndEncode does the single JPEG compression
    allowsMultipleSelection: true,
    selectionLimit: remaining,
  });
  if (result.canceled || !result.assets?.length) return null;

  const results = await Promise.allSettled(
    result.assets.map(async (asset, i) => {
      const base64 = await resizeAndEncode(
        asset.uri,
        asset.width,
        asset.height,
      );
      return { id: `img-${Date.now()}-${i}`, base64 };
    }),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<{ id: string; base64: string }> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);
}

/** Pick multiple images from gallery, resize, and upload each. Returns paths + failure count, or null if canceled. */
export async function pickAndUploadImages(
  sessionId: string,
  currentCount: number,
): Promise<MultiImageUploadResult | null> {
  const remaining = MAX_IMAGES - currentCount;
  if (remaining <= 0) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1, // Get lossless from picker; resizeAndEncode does the single JPEG compression
    allowsMultipleSelection: true,
    selectionLimit: remaining,
  });
  if (result.canceled || !result.assets?.length) return null;

  // Encode concurrently (local CPU work), then upload serially to avoid
  // overwhelming the server→CLI forwarding with multiple large payloads at once.
  const encodeResults = await Promise.allSettled(
    result.assets.map(async (asset) => ({
      base64: await resizeAndEncode(asset.uri, asset.width, asset.height),
      displayUri: asset.uri,
    })),
  );

  const paths: string[] = [];
  const displayUris: string[] = [];
  let failedCount = 0;
  for (const r of encodeResults) {
    if (r.status === "rejected") {
      console.warn(
        "Image encode failed:",
        r.reason instanceof Error ? r.reason.message : r.reason,
      );
      failedCount++;
      continue;
    }
    try {
      const path = await uploadImage(sessionId, r.value.base64);
      paths.push(path);
      displayUris.push(r.value.displayUri);
    } catch (err) {
      console.warn(
        "Image upload failed:",
        err instanceof Error ? err.message : err,
      );
      failedCount++;
    }
  }

  return { paths, displayUris, failedCount };
}

/** Convert a Blob to resized base64 — web only, stub on native. */
export async function blobToResizedBase64(_blob: Blob): Promise<string> {
  throw new HappyError("Image paste is not supported on this platform", false);
}
