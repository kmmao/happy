import { useState, useRef, useCallback, useEffect } from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { getServerUrl } from "@/sync/serverConfig";
import { showMicrophonePermissionDeniedAlert } from "@/utils/microphonePermissions";
import type { UseSpeechToTextReturn } from "./useSpeechToText";

/**
 * AudioWorklet processor: captures raw PCM audio from microphone.
 * Runs in a separate audio thread. Converts Float32 samples to Int16
 * and posts them back to the main thread via MessagePort.
 */
const WORKLET_CODE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0];
        if (input && input[0] && input[0].length > 0) {
            const float32 = input[0];
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
                const s = Math.max(-1, Math.min(1, float32[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            this.port.postMessage(int16.buffer, [int16.buffer]);
        }
        return true;
    }
}
registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
`;

/** Build WebSocket URL for STT streaming endpoint. */
function buildWsUrl(serverUrl: string, token: string, lang?: string): string {
  // https://example.com → wss://example.com
  // http://localhost:3005 → ws://localhost:3005
  const wsBase = serverUrl.replace(/^http/, "ws");
  const params = new URLSearchParams();
  params.set("token", token);
  if (lang) {
    params.set("lang", lang);
  }
  return `${wsBase}/v1/stt/stream?${params.toString()}`;
}

/**
 * Build a RealtimeSTT binary audio frame.
 * Protocol: [4-byte LE metadata_len][JSON metadata][PCM audio data]
 */
function buildAudioFrame(
  pcmBuffer: ArrayBuffer,
  sampleRate: number,
): ArrayBuffer {
  const meta = JSON.stringify({ sampleRate });
  const metaBytes = new TextEncoder().encode(meta);
  const frame = new ArrayBuffer(
    4 + metaBytes.byteLength + pcmBuffer.byteLength,
  );
  const view = new DataView(frame);
  // Little-endian (matches RealtimeSTT protocol)
  view.setUint32(0, metaBytes.byteLength, true);
  new Uint8Array(frame, 4, metaBytes.byteLength).set(metaBytes);
  new Uint8Array(frame, 4 + metaBytes.byteLength).set(
    new Uint8Array(pcmBuffer),
  );
  return frame;
}

/**
 * WebSocket-based STT using AudioWorklet + RealtimeSTT server.
 *
 * Captures raw PCM audio via AudioWorklet (no MediaRecorder),
 * streams it over WebSocket to the server, receives real-time
 * interim and final transcription results.
 *
 * Designed for mobile browsers where Web Speech API produces
 * system sounds and MediaRecorder + HTTP has high latency.
 */
export function useWebSocketStt(
  onTranscript: (text: string) => void,
  lang?: string,
): UseSpeechToTextReturn {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const langRef = useRef(lang);
  langRef.current = lang;

  // Resources
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletUrlRef = useRef<string | null>(null);

  // Control
  const wantListeningRef = useRef(false);
  const isPausedRef = useRef(false);
  const sampleRateRef = useRef(16000);

  const cleanupAll = useCallback(() => {
    wantListeningRef.current = false;

    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }

    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    if (workletUrlRef.current) {
      URL.revokeObjectURL(workletUrlRef.current);
      workletUrlRef.current = null;
    }

    setInterimTranscript("");
  }, []);

  /** Set up AudioContext + AudioWorklet → WebSocket pipeline */
  const setupAudioPipeline = useCallback(
    (stream: MediaStream, ws: WebSocket) => {
      const audioContext = new AudioContext({ sampleRate: 16000 });
      sampleRateRef.current = audioContext.sampleRate;
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // Silent gain node: keeps audio graph alive without playback
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0;
      gainNodeRef.current = gainNode;

      // Create worklet from inline Blob URL
      const blob = new Blob([WORKLET_CODE], {
        type: "application/javascript",
      });
      const workletUrl = URL.createObjectURL(blob);
      workletUrlRef.current = workletUrl;

      audioContext.audioWorklet
        .addModule(workletUrl)
        .then(() => {
          if (!wantListeningRef.current) return;

          const workletNode = new AudioWorkletNode(
            audioContext,
            "pcm-capture-processor",
          );
          workletNodeRef.current = workletNode;

          workletNode.port.onmessage = (event) => {
            if (
              !wantListeningRef.current ||
              isPausedRef.current ||
              ws.readyState !== WebSocket.OPEN
            ) {
              return;
            }
            const pcmBuffer = event.data as ArrayBuffer;
            const frame = buildAudioFrame(pcmBuffer, sampleRateRef.current);
            ws.send(frame);
          };

          // source → workletNode → gainNode(0) → destination
          // This keeps the worklet processing without audible output
          source.connect(workletNode);
          workletNode.connect(gainNode);
          gainNode.connect(audioContext.destination);
        })
        .catch(() => {
          // AudioWorklet not supported — fall back to ScriptProcessorNode
          setupScriptProcessorFallback(audioContext, source, gainNode, ws);
        });
    },
    [],
  );

  /** Fallback for browsers without AudioWorklet support */
  const setupScriptProcessorFallback = useCallback(
    (
      audioContext: AudioContext,
      source: MediaStreamAudioSourceNode,
      gainNode: GainNode,
      ws: WebSocket,
    ) => {
      // ScriptProcessorNode is deprecated but has wider support
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;
      processor.onaudioprocess = (event) => {
        if (
          !wantListeningRef.current ||
          isPausedRef.current ||
          ws.readyState !== WebSocket.OPEN
        ) {
          return;
        }
        const float32 = event.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const frame = buildAudioFrame(int16.buffer, sampleRateRef.current);
        ws.send(frame);
      };

      source.connect(processor);
      processor.connect(gainNode);
      gainNode.connect(audioContext.destination);
    },
    [],
  );

  const startListening = useCallback(async () => {
    if (wantListeningRef.current) return;
    wantListeningRef.current = true;

    // 1. Get microphone
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 16000 },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (error: unknown) {
      wantListeningRef.current = false;
      const name = error instanceof Error ? error.name : "";
      const isPermanentDenial =
        name === "NotAllowedError" || name === "PermissionDeniedError";
      showMicrophonePermissionDeniedAlert(!isPermanentDenial);
      return;
    }

    if (!wantListeningRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    mediaStreamRef.current = stream;

    // 2. Get auth token
    const credentials = await TokenStorage.getCredentials();
    if (!credentials || !wantListeningRef.current) {
      cleanupAll();
      return;
    }

    // 3. Connect WebSocket
    const serverUrl = getServerUrl();
    const wsUrl = buildWsUrl(serverUrl, credentials.token, langRef.current);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (!wantListeningRef.current) {
        ws.close();
        return;
      }
      // Wait for "ready" or "connected" message before starting audio
    };

    ws.onmessage = (event) => {
      if (!wantListeningRef.current) return;
      try {
        const msg = JSON.parse(event.data as string);
        if (
          (msg.type === "ready" || msg.type === "connected") &&
          !audioContextRef.current
        ) {
          // Server confirmed connection — start audio pipeline
          setupAudioPipeline(stream, ws);
          setIsListening(true);
          setInterimTranscript("");
        } else if (msg.type === "realtime" && msg.text) {
          if (!isPausedRef.current) {
            setInterimTranscript(msg.text);
          }
        } else if (msg.type === "fullSentence") {
          setInterimTranscript("");
          if (msg.text && !isPausedRef.current) {
            onTranscriptRef.current(msg.text);
          }
        }
        // "error" type — silently ignore, don't crash
      } catch {
        // Ignore malformed JSON
      }
    };

    ws.onerror = () => {
      if (wantListeningRef.current) {
        setIsListening(false);
        cleanupAll();
      }
    };

    ws.onclose = () => {
      if (wantListeningRef.current) {
        setIsListening(false);
        cleanupAll();
      }
    };
  }, [cleanupAll, setupAudioPipeline]);

  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    isPausedRef.current = false;
    setIsListening(false);
    cleanupAll();
  }, [cleanupAll]);

  const pauseListening = useCallback(() => {
    if (!wantListeningRef.current || isPausedRef.current) return;
    isPausedRef.current = true;
    setInterimTranscript("");
    // Don't close WebSocket — just stop sending audio frames
    // (filtered in workletNode.port.onmessage)
  }, []);

  const resumeListening = useCallback(() => {
    if (!isPausedRef.current) return;
    isPausedRef.current = false;
    setInterimTranscript("");
  }, []);

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
