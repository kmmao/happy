import { useState, useRef, useCallback, useEffect } from "react";
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
 * Web implementation of speech-to-text using the Web Speech API.
 * Uses SpeechRecognition / webkitSpeechRecognition (browser native).
 *
 * Uses `continuous = true` for uninterrupted recognition quality.
 * Stopping uses `.abort()` (not `.stop()`) which is reliable in Chrome.
 * Because `abort()` discards pending (non-final) results, we track the
 * latest interim transcript and flush it on stop so no speech is lost.
 *
 * `interimTranscript` is exposed as state for real-time display —
 * the consumer can show `message + interimTranscript` in the input field
 * so the user sees their words as they speak.
 *
 * @param onTranscript - Called with finalized transcript text.
 * @param lang - BCP-47 language tag (e.g. "en-US", "zh-CN"). Defaults to browser locale.
 */
export function useSpeechToText(
  onTranscript: (text: string) => void,
  lang?: string,
): UseSpeechToTextReturn {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  // Tracks user intent — true means "keep listening across utterances".
  const wantListeningRef = useRef(false);
  const langRef = useRef(lang);
  langRef.current = lang;
  // Mirror of interimTranscript state for synchronous access in stopListening.
  const interimTextRef = useRef("");

  /** Create a fresh SpeechRecognition instance and start it. */
  const doStart = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    const SpeechRecognitionClass =
      win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) return;

    // Kill any lingering session
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = langRef.current ?? navigator.language ?? "en-US";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let latestInterim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0]?.transcript?.trim();
          if (text) {
            onTranscriptRef.current(text);
          }
          latestInterim = ""; // Final result consumed — clear interim
        } else {
          const text = result[0]?.transcript?.trim();
          if (text) {
            latestInterim = text;
          }
        }
      }
      interimTextRef.current = latestInterim;
      setInterimTranscript(latestInterim);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      // "aborted" is expected when we call abort(); "no-speech" is silence timeout
      if (event.error === "aborted" || event.error === "no-speech") {
        // Not a real error — onend will fire next and handle restart/stop
        return;
      }
      // "not-allowed" means mic permission was denied by the user/browser
      if (event.error === "not-allowed") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = window as any;
        win.alert?.(
          "Microphone access is required for speech input. " +
            "Please allow microphone access in your browser settings.",
        );
      }
      wantListeningRef.current = false;
      setIsListening(false);
      setInterimTranscript("");
      interimTextRef.current = "";
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (wantListeningRef.current) {
        // Unexpected end (Chrome timeout / network disconnect) — restart
        doStart();
      } else {
        setIsListening(false);
        setInterimTranscript("");
        interimTextRef.current = "";
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // start() can throw on mobile browsers if mic is unavailable
      wantListeningRef.current = false;
      setIsListening(false);
      setInterimTranscript("");
      interimTextRef.current = "";
      recognitionRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
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

  const startListening = useCallback(async () => {
    if (wantListeningRef.current) return; // Already listening

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    const SpeechRecognitionClass =
      win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) return;

    // Request microphone permission (getUserMedia triggers browser prompt)
    const permission = await requestMicrophonePermission();
    if (!permission.granted) {
      showMicrophonePermissionDeniedAlert(permission.canAskAgain);
      return;
    }

    // Brief pause so mobile hardware fully releases the mic after getUserMedia.
    // Without this, SpeechRecognition.start() may get no audio on mobile Chrome.
    await new Promise((resolve) => setTimeout(resolve, 120));

    if (!wantListeningRef.current) {
      // Stop may have been called while we awaited permission / delay
      wantListeningRef.current = true;
    }

    wantListeningRef.current = true;
    setIsListening(true);
    setInterimTranscript("");
    interimTextRef.current = "";
    doStart();
  }, [doStart]);

  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    setIsListening(false);
    // Flush any pending interim transcript before aborting — abort()
    // discards unfinalized results, so we capture them synchronously here.
    if (interimTextRef.current) {
      onTranscriptRef.current(interimTextRef.current);
      interimTextRef.current = "";
    }
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

  return { isListening, interimTranscript, startListening, stopListening };
}
