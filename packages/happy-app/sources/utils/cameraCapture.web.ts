// Web-specific camera capture utility.
//
// Uses <input type="file" capture="user"> to invoke the browser's camera,
// then resizes via Canvas API and uploads to the CLI machine.

import {
    MAX_IMAGES,
    uploadImage,
    type MultiImageUploadResult,
} from "@/utils/imageUpload.shared";
import { blobToResizedBase64 } from "@/utils/imageUpload.web";
import { log } from "@/log";

/** Prompt the browser to open the camera via a file input with capture attribute.
 *  Returns the captured file or null if canceled. */
async function promptCamera(): Promise<File | null> {
    return new Promise<File | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.capture = "user";
        input.style.display = "none";
        let resolved = false;
        const done = (result: File | null) => {
            if (resolved) return;
            resolved = true;
            resolve(result);
            input.remove();
        };
        input.onchange = () => {
            const file = input.files?.[0] ?? null;
            done(file);
        };
        // Handle cancel — input fires no change event, but window regains focus.
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
}

/** Capture a photo from the browser camera, resize, and upload.
 *  Returns result or null if canceled. */
export async function captureAndUploadPhoto(
    sessionId: string,
    currentCount: number,
): Promise<MultiImageUploadResult | null> {
    const remaining = MAX_IMAGES - currentCount;
    if (remaining <= 0) return null;

    const file = await promptCamera();
    if (!file) return null;

    const paths: string[] = [];
    const displayUris: string[] = [];
    let failedCount = 0;

    try {
        const base64 = await blobToResizedBase64(file);
        const path = await uploadImage(sessionId, base64);
        paths.push(path);
        displayUris.push(`data:image/jpeg;base64,${base64}`);
    } catch (err) {
        log.warn(
            "Web camera capture upload failed:",
            err instanceof Error ? err.message : err,
        );
        failedCount++;
    }

    return { paths, displayUris, failedCount };
}
