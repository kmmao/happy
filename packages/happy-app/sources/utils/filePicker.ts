// File picker utility for native (iOS/Android).
//
// Picks files via expo-document-picker, reads them as base64 via
// expo-file-system, and uploads to the CLI machine via the shared
// uploadRawFile function. Files are referenced with [image: /path]
// format (Claude Code reads any file type).

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { MAX_IMAGES, MAX_BASE64_SIZE, uploadRawFile } from "@/utils/imageUpload.shared";
import { HappyError } from "@/utils/errors";
import { log } from "@/log";

export type FileUploadResult = {
    paths: string[];
    displayUris: string[];
    fileNames: string[];
    failedCount: number;
};

/** Approximate max raw file size before base64 encoding exceeds MAX_BASE64_SIZE. */
const MAX_RAW_FILE_SIZE = Math.floor(MAX_BASE64_SIZE * 3 / 4);

/** Pick files via document picker, read as base64, and upload each. Returns result or null if canceled. */
export async function pickAndUploadFiles(
    sessionId: string,
    currentCount: number,
): Promise<FileUploadResult | null> {
    const remaining = MAX_IMAGES - currentCount;
    if (remaining <= 0) return null;

    const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return null;

    const assets = result.assets.slice(0, remaining);
    const paths: string[] = [];
    const displayUris: string[] = [];
    const fileNames: string[] = [];
    let failedCount = 0;

    for (const asset of assets) {
        try {
            const name = asset.name || "file";

            // Pre-check file size before reading into memory
            if (asset.size && asset.size > MAX_RAW_FILE_SIZE) {
                throw new HappyError("File is too large to send (max ~500KB)", false);
            }

            const file = new File(asset.uri);
            const base64 = await file.base64();
            const path = await uploadRawFile(sessionId, base64, name);
            paths.push(path);
            displayUris.push(asset.uri);
            fileNames.push(name);
        } catch (err) {
            log.warn(
                "File upload failed:",
                err instanceof Error ? err.message : err,
            );
            failedCount++;
        }
    }

    return { paths, displayUris, fileNames, failedCount };
}
