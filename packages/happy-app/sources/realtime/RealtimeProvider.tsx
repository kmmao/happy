import React from 'react';
import { ConversationProvider } from "@elevenlabs/react-native";
import { RealtimeVoiceSession } from './RealtimeVoiceSession';

export const RealtimeProvider = ({ children }: { children: React.ReactNode }) => {
    return (
        <ConversationProvider>
            <RealtimeVoiceSession />
            {children}
        </ConversationProvider>
    );
};
