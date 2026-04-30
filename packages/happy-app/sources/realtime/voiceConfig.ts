/**
 * Default Voicebox local TTS service endpoint
 * Voicebox REST API runs on port 17493 by default
 */
export const VOICEBOX_DEFAULT_ENDPOINT = 'http://localhost:17493';

export type VoiceBackend = 'elevenlabs' | 'livekit';

export interface VoiceBackendInfo {
    id: VoiceBackend;
    label: string;
    description: string;
}

export const VOICE_BACKEND_LIST: readonly VoiceBackendInfo[] = [
    {
        id: 'elevenlabs',
        label: 'ElevenLabs',
        description: 'Premium conversational AI — current default',
    },
    {
        id: 'livekit',
        label: 'LiveKit',
        description: 'Open-source realtime voice AI — 1000 free min/month',
    },
] as const;

/**
 * All supported TTS provider identifiers.
 * Mirrors the `ttsProvider` enum in settings.ts.
 */
export type TtsProvider = 'edge' | 'elevenlabs' | 'voicebox' | 'browser-web-speech';

/**
 * Metadata for each TTS provider, used by the provider selector UI.
 */
export interface TtsProviderInfo {
    /** Provider identifier matching the settings enum value */
    id: TtsProvider;
    /** Short display label */
    label: string;
    /** One-line description shown below the label */
    description: string;
    /** Whether this provider requires additional user configuration */
    requiresConfig: boolean;
}

/**
 * Ordered list of TTS providers.
 * Free / zero-config options are listed first to lower the barrier for new users.
 */
export const TTS_PROVIDER_LIST: readonly TtsProviderInfo[] = [
    {
        id: 'browser-web-speech',
        label: 'Web Speech API',
        description: 'Zero-cost browser-native TTS — no account required',
        requiresConfig: false,
    },
    {
        id: 'edge',
        label: 'Microsoft Edge TTS',
        description: 'Free high-quality cloud TTS via Microsoft',
        requiresConfig: false,
    },
    {
        id: 'voicebox',
        label: 'Voicebox (Local)',
        description: 'High-quality local TTS — requires Voicebox running on your machine',
        requiresConfig: true,
    },
    {
        id: 'elevenlabs',
        label: 'ElevenLabs',
        description: 'Premium AI voice — requires your own API key',
        requiresConfig: true,
    },
] as const;

/**
 * Static voice context configuration
 */
export const VOICE_CONFIG = {
    /** Disable all tool call information from being sent to voice context */
    DISABLE_TOOL_CALLS: false,

    /** Send only tool names and descriptions, exclude arguments */
    LIMITED_TOOL_CALLS: true,

    /** Disable permission request forwarding */
    DISABLE_PERMISSION_REQUESTS: false,

    /** Disable session online/offline notifications */
    DISABLE_SESSION_STATUS: true,

    /** Disable message forwarding */
    DISABLE_MESSAGES: false,

    /** Disable session focus notifications */
    DISABLE_SESSION_FOCUS: false,

    /** Disable ready event notifications */
    DISABLE_READY_EVENTS: false,

    /** Maximum number of messages to include in session history */
    MAX_HISTORY_MESSAGES: 50,

    /** Enable debug logging for voice context updates */
    ENABLE_DEBUG_LOGGING: false,
} as const;
