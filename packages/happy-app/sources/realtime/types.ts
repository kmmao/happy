export interface VoiceSessionConfig {
    sessionId: string;
}

export interface VoiceSession {
    startSession(config: VoiceSessionConfig): Promise<void>;
    endSession(): Promise<void>;
}

export type ConversationStatus = 'disconnected' | 'connecting' | 'connected';
export type ConversationMode = 'speaking' | 'listening';
