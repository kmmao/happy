import React, { useEffect, useRef, useCallback } from "react";
import {
  registerVoiceSession,
  getCurrentRealtimeSessionId,
} from "./RealtimeSession";
import { storage } from "@/sync/storage";
import { sync } from "@/sync/sync";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useTtsPlayer } from "@/hooks/useTtsPlayer";
import {
  synthesizeSpeechEdge,
  synthesizeSpeechElevenLabs,
  ElevenLabsAuthError,
} from "@/sync/apiTts";
import { TokenStorage } from "@/auth/tokenStorage";
import { getEdgeTtsVoice } from "@/constants/Languages";
import type { VoiceSession, VoiceSessionConfig } from "./types";

// Module-level state
let isSessionActive = false;
const spokenMessageIds = new Set<string>();

const RealtimeVoiceSessionInner: React.FC = () => {
  const ttsPlayer = useTtsPlayer();
  const ttsPlayerRef = useRef(ttsPlayer);
  ttsPlayerRef.current = ttsPlayer;

  const ttsQueueRef = useRef<Array<{ text: string; messageId: string }>>([]);
  const isProcessingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    while (ttsQueueRef.current.length > 0 && isSessionActive) {
      const item = ttsQueueRef.current.shift();
      if (!item) break;

      try {
        const settings = storage.getState().settings;
        const voicePref = settings.voiceAssistantLanguage;

        let audioData: ArrayBuffer | null = null;

        if (
          settings.ttsProvider === "elevenlabs" &&
          settings.elevenLabsApiKey
        ) {
          // ElevenLabs TTS (paid, direct API call with user's own key)
          const langCode = voicePref?.split("-")[0] ?? undefined;
          audioData = await synthesizeSpeechElevenLabs({
            text: item.text,
            apiKey: settings.elevenLabsApiKey,
            voiceId: settings.elevenLabsVoiceId ?? undefined,
            languageCode: langCode,
          });
        } else {
          // Edge TTS (free, through server proxy)
          const credentials = await TokenStorage.getCredentials();
          if (!credentials) break;

          const voice = getEdgeTtsVoice(voicePref);
          audioData = await synthesizeSpeechEdge(credentials, {
            text: item.text,
            voice,
          });
        }

        if (audioData && isSessionActive) {
          storage.getState().setRealtimeMode("speaking");
          await ttsPlayerRef.current.play(audioData);
          storage.getState().setRealtimeMode("idle");
        }
      } catch (error) {
        if (error instanceof ElevenLabsAuthError) {
          // Auth failed — fallback to Edge TTS for remaining queue items
          sync.applySettings({ ttsProvider: "edge" });
          ttsQueueRef.current = [];
          break;
        }
        // Skip other TTS failures, continue with queue
      }
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

  // STT callback: send transcribed text to Claude Code
  const onTranscript = useCallback((text: string) => {
    const sessionId = getCurrentRealtimeSessionId();
    if (!sessionId || !text.trim()) return;

    // Stop any currently playing TTS when user speaks
    ttsPlayerRef.current.stop();
    ttsQueueRef.current = [];
    storage.getState().setRealtimeMode("idle");

    sync.sendMessage(sessionId, text.trim());
  }, []);

  const stt = useSpeechToText(onTranscript);
  const sttRef = useRef(stt);
  sttRef.current = stt;

  const hasRegistered = useRef(false);

  useEffect(() => {
    if (hasRegistered.current) return;

    const session: VoiceSession = {
      async startSession(_config: VoiceSessionConfig) {
        isSessionActive = true;
        isProcessingRef.current = false;
        spokenMessageIds.clear();
        ttsQueueRef.current = [];

        storage.getState().setRealtimeStatus("connected");
        storage.getState().setRealtimeMode("idle");

        await sttRef.current.startListening();
      },

      async endSession() {
        isSessionActive = false;
        isProcessingRef.current = false;
        ttsQueueRef.current = [];

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

  // Expose enqueueTts globally for voiceHooks
  useEffect(() => {
    voiceTtsEnqueue = enqueueTts;
    return () => {
      voiceTtsEnqueue = null;
    };
  }, [enqueueTts]);

  return null;
};

// Global function for voiceHooks to enqueue TTS playback
export let voiceTtsEnqueue: ((text: string, messageId: string) => void) | null =
  null;

export const RealtimeVoiceSession = React.memo(RealtimeVoiceSessionInner);
