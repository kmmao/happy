import { useState, useRef, useCallback, useEffect } from "react";
import type { UseSpeechToTextReturn } from "./useSpeechToText";

/**
 * Check if the browser supports the Web Speech API (SpeechRecognition).
 * Works in Chrome, Edge, Safari — not Firefox.
 */
export function isBrowserSpeechRecognitionSupported(): boolean {
    if (typeof window === "undefined") return false;
    return !!(
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition
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
 * Limitations:
 * - Not all browsers (Firefox: no)
 * - Chrome sends audio to Google servers for processing
 * - Language support varies by browser
 *
 * Mirrors the same interface as useSpeechToText for drop-in replacement.
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

        const recognition = new SpeechRecognitionCtor();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = langRef.current ?? navigator.language ?? "en-US";

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            if (!wantListeningRef.current) return;

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
            if (wantListeningRef.current && !isPausedRef.current) {
                // Create new instance via ref (avoids Safari InvalidStateError
                // from reusing same instance whose state machine hasn't reset)
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
            setIsListening(false);
            setInterimTranscript("");
        };

        recognitionRef.current = recognition;

        try {
            recognition.start();
        } catch {
            wantListeningRef.current = false;
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
            recognitionRef.current.abort();
            recognitionRef.current = null;
        }
    }, []);

    const pauseListening = useCallback(() => {
        if (!wantListeningRef.current || isPausedRef.current) return;
        isPausedRef.current = true;
        setInterimTranscript("");

        if (recognitionRef.current) {
            recognitionRef.current.abort();
            recognitionRef.current = null;
        }
    }, []);

    const resumeListening = useCallback(() => {
        if (!isPausedRef.current) return;
        isPausedRef.current = false;
        if (!wantListeningRef.current) return;

        setInterimTranscript("");
        createAndStart();
    }, [createAndStart]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            wantListeningRef.current = false;
            isPausedRef.current = false;
            if (recognitionRef.current) {
                recognitionRef.current.abort();
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
