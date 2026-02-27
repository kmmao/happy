import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseTtsPlayerReturn {
    play(audioData: ArrayBuffer): Promise<void>;
    stop(): void;
    isPlaying: boolean;
}

/**
 * Web TTS audio player using HTML5 Audio element.
 * Creates a blob URL from MP3 data and plays it.
 */
export function useTtsPlayer(): UseTtsPlayerReturn {
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const blobUrlRef = useRef<string | null>(null);

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

    const play = useCallback(async (audioData: ArrayBuffer) => {
        cleanup();

        try {
            const blob = new Blob([audioData], { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);
            blobUrlRef.current = url;

            const audio = new Audio(url);
            audioRef.current = audio;

            audio.onended = () => {
                setIsPlaying(false);
                cleanup();
            };

            audio.onerror = () => {
                setIsPlaying(false);
                cleanup();
            };

            setIsPlaying(true);
            await audio.play();
        } catch {
            setIsPlaying(false);
            cleanup();
        }
    }, [cleanup]);

    const stop = useCallback(() => {
        cleanup();
        setIsPlaying(false);
    }, [cleanup]);

    // Cleanup on unmount
    useEffect(() => {
        return cleanup;
    }, [cleanup]);

    return { play, stop, isPlaying };
}
