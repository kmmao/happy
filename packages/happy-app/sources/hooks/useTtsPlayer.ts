import { useState, useRef, useCallback, useEffect } from "react";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { File, Paths } from "expo-file-system";

export interface UseTtsPlayerReturn {
    play(audioData: ArrayBuffer): Promise<void>;
    stop(): void;
    isPlaying: boolean;
}

const PLAYBACK_TIMEOUT_MS = 120_000;

/**
 * Native TTS audio player using expo-audio.
 * Writes MP3 data to a temp file and plays it via AudioPlayer.
 *
 * play() returns a Promise that resolves when playback finishes or is stopped.
 */
export function useTtsPlayer(): UseTtsPlayerReturn {
    const [isPlaying, setIsPlaying] = useState(false);
    const player = useAudioPlayer(null);
    const status = useAudioPlayerStatus(player);
    const tempFileRef = useRef<File | null>(null);
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

    // Detect playback completion via status changes
    useEffect(() => {
        if (isPlaying && !status.playing) {
            setIsPlaying(false);
            resolveCurrentPlay();
        }
    }, [status.playing, isPlaying, resolveCurrentPlay]);

    const play = useCallback(
        (audioData: ArrayBuffer): Promise<void> => {
            // Resolve any pending play promise from a previous call
            resolveCurrentPlay();

            return new Promise<void>((resolve) => {
                try {
                    const bytes = new Uint8Array(audioData);

                    // Write to temp file using new File API
                    const tempFile = new File(
                        Paths.cache,
                        `tts_${Date.now()}.mp3`,
                    );
                    tempFile.write(bytes);

                    // Clean up previous temp file
                    if (tempFileRef.current?.exists) {
                        tempFileRef.current.delete();
                    }
                    tempFileRef.current = tempFile;

                    resolvePlayRef.current = resolve;

                    // Safety timeout to prevent Promise from hanging forever
                    timeoutRef.current = setTimeout(() => {
                        timeoutRef.current = null;
                        setIsPlaying(false);
                        resolveCurrentPlay();
                    }, PLAYBACK_TIMEOUT_MS);

                    // Replace source and play
                    player.replace({ uri: tempFile.uri });
                    setIsPlaying(true);
                    player.play();
                } catch {
                    setIsPlaying(false);
                    resolve();
                }
            });
        },
        [player, resolveCurrentPlay],
    );

    const stop = useCallback(() => {
        player.pause();
        player.seekTo(0);
        setIsPlaying(false);
        resolveCurrentPlay();
    }, [player, resolveCurrentPlay]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            resolveCurrentPlay();
        };
    }, [resolveCurrentPlay]);

    return { play, stop, isPlaying };
}
