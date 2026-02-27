import { getCurrentRealtimeSessionId, isVoiceSessionStarted } from '../RealtimeSession';
import { voiceTtsEnqueue } from '../RealtimeVoiceSession';
import { Message } from '@/sync/typesMessage';

/**
 * Voice hooks for the direct pipeline architecture.
 * Routes agent-text messages to Edge TTS for audio playback.
 */

export const voiceHooks = {

    onSessionOnline(_sessionId: string, _metadata?: Record<string, any>) {
        // No-op in direct pipeline mode
    },

    onSessionOffline(_sessionId: string, _metadata?: Record<string, any>) {
        // No-op in direct pipeline mode
    },

    onSessionFocus(_sessionId: string, _metadata?: Record<string, any>) {
        // No-op in direct pipeline mode
    },

    onPermissionRequested(sessionId: string, _requestId: string, toolName: string, _toolArgs: any) {
        if (!isVoiceSessionStarted()) return;
        if (getCurrentRealtimeSessionId() !== sessionId) return;

        // Announce permission requests via TTS
        if (voiceTtsEnqueue) {
            voiceTtsEnqueue(
                `Permission requested for ${toolName}`,
                `perm_${_requestId}`,
            );
        }
    },

    onMessages(sessionId: string, messages: Message[]) {
        if (!isVoiceSessionStarted()) return;
        if (getCurrentRealtimeSessionId() !== sessionId) return;
        if (!voiceTtsEnqueue) return;

        // Only speak agent-text messages (Claude Code responses)
        const agentMessages = messages
            .filter((m): m is Extract<Message, { kind: 'agent-text' }> =>
                m.kind === 'agent-text' && !m.isThinking,
            )
            .sort((a, b) => a.createdAt - b.createdAt);

        for (const msg of agentMessages) {
            if (msg.text.trim()) {
                voiceTtsEnqueue(msg.text.trim(), msg.id);
            }
        }
    },

    onVoiceStarted(_sessionId: string): string {
        // No initial prompt needed in direct pipeline mode
        return '';
    },

    onReady(sessionId: string) {
        if (!isVoiceSessionStarted()) return;
        if (getCurrentRealtimeSessionId() !== sessionId) return;

        // Optionally announce readiness
        if (voiceTtsEnqueue) {
            voiceTtsEnqueue('Done.', `ready_${sessionId}_${Date.now()}`);
        }
    },

    onVoiceStopped() {
        // Cleanup handled by RealtimeVoiceSession.endSession()
    },
};
