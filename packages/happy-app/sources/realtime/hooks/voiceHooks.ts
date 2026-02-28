import {
  getCurrentRealtimeSessionId,
  isVoiceSessionStarted,
} from "../RealtimeSession";
import { realtimeStore } from "../realtimeStore";
import { Message } from "@/sync/typesMessage";
import { t } from "@/text";
import { preprocessTtsText } from "@/utils/ttsTextPreprocess";
import { splitIntoSentences } from "@/utils/sentenceSplitter";

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

  onPermissionRequested(
    sessionId: string,
    _requestId: string,
    toolName: string,
    _toolArgs: any,
  ) {
    if (!isVoiceSessionStarted()) return;
    if (getCurrentRealtimeSessionId() !== sessionId) return;

    const { ttsEnqueue } = realtimeStore.getState();
    if (ttsEnqueue) {
      ttsEnqueue(
        t("voiceStatusBar.permissionRequested", { toolName }),
        `perm_${_requestId}`,
      );
    }
  },

  onMessages(sessionId: string, messages: Message[]) {
    if (!isVoiceSessionStarted()) return;
    if (getCurrentRealtimeSessionId() !== sessionId) return;

    const { ttsEnqueue } = realtimeStore.getState();
    if (!ttsEnqueue) return;

    // Only speak agent-text messages (Claude Code responses)
    const agentMessages = messages
      .filter(
        (m): m is Extract<Message, { kind: "agent-text" }> =>
          m.kind === "agent-text" && !m.isThinking,
      )
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const msg of agentMessages) {
      const cleaned = preprocessTtsText(msg.text);
      if (cleaned) {
        // Split into sentence-level segments for streaming TTS playback
        const sentences = splitIntoSentences(cleaned);
        for (let i = 0; i < sentences.length; i++) {
          ttsEnqueue(sentences[i], `${msg.id}_s${i}`);
        }
      }
    }
  },

  onVoiceStarted(_sessionId: string): string {
    // No initial prompt needed in direct pipeline mode
    return "";
  },

  onReady(_sessionId: string) {
    // No TTS prompt on ready — the user already heard the full reply.
  },

  onVoiceStopped() {
    // Cleanup handled by RealtimeVoiceSession.endSession()
  },
};
