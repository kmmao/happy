// Web-specific file picker utility.
//
// Uses <input type="file"> to pick files, reads as base64 via FileReader,
// and uploads to the CLI machine via the shared uploadRawFile function.

import { MAX_IMAGES, MAX_BASE64_SIZE, uploadRawFile } from "@/utils/imageUpload.shared";
import { encodeBase64 } from "@/encryption/base64";
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

/** Read a File as base64 string (without data URI prefix). */
async function fileToBase64(file: globalThis.File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return encodeBase64(bytes);
}

/** Prompt user to pick files via a hidden file input. */
async function promptFilePicker(maxFiles: number): Promise<globalThis.File[]> {
    return new Promise<globalThis.File[]>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = maxFiles > 1;
        input.style.display = "none";
        let resolved = false;
        const done = (result: globalThis.File[]) => {
            if (resolved) return;
            resolved = true;
            resolve(result);
            input.remove();
        };
        input.onchange = () => {
            const files = input.files ? Array.from(input.files).slice(0, maxFiles) : [];
            done(files);
        };
        const onFocus = () => {
            window.removeEventListener("focus", onFocus);
            setTimeout(() => {
                if (!input.files?.length) {
                    done([]);
                }
            }, 1000);
        };
        window.addEventListener("focus", onFocus);
        document.body.appendChild(input);
        input.click();
    });
}

/** Pick files via browser file picker, read as base64, and upload each. */
export async function pickAndUploadFiles(
    sessionId: string,
    currentCount: number,
): Promise<FileUploadResult | null> {
    const remaining = MAX_IMAGES - currentCount;
    if (remaining <= 0) return null;

    const files = await promptFilePicker(remaining);
    if (files.length === 0) return null;

    const paths: string[] = [];
    const displayUris: string[] = [];
    const fileNames: string[] = [];
    let failedCount = 0;

    for (const file of files) {
        try {
            const name = file.name || "file";

            // Pre-check file size before reading into memory
            if (file.size > MAX_RAW_FILE_SIZE) {
                throw new HappyError("File is too large to send (max ~500KB)", false);
            }

            const base64 = await fileToBase64(file);
            const path = await uploadRawFile(sessionId, base64, name);
            paths.push(path);
            displayUris.push(URL.createObjectURL(file));
            fileNames.push(name);
        } catch (err) {
            log.warn(
                "Web file upload failed:",
                err instanceof Error ? err.message : err,
            );
            failedCount++;
        }
    }

    return { paths, displayUris, fileNames, failedCount };
}
