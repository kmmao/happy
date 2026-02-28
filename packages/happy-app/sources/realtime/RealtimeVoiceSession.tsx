import React, { useEffect, useRef, useCallback } from "react";
import {
  registerVoiceSession,
  getCurrentRealtimeSessionId,
} from "./RealtimeSession";
import { realtimeStore } from "./realtimeStore";
import { storage } from "@/sync/storage";
import { sync } from "@/sync/sync";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useTtsPlayer } from "@/hooks/useTtsPlayer";
import {
  synthesizeSpeechEdge,
  synthesizeSpeechElevenLabs,
  ElevenLabsAuthError,
} from "@/sync/apiTts";
import { correctTranscript } from "@/sync/apiStt";
import { TokenStorage } from "@/auth/tokenStorage";
import { getEdgeTtsVoice } from "@/constants/Languages";
import type { VoiceSession, VoiceSessionConfig } from "./types";

// Module-level imperative state (not suited for stores)
const spokenMessageIds = new Set<string>();
let thinkingTimeoutId: ReturnType<typeof setTimeout> | null = null;
const THINKING_TIMEOUT_MS = 30_000;
/** Delay after TTS playback ends before resuming STT (AEC stabilization). */
const AEC_RESUME_DELAY_MS = 200;
/** Delay after last transcript before sending accumulated text.
 * Shorter than VAD delay since server STT already adds latency. */
const TRANSCRIPT_DEBOUNCE_MS = 800;

function clearThinkingTimeout() {
  if (thinkingTimeoutId) {
    clearTimeout(thinkingTimeoutId);
    thinkingTimeoutId = null;
  }
}

/**
 * Synthesize speech for a text string using the user's preferred TTS provider.
 * Returns audio ArrayBuffer or null on failure.
 */
async function synthesizeTts(text: string): Promise<ArrayBuffer | null> {
  const settings = storage.getState().settings;
  const voicePref = settings.voiceAssistantLanguage;

  if (settings.ttsProvider === "elevenlabs" && settings.elevenLabsApiKey) {
    const langCode = voicePref?.split("-")[0] ?? undefined;
    return synthesizeSpeechElevenLabs({
      text,
      apiKey: settings.elevenLabsApiKey,
      voiceId: settings.elevenLabsVoiceId ?? undefined,
      languageCode: langCode,
    });
  }

  const credentials = await TokenStorage.getCredentials();
  if (!credentials) return null;

  const voice = getEdgeTtsVoice(voicePref);
  return synthesizeSpeechEdge(credentials, { text, voice });
}

const RealtimeVoiceSessionInner: React.FC = () => {
  const ttsPlayer = useTtsPlayer();
  const ttsPlayerRef = useRef(ttsPlayer);
  ttsPlayerRef.current = ttsPlayer;

  const ttsQueueRef = useRef<Array<{ text: string; messageId: string }>>([]);
  const isProcessingRef = useRef(false);

  // Transcript accumulation: collect multiple final results before sending
  const accumulatedTextRef = useRef("");
  const sendTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFlushingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    let prefetchedAudio: ArrayBuffer | null = null;
    let didPauseStt = false;

    while (
      ttsQueueRef.current.length > 0 &&
      realtimeStore.getState().isActive
    ) {
      const item = ttsQueueRef.current.shift();
      if (!item) break;

      try {
        // Use prefetched audio if available, otherwise synthesize
        let audioData: ArrayBuffer | null;
        if (prefetchedAudio) {
          audioData = prefetchedAudio;
          prefetchedAudio = null;
        } else {
          audioData = await synthesizeTts(item.text);
        }

        if (!audioData || !realtimeStore.getState().isActive) {
          prefetchedAudio = null;
          break;
        }

        // Pause STT before first TTS play to prevent echo
        if (!didPauseStt) {
          sttRef.current.pauseListening();
          didPauseStt = true;
        }

        // Clear thinking timeout, enter speaking mode
        clearThinkingTimeout();
        storage.getState().setRealtimeMode("speaking");

        // Start prefetching next item while playing current
        const nextItem = ttsQueueRef.current[0];
        const prefetchPromise =
          nextItem && realtimeStore.getState().isActive
            ? synthesizeTts(nextItem.text).catch(() => null)
            : Promise.resolve(null);

        // Play current audio (now properly waits for playback to finish)
        await ttsPlayerRef.current.play(audioData);

        // Collect prefetched result
        const prefetchResult = await prefetchPromise;
        if (prefetchResult && ttsQueueRef.current[0] === nextItem) {
          prefetchedAudio = prefetchResult;
        } else {
          prefetchedAudio = null;
        }

        if (
          realtimeStore.getState().isActive &&
          ttsQueueRef.current.length === 0
        ) {
          storage.getState().setRealtimeMode("listening");
        }
      } catch (error) {
        prefetchedAudio = null;
        if (error instanceof ElevenLabsAuthError) {
          sync.applySettings({ ttsProvider: "edge" });
          ttsQueueRef.current = [];
          break;
        }
      }
    }

    // Resume STT after all TTS playback with AEC stabilization delay
    if (didPauseStt && realtimeStore.getState().isActive) {
      await new Promise((resolve) => setTimeout(resolve, AEC_RESUME_DELAY_MS));
      sttRef.current.resumeListening();
    }

    // Return to listening only if we're still in "speaking" mode.
    // If user interrupted (mode is "thinking"), don't override.
    if (
      realtimeStore.getState().isActive &&
      storage.getState().realtimeMode === "speaking"
    ) {
      storage.getState().setRealtimeMode("listening");
    }

    isProcessingRef.current = false;
  }, []);

  const enqueueTts = useCallback(
    (text: string, messageId: string) => {
      if (spokenMessageIds.has(messageId)) return;
      spokenMessageIds.add(messageId);
      ttsQueueRef.current.push({ text, messageId });
      processQueue();
    },
    [processQueue],
  );

  // Flush accumulated transcript: send everything collected so far
  const flushTranscript = useCallback(async () => {
    if (isFlushingRef.current) return;
    isFlushingRef.current = true;

    try {
      const sessionId = getCurrentRealtimeSessionId();
      const fullText = accumulatedTextRef.current.trim();
      accumulatedTextRef.current = "";
      if (sendTimeoutRef.current) {
        clearTimeout(sendTimeoutRef.current);
        sendTimeoutRef.current = null;
      }
      if (!sessionId || !fullText) return;

      // Haiku correction (only when enabled in settings, silent fallback on failure)
      let finalText = fullText;
      if (storage.getState().settings.sttCorrection) {
        try {
          const credentials = await TokenStorage.getCredentials();
          if (credentials) {
            const lang =
              storage.getState().settings.voiceAssistantLanguage ?? undefined;
            finalText = await correctTranscript(credentials, finalText, lang);
          }
        } catch {
          // Use original text
        }
      }

      // Timeout guard: if no TTS arrives within 30s, fall back to listening
      clearThinkingTimeout();
      thinkingTimeoutId = setTimeout(() => {
        if (
          realtimeStore.getState().isActive &&
          storage.getState().realtimeMode === "thinking"
        ) {
          storage.getState().setRealtimeMode("listening", true);
        }
      }, THINKING_TIMEOUT_MS);

      sync.sendMessage(sessionId, finalText);
    } finally {
      isFlushingRef.current = false;
    }
  }, []);

  // STT callback: accumulate transcribed text, debounce before sending
  const onTranscript = useCallback(
    (text: string) => {
      const sessionId = getCurrentRealtimeSessionId();
      if (!sessionId || !text.trim()) return;

      // Stop any currently playing TTS when user speaks
      ttsPlayerRef.current.stop();
      ttsQueueRef.current = [];
      storage.getState().setRealtimeMode("thinking", true);

      // Accumulate text (space-separated)
      accumulatedTextRef.current +=
        (accumulatedTextRef.current ? " " : "") + text.trim();

      // Reset debounce: wait for user to stop speaking before sending
      if (sendTimeoutRef.current) {
        clearTimeout(sendTimeoutRef.current);
      }
      sendTimeoutRef.current = setTimeout(
        flushTranscript,
        TRANSCRIPT_DEBOUNCE_MS,
      );
    },
    [flushTranscript],
  );

  // Extract ISO 639-1 lang code (e.g. "zh" from "zh-CN") for STT
  const sttLang =
    storage.getState().settings.voiceAssistantLanguage?.split("-")[0] ??
    undefined;
  const stt = useSpeechToText(onTranscript, sttLang);
  const sttRef = useRef(stt);
  sttRef.current = stt;

  const hasRegistered = useRef(false);

  useEffect(() => {
    if (hasRegistered.current) return;

    const session: VoiceSession = {
      async startSession(_config: VoiceSessionConfig) {
        isProcessingRef.current = false;
        spokenMessageIds.clear();
        ttsQueueRef.current = [];
        accumulatedTextRef.current = "";
        if (sendTimeoutRef.current) {
          clearTimeout(sendTimeoutRef.current);
          sendTimeoutRef.current = null;
        }

        storage.getState().setRealtimeStatus("connected");
        storage.getState().setRealtimeMode("listening");

        await sttRef.current.startListening();
      },

      async endSession() {
        isProcessingRef.current = false;
        ttsQueueRef.current = [];
        accumulatedTextRef.current = "";
        if (sendTimeoutRef.current) {
          clearTimeout(sendTimeoutRef.current);
          sendTimeoutRef.current = null;
        }
        clearThinkingTimeout();

        sttRef.current.stopListening();
        ttsPlayerRef.current.stop();

        storage.getState().setRealtimeStatus("disconnected");
        storage.getState().setRealtimeMode("idle", true);
        storage.getState().clearRealtimeModeDebounce();
        spokenMessageIds.clear();
      },
    };

    registerVoiceSession(session);
    hasRegistered.current = true;
  }, []);

  // Expose enqueueTts via store for voiceHooks
  useEffect(() => {
    realtimeStore.setState({ ttsEnqueue: enqueueTts });
    return () => {
      realtimeStore.setState({ ttsEnqueue: null });
    };
  }, [enqueueTts]);

  return null;
};

export const RealtimeVoiceSession = React.memo(RealtimeVoiceSessionInner);
