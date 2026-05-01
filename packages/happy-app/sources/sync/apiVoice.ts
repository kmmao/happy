import type { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';
import { config } from '@/config';
import { storage } from './storage';

export type VoiceTokenResponse =
    | { allowed: true; token: string; agentId: string; elevenUserId: string; usedSeconds: number; limitSeconds: number }
    | { allowed: false; reason: string; usedSeconds: number; limitSeconds: number; agentId: string };

export type LiveKitTokenResponse = { token: string; url: string; roomName: string };

export async function fetchVoiceToken(
    credentials: AuthCredentials,
    _sessionId: string
): Promise<VoiceTokenResponse> {
    const serverUrl = getServerUrl();

    const agentId = config.elevenLabsAgentId;

    if (!agentId) {
        throw new Error('Agent ID not configured');
    }

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

export async function fetchLiveKitToken(
    credentials: AuthCredentials,
    sessionId: string
): Promise<LiveKitTokenResponse> {
    const serverUrl = getServerUrl();
    const settings = storage.getState().settings;
    const userApiKey = settings.livekitApiKey || undefined;
    const userApiSecret = settings.livekitApiSecret || undefined;
    const userLivekitUrl = settings.livekitWssUrl || undefined;

    const response = await fetch(`${serverUrl}/v1/voice/livekit-token`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            sessionId,
            ...(userApiKey ? { userApiKey } : {}),
            ...(userApiSecret ? { userApiSecret } : {}),
            ...(userLivekitUrl ? { userLivekitUrl } : {}),
        })
    });

    if (!response.ok) {
        throw new Error(`LiveKit token request failed: ${response.status}`);
    }

    return await response.json();
}

export async function verifyLiveKitCredentials(
    credentials: AuthCredentials,
    apiKey: string,
    apiSecret: string,
    livekitUrl?: string
): Promise<{ valid: boolean; error?: string; activeRooms?: number }> {
    const serverUrl = getServerUrl();
    const response = await fetch(`${serverUrl}/v1/voice/livekit-verify`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            apiKey,
            apiSecret,
            ...(livekitUrl ? { livekitUrl } : {}),
        })
    });

    if (!response.ok) {
        throw new Error(`LiveKit verify request failed: ${response.status}`);
    }

    return await response.json();
}
