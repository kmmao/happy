import { useBrowserSpeechRecognition } from "./useBrowserSpeechRecognition";

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

const noopAsync = async () => {};
const noop = () => {};

/** Disabled STT fallback for browsers without Web Speech API (e.g. Firefox). */
const disabledStt: UseSpeechToTextReturn = {
  isListening: false,
  interimTranscript: "",
  startListening: noopAsync,
  stopListening: noop,
  pauseListening: noop,
  resumeListening: noop,
};

/**
 * Web speech-to-text using browser-native Web Speech API.
 *
 * Supported in Chrome, Edge, Safari (desktop & mobile).
 * Firefox and other unsupported browsers get a disabled no-op fallback.
 */
export function useSpeechToText(
  onTranscript: (text: string) => void,
  lang?: string,
): UseSpeechToTextReturn {
  const result = useBrowserSpeechRecognition(onTranscript, lang);
  return result ?? disabledStt;
}
