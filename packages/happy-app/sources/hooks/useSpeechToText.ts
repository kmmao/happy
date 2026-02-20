import { useState, useRef, useCallback, useEffect } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import * as Localization from "expo-localization";
import {
  requestMicrophonePermission,
  showMicrophonePermissionDeniedAlert,
} from "@/utils/microphonePermissions";

export interface UseSpeechToTextReturn {
  isListening: boolean;
  /** The latest unfinalized speech text — updates in real-time as the user speaks. */
  interimTranscript: string;
  startListening: () => Promise<void>;
  stopListening: () => void;
}

/**
 * Native (iOS/Android) speech-to-text using expo-speech-recognition.
 *
 * Uses `continuous: false` so each recognition session ends naturally after one
 * utterance/pause.  We then decide in the "end" handler whether to restart
 * (user still wants to listen) or stop (user clicked stop).  This avoids the
 * unreliable stop()/abort() problem in continuous mode on iOS.
 *
 * `interimTranscript` is exposed as state for real-time display.
 */
export function useSpeechToText(
  onTranscript: (text: string) => void,
  lang?: string,
): UseSpeechToTextReturn {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // True = user wants to keep listening (restart after each natural end).
  // Only `startListening` sets this to true; `stopListening` sets it to false.
  const wantListeningRef = useRef(false);
  // Prevents double-calls while awaiting permissions in startListening.
  const isStartingRef = useRef(false);
  // Stores the resolved language so the "end" handler can restart with it.
  const langRef = useRef(lang);
  langRef.current = lang;
  // Mirror of interimTranscript state for synchronous access in stopListening.
  const interimTextRef = useRef("");

  /** Fire-and-forget: start a single (non-continuous) recognition session. */
  const doStart = useCallback(() => {
    const deviceLocale = Localization.getLocales()?.[0]?.languageTag ?? "en-US";
    ExpoSpeechRecognitionModule.start({
      lang: langRef.current ?? deviceLocale,
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
    });
  }, []);

  // ── event handlers ──────────────────────────────────────────────────

  useSpeechRecognitionEvent("start", () => {
    if (!wantListeningRef.current) {
      // User clicked stop before native start fired – kill it immediately
      ExpoSpeechRecognitionModule.abort();
      return;
    }
    isStartingRef.current = false;
    setIsListening(true);
  });

  useSpeechRecognitionEvent("end", () => {
    isStartingRef.current = false;
    if (wantListeningRef.current) {
      // Session ended naturally (pause / single utterance) but user still
      // wants to listen → seamlessly restart for the next utterance.
      doStart();
    } else {
      setIsListening(false);
      setInterimTranscript("");
      interimTextRef.current = "";
    }
  });

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results[0]?.transcript?.trim() ?? "";
    if (event.isFinal) {
      if (text) {
        onTranscriptRef.current(text);
      }
      setInterimTranscript("");
      interimTextRef.current = "";
    } else {
      interimTextRef.current = text;
      setInterimTranscript(text);
    }
  });

  useSpeechRecognitionEvent("error", () => {
    isStartingRef.current = false;
    wantListeningRef.current = false;
    setIsListening(false);
    setInterimTranscript("");
    interimTextRef.current = "";
  });

  // ── public API ──────────────────────────────────────────────────────

  const startListening = useCallback(async () => {
    if (isStartingRef.current || wantListeningRef.current) return;
    wantListeningRef.current = true;
    isStartingRef.current = true;

    const micPermission = await requestMicrophonePermission();
    if (!micPermission.granted) {
      isStartingRef.current = false;
      wantListeningRef.current = false;
      showMicrophonePermissionDeniedAlert(micPermission.canAskAgain);
      return;
    }
    if (!wantListeningRef.current) {
      isStartingRef.current = false;
      return;
    }

    const speechPermission =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!speechPermission.granted) {
      isStartingRef.current = false;
      wantListeningRef.current = false;
      return;
    }
    if (!wantListeningRef.current) {
      isStartingRef.current = false;
      return;
    }

    setInterimTranscript("");
    interimTextRef.current = "";
    doStart();
  }, [doStart]);

  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    isStartingRef.current = false;
    setIsListening(false);
    // Flush any pending interim transcript before aborting
    if (interimTextRef.current) {
      onTranscriptRef.current(interimTextRef.current);
      interimTextRef.current = "";
    }
    setInterimTranscript("");
    ExpoSpeechRecognitionModule.stop();
    ExpoSpeechRecognitionModule.abort();
  }, []);

  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  return { isListening, interimTranscript, startListening, stopListening };
}
