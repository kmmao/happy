import React, { useEffect, useRef } from 'react';
import { useConversation } from '@elevenlabs/react';
import { registerVoiceSession } from './RealtimeSession';
import { storage } from '@/sync/storage';
import { realtimeClientTools } from './realtimeClientTools';
import { getElevenLabsCodeFromPreference } from '@/constants/Languages';
import type { VoiceSession, VoiceSessionConfig } from './types';

// Static reference to the conversation hook instance
let conversationRef: ReturnType<typeof useConversation> | null = null;

// Global voice session implementation
class RealtimeVoiceSessionImpl implements VoiceSession {

    async startSession(config: VoiceSessionConfig): Promise<void> {
        if (!conversationRef) {
            console.warn('Realtime voice session not initialized');
            return;
        }

        try {
            storage.getState().setRealtimeStatus('connecting');

            // Request microphone permission first (web)
            try {
                await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (error) {
                console.error('Failed to get microphone permission:', error);
                storage.getState().setRealtimeStatus('error');
                return;
            }

            const userLanguagePreference = storage.getState().settings.voiceAssistantLanguage;
            const elevenLabsLanguage = getElevenLabsCodeFromPreference(userLanguagePreference);

            if (!config.token && !config.agentId) {
                throw new Error('Neither token nor agentId provided');
            }

            conversationRef.startSession({
                clientTools: realtimeClientTools,
                connectionType: 'webrtc',
                dynamicVariables: {
                    sessionId: config.sessionId,
                    initialConversationContext: config.initialContext || ''
                },
                overrides: {
                    agent: {
                        language: elevenLabsLanguage
                    }
                },
                ...(config.token ? { conversationToken: config.token } : { agentId: config.agentId! }),
                ...(config.userId ? { userId: config.userId } : {}),
                onConnect: () => {
                    console.log('Realtime session connected');
                    storage.getState().setRealtimeStatus('connected');
                    storage.getState().setRealtimeMode('idle');
                },
                onDisconnect: () => {
                    console.log('Realtime session disconnected');
                    storage.getState().setRealtimeStatus('disconnected');
                    storage.getState().setRealtimeMode('idle', true);
                    storage.getState().clearRealtimeModeDebounce();
                },
                onError: () => {
                    console.warn('Realtime voice error');
                    storage.getState().setRealtimeStatus('disconnected');
                    storage.getState().setRealtimeMode('idle', true);
                },
                onModeChange: (data: { mode: string }) => {
                    const isSpeaking = data.mode === 'speaking';
                    storage.getState().setRealtimeMode(isSpeaking ? 'speaking' : 'idle');
                },
            });
        } catch (error) {
            console.error('Failed to start realtime session:', error);
            storage.getState().setRealtimeStatus('error');
        }
    }

    async endSession(): Promise<void> {
        if (!conversationRef) return;
        try {
            conversationRef.endSession();
            storage.getState().setRealtimeStatus('disconnected');
        } catch (error) {
            console.error('Failed to end realtime session:', error);
        }
    }

    sendTextMessage(message: string): void {
        if (!conversationRef || conversationRef.status !== 'connected') return;
        try {
            conversationRef.sendUserMessage(message);
        } catch {
            // Session not yet active, ignore
        }
    }

    sendContextualUpdate(update: string): void {
        if (!conversationRef || conversationRef.status !== 'connected') return;
        try {
            conversationRef.sendContextualUpdate(update);
        } catch {
            // Session not yet active, ignore
        }
    }
}

export const RealtimeVoiceSession: React.FC = () => {
    const conversation = useConversation();
    const hasRegistered = useRef(false);

    useEffect(() => {
        conversationRef = conversation;

        if (!hasRegistered.current) {
            try {
                registerVoiceSession(new RealtimeVoiceSessionImpl());
                hasRegistered.current = true;
            } catch (error) {
                console.error('Failed to register voice session:', error);
            }
        }

        return () => {
            conversationRef = null;
        };
    }, [conversation]);

    return null;
};
