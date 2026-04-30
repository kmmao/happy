import React from 'react';
import { ConversationProvider } from "@elevenlabs/react-native";
import { useSetting } from '@/sync/storage';
import { RealtimeVoiceSession } from './RealtimeVoiceSession';
import { LiveKitVoiceSession } from './RealtimeVoiceSession.livekit';

export const RealtimeProvider = ({ children }: { children: React.ReactNode }) => {
    const voiceBackend = useSetting('voiceBackend');

    if (voiceBackend === 'livekit') {
        return (
            <>
                <LiveKitVoiceSession />
                {children}
            </>
        );
    }

    return (
        <ConversationProvider>
            <RealtimeVoiceSession />
            {children}
        </ConversationProvider>
    );
};
