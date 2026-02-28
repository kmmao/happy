import { createStore } from "zustand/vanilla";
import type { VoiceSession } from "./types";

interface RealtimeState {
    /** The registered voice session (set by RealtimeVoiceSession component). */
    voiceSession: VoiceSession | null;
    /** Current session ID when voice is active. */
    sessionId: string | null;
    /** Whether a voice session is currently active/started. */
    isActive: boolean;
    /** TTS enqueue function (set by RealtimeVoiceSession component). */
    ttsEnqueue: ((text: string, messageId: string) => void) | null;
}

export const realtimeStore = createStore<RealtimeState>(() => ({
    voiceSession: null,
    sessionId: null,
    isActive: false,
    ttsEnqueue: null,
}));
