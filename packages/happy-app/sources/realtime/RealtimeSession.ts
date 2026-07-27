import type { VoiceSession } from './types';
import { fetchVoiceToken } from '@/sync/apiVoice';
import { sync } from '@/sync/sync';
import { storage } from '@/sync/storage';
import { Modal } from '@/modal';
import { TokenStorage } from '@/auth/tokenStorage';
import { t } from '@/text';
import { requestMicrophonePermission, showMicrophonePermissionDeniedAlert } from '@/utils/microphonePermissions';
import { OpenAIRealtimeSession } from './providers/openaiRealtime/OpenAIRealtimeSession';

/** ElevenLabs implementation, registered by the platform provider component. */
let elevenLabsSession: VoiceSession | null = null;
/** Realtime gateway implementation, created on first use. */
let openAIRealtimeSession: VoiceSession | null = null;
/** Implementation backing the currently running conversation. */
let activeSession: VoiceSession | null = null;

let voiceSessionStarted: boolean = false;
let currentSessionId: string | null = null;
/** Only warn about a degraded provider once per app run, not on every start. */
let fallbackNotified: boolean = false;

function resolveVoiceProvider(): 'elevenlabs' | 'openai-realtime' {
    return storage.getState().settings.voiceProvider ?? 'elevenlabs';
}

function resolveVoiceSession(): VoiceSession | null {
    if (resolveVoiceProvider() === 'openai-realtime') {
        openAIRealtimeSession ??= new OpenAIRealtimeSession();
        return openAIRealtimeSession;
    }
    return elevenLabsSession;
}

/**
 * ElevenLabs mints a per-conversation token server-side and gates usage behind
 * the paywall. The realtime gateway is configured by the user with their own
 * key, so it starts straight away.
 */
async function startElevenLabsSession(
    session: VoiceSession,
    sessionId: string,
    initialContext?: string,
): Promise<boolean> {
    const credentials = await TokenStorage.getCredentials();
    if (!credentials) {
        Modal.alert(t('common.error'), t('errors.authenticationFailed'));
        return false;
    }

    const response = await fetchVoiceToken(credentials, sessionId);
    if (!response.allowed) {
        const result = await sync.presentPaywall();
        if (result.purchased) {
            await startRealtimeSession(sessionId, initialContext);
        }
        return false;
    }

    currentSessionId = sessionId;
    voiceSessionStarted = true;
    activeSession = session;

    await session.startSession({
        sessionId,
        initialContext,
        token: response.token,
        agentId: response.agentId,
        userId: response.elevenUserId,
    });
    return true;
}

export async function startRealtimeSession(sessionId: string, initialContext?: string) {
    const session = resolveVoiceSession();
    if (!session) {
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
        if (resolveVoiceProvider() === 'openai-realtime') {
            try {
                currentSessionId = sessionId;
                voiceSessionStarted = true;
                activeSession = session;
                await session.startSession({ sessionId, initialContext });
            } catch (realtimeError) {
                // The realtime gateway is the preferred provider but depends on a
                // reachable third-party endpoint. Rather than leaving the user
                // without voice, degrade to ElevenLabs when it is available.
                console.warn('Realtime provider unavailable, falling back to ElevenLabs:', realtimeError);
                if (!elevenLabsSession) {
                    throw realtimeError;
                }
                await session.endSession().catch(() => {});
                if (!fallbackNotified) {
                    fallbackNotified = true;
                    Modal.alert(t('common.error'), t('errors.voiceRealtimeFallback'));
                }
                await startElevenLabsSession(elevenLabsSession, sessionId, initialContext);
            }
        } else {
            await startElevenLabsSession(session, sessionId, initialContext);
        }
    } catch (error) {
        console.error('Failed to start realtime session:', error);
        currentSessionId = null;
        voiceSessionStarted = false;
        activeSession = null;
        Modal.alert(t('common.error'), t('errors.voiceServiceUnavailable'));
    }
}

export async function stopRealtimeSession() {
    const session = activeSession ?? resolveVoiceSession();
    if (!session) {
        return;
    }

    try {
        await session.endSession();
        currentSessionId = null;
        voiceSessionStarted = false;
        activeSession = null;
    } catch (error) {
        console.error('Failed to stop realtime session:', error);
    }
}

export function registerVoiceSession(session: VoiceSession) {
    if (elevenLabsSession) {
        console.warn('Voice session already registered, replacing with new one');
    }
    elevenLabsSession = session;
}

export function isVoiceSessionStarted(): boolean {
    return voiceSessionStarted;
}

export function getVoiceSession(): VoiceSession | null {
    return activeSession ?? resolveVoiceSession();
}

export function getCurrentRealtimeSessionId(): string | null {
    return currentSessionId;
}
