import type { VoiceSession } from "./types";
import { realtimeStore } from "./realtimeStore";
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

export async function startRealtimeSession(sessionId: string) {
  const { voiceSession } = realtimeStore.getState();
  if (!voiceSession) {
    return;
  }

  const permissionResult = await requestMicrophonePermission();
  if (!permissionResult.granted) {
    showMicrophonePermissionDeniedAlert(permissionResult.canAskAgain);
    return;
  }

  try {
    realtimeStore.setState({ sessionId, isActive: true });
    storage.getState().setRealtimeStatus("connecting");

    await withTimeout(
      voiceSession.startSession({ sessionId }),
      SESSION_START_TIMEOUT_MS,
      "Voice session start",
    );
  } catch {
    realtimeStore.setState({ sessionId: null, isActive: false });
    storage.getState().setRealtimeStatus("disconnected");
    Modal.alert(t("common.error"), t("errors.voiceServiceUnavailable"));
  }
}

export async function stopRealtimeSession() {
  const { voiceSession } = realtimeStore.getState();
  if (!voiceSession) {
    return;
  }

  try {
    await voiceSession.endSession();
  } finally {
    realtimeStore.setState({ sessionId: null, isActive: false });
  }
}

export function registerVoiceSession(session: VoiceSession) {
  realtimeStore.setState({ voiceSession: session });
}

export function isVoiceSessionStarted(): boolean {
  return realtimeStore.getState().isActive;
}

export function getVoiceSession(): VoiceSession | null {
  return realtimeStore.getState().voiceSession;
}

export function getCurrentRealtimeSessionId(): string | null {
  return realtimeStore.getState().sessionId;
}
