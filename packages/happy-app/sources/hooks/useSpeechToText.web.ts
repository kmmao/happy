import { useState, useRef, useCallback, useEffect } from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { transcribeSttAudio } from "@/sync/apiStt";
import { showMicrophonePermissionDeniedAlert } from "@/utils/microphonePermissions";
import {
  isBrowserSpeechRecognitionSupported,
  useBrowserSpeechRecognition,
} from "./useBrowserSpeechRecognition";

function mimeTypeToFileName(mimeType: string): string {
  if (mimeType.includes("ogg")) return "speech.ogg";
  if (mimeType.includes("mp4") || mimeType.includes("aac")) return "speech.mp4";
  return "speech.webm";
}

/** Average byte frequency level (0–255) below which audio is silence. */
const SILENCE_THRESHOLD = 15;
/** Milliseconds of silence after speech before ending an utterance.
 * 1200ms balances responsiveness (vs 2000ms original) and false trigger avoidance. */
const SPEECH_END_DELAY_MS = 1200;
/** How often to sample volume levels (ms). */
const VAD_POLL_INTERVAL_MS = 100;
/** Minimum blob size (bytes) worth sending to STT. */
const MIN_BLOB_SIZE = 500;

export interface UseSpeechToTextReturn {
  isListening: boolean;
  /** The latest unfinalized speech text — updates in real-time as the user speaks. */
  interimTranscript: string;
  startListening: () => Promise<void>;
  stopListening: () => void;
  /** Temporarily pause recognition (for echo suppression during TTS playback). */
  pauseListening: () => void;
  /** Resume recognition after a pause (re-enters listening without re-requesting permissions). */
  resumeListening: () => void;
}

/**
 * Web speech-to-text with automatic utterance detection (VAD).
 *
 * Records audio via MediaRecorder. Uses Web Audio API AnalyserNode to monitor
 * volume levels and automatically detect when the user finishes speaking.
 * On silence after speech, stops the recorder (triggering final transcription
 * via the server STT API), sends the result, and immediately starts a new
 * recording segment — mirroring the native `continuous: false` behavior.
 */
/**
 * Prefer browser-native SpeechRecognition (Chrome/Edge/Safari) for zero-latency
 * real-time results. Falls back to server-side MediaRecorder + Whisper for Firefox
 * and other unsupported browsers.
 */
export function useSpeechToText(
  onTranscript: (text: string) => void,
  lang?: string,
): UseSpeechToTextReturn {
  const useBrowser = isBrowserSpeechRecognitionSupported();
  const browserResult = useBrowserSpeechRecognition(onTranscript, lang);
  const serverResult = useServerSpeechToText(onTranscript, lang);

  if (useBrowser && browserResult) {
    return browserResult;
  }
  return serverResult;
}

/**
 * Server-side STT using MediaRecorder + VAD + server Whisper API.
 * Used as fallback when browser-native SpeechRecognition is not available.
 */
function useServerSpeechToText(
  onTranscript: (text: string) => void,
  lang?: string,
): UseSpeechToTextReturn {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const langRef = useRef(lang);
  langRef.current = lang;

  // Media resources (shared across utterance segments)
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeTypeRef = useRef("");

  // Control flags
  const wantListeningRef = useRef(false);
  const isPausedRef = useRef(false);
  const isPauseStopRef = useRef(false);
  const isUtteranceEndRef = useRef(false);
  const interimCounterRef = useRef(0);
  // Mirror of interimTranscript for synchronous access in VAD/onstop callbacks
  const interimTextRef = useRef("");

  // VAD state
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const speechDetectedRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ref for the startSegment function (allows onstop to restart without circular deps)
  const startSegmentRef = useRef<() => void>(() => {});

  const cancelVad = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
  }, []);

  const cleanupAll = useCallback(() => {
    wantListeningRef.current = false;
    interimCounterRef.current++;
    cancelVad();

    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      mediaRecorderRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
      analyserRef.current = null;
    }

    const stream = mediaStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    chunksRef.current = [];
    speechDetectedRef.current = false;
    interimTextRef.current = "";
    setInterimTranscript("");
  }, [cancelVad]);

  // Start VAD polling (uses setInterval so it keeps running when tab loses focus)
  const startVad = useCallback(() => {
    cancelVad();
    speechDetectedRef.current = false;

    vadIntervalRef.current = setInterval(() => {
      const analyser = analyserRef.current;
      if (!analyser || !wantListeningRef.current) return;

      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;

      if (avg > SILENCE_THRESHOLD) {
        speechDetectedRef.current = true;
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      } else if (speechDetectedRef.current && !silenceTimerRef.current) {
        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;
          if (!wantListeningRef.current) return;

          // Utterance ended — stop recorder to trigger transcription + restart
          isUtteranceEndRef.current = true;
          speechDetectedRef.current = false;
          const rec = mediaRecorderRef.current;
          if (rec && rec.state !== "inactive") {
            rec.stop();
          }
        }, SPEECH_END_DELAY_MS);
      }
    }, VAD_POLL_INTERVAL_MS);
  }, [cancelVad]);

  // Reset VAD state when tab returns from background to prevent false silence detection
  // (AudioContext is throttled by browsers when tab is hidden, producing zero-level data)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && wantListeningRef.current) {
        speechDetectedRef.current = false;
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Start a new MediaRecorder segment (reuses existing stream)
  const startSegment = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream || !wantListeningRef.current) return;

    const mimeType = mimeTypeRef.current;
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    chunksRef.current = [];
    isUtteranceEndRef.current = false;
    interimTextRef.current = "";
    interimCounterRef.current++;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }

      // Fire interim transcription on timeslice events (skip utterance-end flush)
      if (
        !isUtteranceEndRef.current &&
        wantListeningRef.current &&
        chunksRef.current.length > 0
      ) {
        const myCounter = ++interimCounterRef.current;
        const chunks = [...chunksRef.current];
        const blobType = recorder.mimeType || mimeType;

        (async () => {
          try {
            const blob = new Blob(chunks, { type: blobType });
            if (blob.size < MIN_BLOB_SIZE) return;

            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            const result = await transcribeSttAudio(credentials, {
              audioBlob: blob,
              fileName: mimeTypeToFileName(blobType),
              mimeType: blobType,
              lang: langRef.current,
            });

            if (myCounter === interimCounterRef.current && result?.text) {
              interimTextRef.current = result.text;
              setInterimTranscript(result.text);
            }
          } catch {
            // ignore interim failures
          }
        })();
      }
    };

    recorder.onerror = () => {
      setIsListening(false);
      cleanupAll();
    };

    recorder.onstop = async () => {
      // Pause-triggered stop: discard audio, don't transcribe, don't restart
      if (isPauseStopRef.current) {
        isPauseStopRef.current = false;
        chunksRef.current = [];
        interimTextRef.current = "";
        interimCounterRef.current++;
        setInterimTranscript("");
        return;
      }

      const savedChunks = [...chunksRef.current];
      const savedType = recorder.mimeType || mimeType;
      const wasUtteranceEnd = isUtteranceEndRef.current;
      const cachedInterim = interimTextRef.current;
      chunksRef.current = [];
      interimTextRef.current = "";
      interimCounterRef.current++;

      // Only restart if this was a VAD-triggered stop (not user-initiated)
      if (wantListeningRef.current && wasUtteranceEnd) {
        startSegmentRef.current();
      }

      // If VAD-triggered and we have a cached interim transcript, use it directly
      // to skip the final STT round-trip (saves 1-3s latency).
      if (wasUtteranceEnd && cachedInterim) {
        onTranscriptRef.current(cachedInterim.trim());
      } else {
        // No interim available (speech < 3s) or user-initiated stop — do full transcription
        try {
          if (savedChunks.length > 0) {
            const blob = new Blob(savedChunks, { type: savedType });
            if (blob.size >= MIN_BLOB_SIZE) {
              const credentials = await TokenStorage.getCredentials();
              if (credentials) {
                const result = await transcribeSttAudio(credentials, {
                  audioBlob: blob,
                  fileName: mimeTypeToFileName(savedType),
                  mimeType: savedType,
                  lang: langRef.current,
                });
                if (result?.text) {
                  onTranscriptRef.current(result.text.trim());
                }
              }
            }
          }
        } catch {
          // ignore transcription failures
        }
      }

      setInterimTranscript("");

      // Clean up if user stopped (either before or during transcription)
      if (!wantListeningRef.current) {
        setIsListening(false);
        cleanupAll();
      }
    };

    mediaRecorderRef.current = recorder;
    recorder.start(3000); // 3-second timeslice for interim transcription
  }, [cleanupAll]);

  // Keep the ref updated so onstop can always call the latest version
  startSegmentRef.current = startSegment;

  const startListening = useCallback(async () => {
    if (isListening || wantListeningRef.current) return;
    // Lock immediately before async getUserMedia to prevent double-start
    wantListeningRef.current = true;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error: unknown) {
      wantListeningRef.current = false;
      const name = error instanceof Error ? error.name : "";
      const isPermanentDenial =
        name === "NotAllowedError" || name === "PermissionDeniedError";
      showMicrophonePermissionDeniedAlert(!isPermanentDenial);
      return;
    }

    // Guard: user may have called stopListening during the getUserMedia await
    if (!wantListeningRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    try {
      mediaStreamRef.current = stream;

      // Detect best supported format
      let mimeType = "";
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
        "audio/aac",
      ];
      if (typeof MediaRecorder !== "undefined") {
        for (const candidate of candidates) {
          if (MediaRecorder.isTypeSupported(candidate)) {
            mimeType = candidate;
            break;
          }
        }
      }
      mimeTypeRef.current = mimeType;

      // Set up Web Audio API for VAD
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      setIsListening(true);
      setInterimTranscript("");

      // Start first recording segment + VAD monitoring
      startSegmentRef.current();
      startVad();
    } catch {
      wantListeningRef.current = false;
      setIsListening(false);
      cleanupAll();
    }
  }, [cleanupAll, isListening, startVad]);

  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    isPausedRef.current = false;
    cancelVad();

    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      setIsListening(false);
      cleanupAll();
      return;
    }

    if (recorder.state !== "inactive") {
      // Stop triggers onstop → final transcription → cleanup
      recorder.stop();
    } else {
      setIsListening(false);
      cleanupAll();
    }
  }, [cancelVad, cleanupAll]);

  const pauseListening = useCallback(() => {
    if (!wantListeningRef.current || isPausedRef.current) return;
    isPausedRef.current = true;
    cancelVad();
    setInterimTranscript("");
    interimTextRef.current = "";

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      isPauseStopRef.current = true;
      recorder.stop();
    }
  }, [cancelVad]);

  const resumeListening = useCallback(() => {
    if (!isPausedRef.current) return;
    isPausedRef.current = false;
    if (wantListeningRef.current && mediaStreamRef.current) {
      setInterimTranscript("");
      interimTextRef.current = "";
      startSegmentRef.current();
      startVad();
    }
  }, [startVad]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      isPausedRef.current = false;
      cleanupAll();
    };
  }, [cleanupAll]);

  return {
    isListening,
    interimTranscript,
    startListening,
    stopListening,
    pauseListening,
    resumeListening,
  };
}
