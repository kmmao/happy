import type { AuthCredentials } from '@/auth/tokenStorage';
import { throwIfNotOk } from '@/utils/http';
import { getServerUrl } from './serverConfig';
import { config } from '@/config';
import { storage } from './storage';

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

    throwIfNotOk(response, 'Voice token request failed');

    return await response.json();
}
