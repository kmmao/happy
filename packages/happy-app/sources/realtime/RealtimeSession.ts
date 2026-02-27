import type { VoiceSession } from "./types";
import { storage } from "@/sync/storage";
import { Modal } from "@/modal";
import { t } from "@/text";
import {
    requestMicrophonePermission,
    showMicrophonePermissionDeniedAlert,
} from "@/utils/microphonePermissions";

const SESSION_START_TIMEOUT_MS = 15000;

function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operation: string,
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(
                () => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
                timeoutMs,
            ),
        ),
    ]);
}

let voiceSession: VoiceSession | null = null;
let voiceSessionStarted: boolean = false;
let currentSessionId: string | null = null;

export async function startRealtimeSession(sessionId: string) {
    if (!voiceSession) {
        console.warn("No voice session registered");
        return;
    }

    const permissionResult = await requestMicrophonePermission();
    if (!permissionResult.granted) {
        showMicrophonePermissionDeniedAlert(permissionResult.canAskAgain);
        return;
    }

    try {
        currentSessionId = sessionId;
        voiceSessionStarted = true;
        storage.getState().setRealtimeStatus('connecting');

        await withTimeout(
            voiceSession.startSession({ sessionId }),
            SESSION_START_TIMEOUT_MS,
            "Voice session start",
        );
    } catch (error) {
        currentSessionId = null;
        voiceSessionStarted = false;
        storage.getState().setRealtimeStatus('disconnected');
        Modal.alert(t("common.error"), t("errors.voiceServiceUnavailable"));
    }
}

export async function stopRealtimeSession() {
    if (!voiceSession) {
        return;
    }

    try {
        await voiceSession.endSession();
    } catch (error) {
        console.error("Failed to stop realtime session:", error);
    } finally {
        currentSessionId = null;
        voiceSessionStarted = false;
    }
}

export function registerVoiceSession(session: VoiceSession) {
    if (voiceSession) {
        console.warn("Voice session already registered, replacing with new one");
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
