// Camera capture utility for native (iOS/Android).
//
// Launches the device camera via expo-image-picker, resizes via
// expo-image-manipulator, and uploads to the CLI machine via RPC writeFile.
// Reuses the same resize/upload pipeline as gallery image picking.

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
import { log } from "@/log";

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

/** Capture a photo from device camera, resize, and upload. Returns result or null if canceled. */
export async function captureAndUploadPhoto(
    sessionId: string,
    currentCount: number,
): Promise<MultiImageUploadResult | null> {
    const remaining = MAX_IMAGES - currentCount;
    if (remaining <= 0) return null;

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
        throw new HappyError("Camera permission is required to take photos", false);
    }

    const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 1,
    });
    if (result.canceled || !result.assets?.length) return null;

    const asset = result.assets[0];
    const paths: string[] = [];
    const displayUris: string[] = [];
    let failedCount = 0;

    try {
        const base64 = await resizeAndEncode(asset.uri, asset.width, asset.height);
        const path = await uploadImage(sessionId, base64);
        paths.push(path);
        displayUris.push(asset.uri);
    } catch (err) {
        log.warn(
            "Camera capture upload failed:",
            err instanceof Error ? err.message : err,
        );
        failedCount++;
    }

    return { paths, displayUris, failedCount };
}
