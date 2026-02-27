import { AuthCredentials } from "@/auth/tokenStorage";
import { getServerUrl } from "./serverConfig";

export interface TtsSynthesizeRequest {
  text: string;
  voice?: string;
  rate?: string;
}

export interface ElevenLabsTtsRequest {
  text: string;
  apiKey: string;
  voiceId?: string;
  languageCode?: string;
}

const ELEVENLABS_DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const ELEVENLABS_VOICE_ID_RE = /^[a-zA-Z0-9]{10,30}$/;

export class ElevenLabsAuthError extends Error {
  constructor() {
    super("ElevenLabs API key is invalid or expired");
  }
}

/**
 * Synthesize speech via Edge TTS (free, through server proxy).
 */
export async function synthesizeSpeechEdge(
  credentials: AuthCredentials,
  request: TtsSynthesizeRequest,
): Promise<ArrayBuffer | null> {
  const serverUrl = getServerUrl();

  try {
    const response = await fetch(`${serverUrl}/v1/tts/synthesize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      return null;
    }

    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Synthesize speech via ElevenLabs API (paid, direct from client with user's own API key).
 * @throws {ElevenLabsAuthError} when API key is invalid (401/403)
 */
export async function synthesizeSpeechElevenLabs(
  request: ElevenLabsTtsRequest,
): Promise<ArrayBuffer | null> {
  const voiceId = request.voiceId || ELEVENLABS_DEFAULT_VOICE_ID;

  if (!ELEVENLABS_VOICE_ID_RE.test(voiceId)) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": request.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: request.text,
          model_id: "eleven_multilingual_v2",
          language_code: request.languageCode,
        }),
        signal: controller.signal,
      },
    );

    if (response.status === 401 || response.status === 403) {
      throw new ElevenLabsAuthError();
    }

    if (!response.ok) {
      return null;
    }

    return await response.arrayBuffer();
  } catch (error) {
    if (error instanceof ElevenLabsAuthError) throw error;
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Backward-compatible alias: synthesize speech using Edge TTS.
 */
export const synthesizeSpeech = synthesizeSpeechEdge;
