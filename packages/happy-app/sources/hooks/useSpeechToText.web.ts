import { useState, useRef, useCallback, useEffect } from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { transcribeSttAudio } from "@/sync/apiStt";
import { showMicrophonePermissionDeniedAlert } from "@/utils/microphonePermissions";

function mimeTypeToFileName(mimeType: string): string {
  if (mimeType.includes("ogg")) return "speech.ogg";
  if (mimeType.includes("mp4") || mimeType.includes("aac")) return "speech.mp4";
  return "speech.webm";
}

export interface UseSpeechToTextReturn {
  isListening: boolean;
  /** The latest unfinalized speech text — updates in real-time as the user speaks. */
  interimTranscript: string;
  startListening: () => Promise<void>;
  stopListening: () => void;
}

/**
 * Web speech-to-text via Happy server API (`/v1/stt/transcribe`).
 *
 * Uses MediaRecorder with 3-second timeslice to provide real-time interim
 * transcription while the user is still speaking. Final accurate transcription
 * is sent when recording stops.
 */
export function useSpeechToText(
  onTranscript: (text: string) => void,
  lang?: string,
): UseSpeechToTextReturn {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const langRef = useRef(lang);
  langRef.current = lang;

  // Flags for real-time interim transcription
  const isStoppedRef = useRef(false);
  const interimCounterRef = useRef(0);

  const cleanupMedia = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      mediaRecorderRef.current = null;
    }

    const stream = mediaStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    chunksRef.current = [];
    setInterimTranscript("");
  }, []);

  const blobToBase64 = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new Error("Failed to encode audio blob"));
          return;
        }
        const base64 = result.split(",")[1];
        if (!base64) {
          reject(new Error("Invalid base64 data"));
          return;
        }
        resolve(base64);
      };
      reader.onerror = () =>
        reject(reader.error ?? new Error("FileReader error"));
      reader.readAsDataURL(blob);
    });
  }, []);

  const startListening = useCallback(async () => {
    if (isListening || mediaRecorderRef.current) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : "";
      const isPermanentDenial =
        name === "NotAllowedError" || name === "PermissionDeniedError";
      showMicrophonePermissionDeniedAlert(!isPermanentDenial);
      return;
    }

    try {
      mediaStreamRef.current = stream;

      // Detect best supported format — Safari/iOS uses mp4, Chrome/Firefox use webm
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

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      isStoppedRef.current = false;
      interimCounterRef.current = 0;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }

        // Fire interim transcription on timeslice events (not on the final stop event)
        if (!isStoppedRef.current && chunksRef.current.length > 0) {
          const myCounter = ++interimCounterRef.current;
          const chunks = [...chunksRef.current];
          const blobType = recorder.mimeType || mimeType;

          // Non-blocking interim transcription
          (async () => {
            try {
              const blob = new Blob(chunks, { type: blobType });
              if (blob.size < 500) return; // skip tiny blobs

              const credentials = await TokenStorage.getCredentials();
              if (!credentials) return;

              const audioBase64 = await blobToBase64(blob);
              const result = await transcribeSttAudio(credentials, {
                audioBase64,
                fileName: mimeTypeToFileName(blobType),
                mimeType: blobType,
                lang: langRef.current,
                polish: false,
              });

              // Only update if this is still the latest interim result
              if (myCounter === interimCounterRef.current && result?.text) {
                setInterimTranscript(result.text);
              }
            } catch {
              // ignore interim transcription failures
            }
          })();
        }
      };

      recorder.onerror = () => {
        setIsListening(false);
        cleanupMedia();
      };

      recorder.onstop = async () => {
        const currentChunks = [...chunksRef.current];
        const currentType = recorder.mimeType || mimeType;
        setIsListening(false);
        // Don't clear interimTranscript here — cleanupMedia() in the finally
        // block will do it after onTranscript(), so React 18 batches both
        // updates into one render: message appears, interim disappears together.

        try {
          if (currentChunks.length === 0) return;
          const blob = new Blob(currentChunks, { type: currentType });
          if (blob.size === 0) return;

          const credentials = await TokenStorage.getCredentials();
          if (!credentials) return;

          const audioBase64 = await blobToBase64(blob);
          const result = await transcribeSttAudio(credentials, {
            audioBase64,
            fileName: mimeTypeToFileName(currentType),
            mimeType: currentType,
            lang: langRef.current,
            polish: false,
          });

          if (result?.text) {
            onTranscriptRef.current(result.text.trim());
          }
        } catch {
          // ignore transcription failures; keep UX non-blocking
        } finally {
          cleanupMedia();
        }
      };

      mediaRecorderRef.current = recorder;
      setIsListening(true);
      setInterimTranscript("");
      // 3-second timeslice for real-time interim transcription
      recorder.start(3000);
    } catch {
      setIsListening(false);
      cleanupMedia();
    }
  }, [blobToBase64, cleanupMedia, isListening]);

  const stopListening = useCallback(() => {
    // Mark stopped BEFORE calling recorder.stop() so the final ondataavailable
    // event is NOT treated as a timeslice interim event
    isStoppedRef.current = true;

    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      setIsListening(false);
      cleanupMedia();
      return;
    }

    if (recorder.state !== "inactive") {
      recorder.stop();
    } else {
      setIsListening(false);
      cleanupMedia();
    }
  }, [cleanupMedia]);

  useEffect(() => {
    return () => {
      isStoppedRef.current = true;
      setIsListening(false);
      cleanupMedia();
    };
  }, [cleanupMedia]);

  return { isListening, interimTranscript, startListening, stopListening };
}
