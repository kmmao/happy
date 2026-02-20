import { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';

export interface SttTranscribeResponse {
    text: string;
    language?: string;
}

export interface SttTranscribeRequest {
    audioBase64: string;
    fileName?: string;
    mimeType?: string;
    lang?: string;
}

export async function transcribeSttAudio(
    credentials: AuthCredentials,
    request: SttTranscribeRequest
): Promise<SttTranscribeResponse | null> {
    const serverUrl = getServerUrl();

    try {
        const response = await fetch(`${serverUrl}/v1/stt/transcribe`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(request)
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json() as SttTranscribeResponse;
        if (!data?.text) {
            return null;
        }
        return data;
    } catch {
        return null;
    }
}
