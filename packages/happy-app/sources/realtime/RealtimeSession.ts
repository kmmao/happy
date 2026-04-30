import type { VoiceSession } from './types';
import { fetchLiveKitToken, fetchVoiceToken } from '@/sync/apiVoice';
import { sync } from '@/sync/sync';
import { Modal } from '@/modal';
import { TokenStorage } from '@/auth/tokenStorage';
import { storage } from '@/sync/storage';
import { t } from '@/text';
import { requestMicrophonePermission, showMicrophonePermissionDeniedAlert } from '@/utils/microphonePermissions';

let voiceSession: VoiceSession | null = null;
let voiceSessionStarted: boolean = false;
let currentSessionId: string | null = null;

export async function startRealtimeSession(sessionId: string, initialContext?: string) {
    if (!voiceSession) {
        console.warn('No voice session registered');
        return;
    }

    // Request microphone permission before starting voice session
    // Critical for iOS/Android - first session will fail without this
    const permissionResult = await requestMicrophonePermission();
    if (!permissionResult.granted) {
        showMicrophonePermissionDeniedAlert(permissionResult.canAskAgain);
        return;
    }

    try {
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) {
            Modal.alert(t('common.error'), t('errors.authenticationFailed'));
            return;
        }

        const voiceBackend = storage.getState().settings.voiceBackend;

        if (voiceBackend === 'livekit') {
            const response = await fetchLiveKitToken(credentials, sessionId);

            currentSessionId = sessionId;
            voiceSessionStarted = true;

            await voiceSession.startSession({
                sessionId,
                initialContext,
                livekitToken: response.token,
                livekitUrl: response.url,
                livekitRoomName: response.roomName,
            });
            return;
        }

        const response = await fetchVoiceToken(credentials, sessionId);

        if (!response.allowed) {
            const result = await sync.presentPaywall();
            if (result.purchased) {
                await startRealtimeSession(sessionId, initialContext);
            }
            return;
        }

        currentSessionId = sessionId;
        voiceSessionStarted = true;

        await voiceSession.startSession({
            sessionId,
            initialContext,
            token: response.token,
            agentId: response.agentId,
            userId: response.elevenUserId,
        });
    } catch (error) {
        console.error('Failed to start realtime session:', error);
        currentSessionId = null;
        voiceSessionStarted = false;
        Modal.alert(t('common.error'), t('errors.voiceServiceUnavailable'));
    }
}

export async function stopRealtimeSession() {
    if (!voiceSession) {
        return;
    }

    try {
        await voiceSession.endSession();
        currentSessionId = null;
        voiceSessionStarted = false;
    } catch (error) {
        console.error('Failed to stop realtime session:', error);
    }
}

export function registerVoiceSession(session: VoiceSession) {
    if (voiceSession) {
        console.warn('Voice session already registered, replacing with new one');
    }
    voiceSession = session;
}

export function isVoiceSessionStarted(): boolean {
    return voiceSessionStarted;
}

export function getVoiceSession(): VoiceSession | null {
    return voiceSession;
}

export function getCurrentRealtimeSessionId(): string | null {
    return currentSessionId;
}
