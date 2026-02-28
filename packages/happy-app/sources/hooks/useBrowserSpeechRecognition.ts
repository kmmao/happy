import { useState, useRef, useCallback, useEffect } from "react";
import type { UseSpeechToTextReturn } from "./useSpeechToText";

/**
 * Check if the browser supports the Web Speech API (SpeechRecognition).
 * Works in Chrome, Edge, Safari — not Firefox.
 */
export function isBrowserSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  );
}

function getSpeechRecognitionConstructor():
  | (new () => SpeechRecognition)
  | null {
  if (typeof window === "undefined") return null;
  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
  );
}

/**
 * Browser-native speech recognition using Web Speech API.
 * Zero latency (no network round-trip), free, real-time interim results.
 *
 * Uses `continuous: true` to keep the recognition session alive, avoiding
 * repeated start/stop cycles that produce system sounds ("ding") and audio
 * gaps on mobile browsers.
 *
 * Echo suppression uses "soft mute": during TTS playback we just ignore
 * incoming results instead of aborting the recognition. This avoids the
 * unreliable abort()/stop() behavior and eliminates restart latency.
 *
 * Limitations:
 * - Not all browsers (Firefox: no)
 * - Chrome sends audio to Google servers for processing
 * - Language support varies by browser
 * - Some browsers may auto-stop continuous recognition after ~60s of silence
 *   (handled by auto-restart in onend)
 */
export function useBrowserSpeechRecognition(
  onTranscript: (text: string) => void,
  lang?: string,
): UseSpeechToTextReturn | null {
  const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
  if (!SpeechRecognitionCtor) return null;

  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const langRef = useRef(lang);
  langRef.current = lang;

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const wantListeningRef = useRef(false);
  const isPausedRef = useRef(false);

  // Ref to break circular dependency: onend needs to create new instances,
  // but createRecognition sets up onend.
  const doStartRef = useRef<() => void>(() => {});

  const createAndStart = useCallback(() => {
    if (!SpeechRecognitionCtor) {
      wantListeningRef.current = false;
      setIsListening(false);
      setInterimTranscript("");
      return;
    }

    // Clean up any existing instance first
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = langRef.current ?? navigator.language ?? "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (!wantListeningRef.current || isPausedRef.current) return;

      const result = event.results[event.results.length - 1];
      const text = result?.[0]?.transcript?.trim() ?? "";

      if (result?.isFinal) {
        if (text) {
          onTranscriptRef.current(text);
        }
        setInterimTranscript("");
      } else {
        setInterimTranscript(text);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (wantListeningRef.current && !isPausedRef.current) {
        // In continuous mode, the browser may still end the session
        // (e.g., after prolonged silence, network error, etc.).
        // Restart seamlessly via ref.
        doStartRef.current();
      } else if (!wantListeningRef.current) {
        setIsListening(false);
        setInterimTranscript("");
      }
      // If paused, don't restart — resumeListening will handle it
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "no-speech" and "aborted" are expected during normal usage
      if (event.error === "no-speech" || event.error === "aborted") {
        return;
      }
      wantListeningRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);
      setInterimTranscript("");
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      wantListeningRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);
      setInterimTranscript("");
    }
  }, [SpeechRecognitionCtor]);

  // Keep ref in sync
  doStartRef.current = createAndStart;

  const startListening = useCallback(async () => {
    if (wantListeningRef.current) return;
    wantListeningRef.current = true;
    setIsListening(true);
    setInterimTranscript("");
    createAndStart();
  }, [createAndStart]);

  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    isPausedRef.current = false;
    setIsListening(false);
    setInterimTranscript("");

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  }, []);

  const pauseListening = useCallback(() => {
    if (!wantListeningRef.current || isPausedRef.current) return;
    isPausedRef.current = true;
    setInterimTranscript("");
    // Soft mute: keep recognition alive, just ignore results in onresult.
    // This avoids the system restart sounds and abort() unreliability.
  }, []);

  const resumeListening = useCallback(() => {
    if (!isPausedRef.current) return;
    isPausedRef.current = false;
    if (!wantListeningRef.current) return;

    setInterimTranscript("");
    // If recognition ended while paused (browser timeout), restart it
    if (!recognitionRef.current) {
      createAndStart();
    }
  }, [createAndStart]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      isPausedRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isListening,
    interimTranscript,
    startListening,
    stopListening,
    pauseListening,
    resumeListening,
  };
}
