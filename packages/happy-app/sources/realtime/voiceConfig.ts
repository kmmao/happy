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
