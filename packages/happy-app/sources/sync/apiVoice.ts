import { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';
import { config } from '@/config';
import { storage } from './storage';
import { VOICEBOX_DEFAULT_ENDPOINT } from '@/realtime/voiceConfig';

export type VoiceTokenResponse =
    | { allowed: true; token: string; agentId: string; elevenUserId: string; usedSeconds: number; limitSeconds: number }
    | { allowed: false; reason: string; usedSeconds: number; limitSeconds: number; agentId: string };

export async function fetchVoiceToken(
    credentials: AuthCredentials,
    _sessionId: string
): Promise<VoiceTokenResponse> {
    const serverUrl = getServerUrl();

    const agentId = config.elevenLabsAgentId;

    if (!agentId) {
        throw new Error('Agent ID not configured');
    }

    // User's own API key from settings (optional, bypasses server-side usage gating)
    const userApiKey = storage.getState().settings.elevenLabsApiKey || undefined;

    const response = await fetch(`${serverUrl}/v1/voice/token`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            agentId,
            ...(userApiKey ? { userApiKey } : {}),
        })
    });

    if (!response.ok) {
        throw new Error(`Voice token request failed: ${response.status}`);
    }

    return await response.json();
}

/**
 * Voicebox TTS adapter — calls the local Voicebox REST API.
 *
 * Sends a POST request to `{endpoint}/tts` with the text and optional language,
 * and returns the raw Response containing the synthesized audio data.
 *
 * @param text - The text to synthesize
 * @param options.endpoint - Override the service URL (null → use VOICEBOX_DEFAULT_ENDPOINT)
 * @param options.language - BCP-47 language code (e.g. "en", "zh")
 */
export async function synthesizeVoicebox(
    text: string,
    options?: { endpoint?: string | null; language?: string | null }
): Promise<Response> {
    const baseUrl = options?.endpoint || VOICEBOX_DEFAULT_ENDPOINT;

    const response = await fetch(`${baseUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text,
            ...(options?.language ? { language: options.language } : {}),
        }),
    });

    if (!response.ok) {
        throw new Error(`Voicebox TTS request failed: ${response.status} ${response.statusText}`);
    }

    return response;
}

/**
 * Health-checks the Voicebox local service by calling GET `{endpoint}/health`.
 * Returns true if the service responds with a 2xx status within 3 seconds.
 *
 * @param endpoint - Service base URL (null → VOICEBOX_DEFAULT_ENDPOINT)
 */
export async function checkVoiceboxConnection(endpoint?: string | null): Promise<boolean> {
    const baseUrl = endpoint || VOICEBOX_DEFAULT_ENDPOINT;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`${baseUrl}/health`, {
            method: 'GET',
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        return response.ok;
    } catch {
        return false;
    }
}
