import { useState, useRef, useCallback, useEffect } from "react";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { File, Paths } from "expo-file-system";

export interface UseTtsPlayerReturn {
  play(audioData: ArrayBuffer): Promise<void>;
  stop(): void;
  isPlaying: boolean;
}

/**
 * Native TTS audio player using expo-audio.
 * Writes MP3 data to a temp file and plays it via AudioPlayer.
 */
export function useTtsPlayer(): UseTtsPlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const tempFileRef = useRef<File | null>(null);

  // Track playback completion via status
  useEffect(() => {
    if (isPlaying && !status.playing) {
      setIsPlaying(false);
    }
  }, [status.playing, isPlaying]);

  const play = useCallback(
    async (audioData: ArrayBuffer) => {
      try {
        const bytes = new Uint8Array(audioData);

        // Write to temp file using new File API
        const tempFile = new File(Paths.cache, `tts_${Date.now()}.mp3`);
        tempFile.write(bytes);

        // Clean up previous temp file
        if (tempFileRef.current?.exists) {
          tempFileRef.current.delete();
        }
        tempFileRef.current = tempFile;

        // Replace source and play
        player.replace({ uri: tempFile.uri });
        setIsPlaying(true);
        player.play();
      } catch {
        setIsPlaying(false);
      }
    },
    [player],
  );

  const stop = useCallback(() => {
    player.pause();
    player.seekTo(0);
    setIsPlaying(false);
  }, [player]);

  return { play, stop, isPlaying };
}
