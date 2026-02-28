import { useState, useRef, useCallback, useEffect } from "react";

export interface UseTtsPlayerReturn {
    play(audioData: ArrayBuffer): Promise<void>;
    stop(): void;
    isPlaying: boolean;
}

const PLAYBACK_TIMEOUT_MS = 120_000;

/**
 * Web TTS audio player using HTML5 Audio element.
 * Creates a blob URL from MP3 data and plays it.
 *
 * play() returns a Promise that resolves when playback finishes or is stopped.
 */
export function useTtsPlayer(): UseTtsPlayerReturn {
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const blobUrlRef = useRef<string | null>(null);
    const resolvePlayRef = useRef<(() => void) | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const resolveCurrentPlay = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        if (resolvePlayRef.current) {
            resolvePlayRef.current();
            resolvePlayRef.current = null;
        }
    }, []);

    const cleanup = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.onended = null;
            audioRef.current.onerror = null;
            audioRef.current = null;
        }
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }
    }, []);

    const play = useCallback(
        (audioData: ArrayBuffer): Promise<void> => {
            // Resolve any pending play promise from a previous call
            resolveCurrentPlay();
            cleanup();

            return new Promise<void>((resolve) => {
                try {
                    const blob = new Blob([audioData], { type: "audio/mpeg" });
                    const url = URL.createObjectURL(blob);
                    blobUrlRef.current = url;

                    const audio = new Audio(url);
                    audioRef.current = audio;
                    resolvePlayRef.current = resolve;

                    // Safety timeout
                    timeoutRef.current = setTimeout(() => {
                        timeoutRef.current = null;
                        setIsPlaying(false);
                        cleanup();
                        resolveCurrentPlay();
                    }, PLAYBACK_TIMEOUT_MS);

                    audio.onended = () => {
                        setIsPlaying(false);
                        cleanup();
                        resolveCurrentPlay();
                    };

                    audio.onerror = () => {
                        setIsPlaying(false);
                        cleanup();
                        resolveCurrentPlay();
                    };

                    setIsPlaying(true);
                    audio.play().catch(() => {
                        setIsPlaying(false);
                        cleanup();
                        resolveCurrentPlay();
                    });
                } catch {
                    setIsPlaying(false);
                    cleanup();
                    resolve();
                }
            });
        },
        [cleanup, resolveCurrentPlay],
    );

    const stop = useCallback(() => {
        cleanup();
        setIsPlaying(false);
        resolveCurrentPlay();
    }, [cleanup, resolveCurrentPlay]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cleanup();
            resolveCurrentPlay();
        };
    }, [cleanup, resolveCurrentPlay]);

    return { play, stop, isPlaying };
}
