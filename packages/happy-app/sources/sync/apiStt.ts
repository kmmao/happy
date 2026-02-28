import { AuthCredentials } from "@/auth/tokenStorage";
import { getServerUrl } from "./serverConfig";

export interface SttTranscribeResponse {
    text: string;
    language?: string;
}

export interface SttTranscribeRequest {
    audioBlob: Blob;
    fileName?: string;
    mimeType?: string;
    lang?: string;
}

/**
 * Send audio to the server STT endpoint for transcription.
 * Uses multipart/form-data to avoid base64 overhead (~33% size savings).
 */
export async function transcribeSttAudio(
    credentials: AuthCredentials,
    request: SttTranscribeRequest,
): Promise<SttTranscribeResponse | null> {
    const serverUrl = getServerUrl();

    try {
        const form = new FormData();
        const fileName = request.fileName ?? "audio.webm";
        form.append("file", request.audioBlob, fileName);
        if (request.lang) {
            form.append("lang", request.lang);
        }

        const response = await fetch(`${serverUrl}/v1/stt/transcribe`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${credentials.token}`,
                // Let browser/RN set Content-Type with multipart boundary automatically
            },
            body: form,
        });

        if (!response.ok) {
            return null;
        }

        const data = (await response.json()) as SttTranscribeResponse;
        if (!data?.text) {
            return null;
        }
        return data;
    } catch {
        return null;
    }
}
