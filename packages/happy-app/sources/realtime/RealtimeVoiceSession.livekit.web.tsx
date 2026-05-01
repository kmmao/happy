import React, { useEffect, useRef } from 'react';
import { Room, RoomEvent, Track, type RpcInvocationData, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from 'livekit-client';
import { registerVoiceSession } from './RealtimeSession';
import { realtimeClientTools } from './realtimeClientTools';
import { storage } from '@/sync/storage';
import type { VoiceSession, VoiceSessionConfig } from './types';

let roomRef: Room | null = null;
const audioElements: HTMLAudioElement[] = [];
const encoder = new TextEncoder();

async function handleRpc(data: RpcInvocationData, handler: (parameters: unknown) => Promise<string>): Promise<string> {
    try {
        return await handler(JSON.parse(data.payload));
    } catch {
        return 'error (invalid rpc payload)';
    }
}

class LiveKitVoiceSessionImpl implements VoiceSession {
    async startSession(config: VoiceSessionConfig): Promise<void> {
        if (!config.livekitToken || !config.livekitUrl) {
            throw new Error('LiveKit token or URL not provided');
        }

        storage.getState().setRealtimeStatus('connecting');

        const room = new Room();
        roomRef = room;

        room.registerRpcMethod('messageClaudeCode', (data) =>
            handleRpc(data, realtimeClientTools.messageClaudeCode)
        );
        room.registerRpcMethod('processPermissionRequest', (data) =>
            handleRpc(data, realtimeClientTools.processPermissionRequest)
        );

        room.on(RoomEvent.Connected, () => {
            storage.getState().setRealtimeStatus('connected');
            storage.getState().setRealtimeMode('idle');
        });
        room.on(RoomEvent.Disconnected, () => {
            storage.getState().setRealtimeStatus('disconnected');
            storage.getState().setRealtimeMode('idle', true);
            storage.getState().clearRealtimeModeDebounce();
        });
        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, _participant: RemoteParticipant) => {
            if (track.kind === Track.Kind.Audio) {
                const el = track.attach();
                el.id = `livekit-audio-${track.sid}`;
                document.body.appendChild(el);
                audioElements.push(el);
            }
        });
        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
            if (track.kind === Track.Kind.Audio) {
                track.detach().forEach(el => el.remove());
            }
        });

        await room.connect(config.livekitUrl, config.livekitToken);
        await room.localParticipant.setMicrophoneEnabled(true);

        if (config.initialContext) {
            this.sendContextualUpdate(config.initialContext);
        }
    }

    async endSession(): Promise<void> {
        const room = roomRef;
        roomRef = null;
        if (room) {
            await room.disconnect();
        }
        audioElements.forEach(el => el.remove());
        audioElements.length = 0;
        storage.getState().setRealtimeStatus('disconnected');
    }

    sendTextMessage(message: string): void {
        const room = roomRef;
        if (!room) return;
        room.localParticipant.publishData(
            encoder.encode(JSON.stringify({ type: 'user_message', message })),
            { reliable: true }
        );
    }

    sendContextualUpdate(update: string): void {
        const room = roomRef;
        if (!room) return;
        room.localParticipant.publishData(
            encoder.encode(JSON.stringify({ type: 'context_update', content: update })),
            { reliable: true }
        );
    }
}

export const LiveKitVoiceSession = React.memo(function LiveKitVoiceSession() {
    const hasRegistered = useRef(false);

    useEffect(() => {
        if (!hasRegistered.current) {
            registerVoiceSession(new LiveKitVoiceSessionImpl());
            hasRegistered.current = true;
        }
    }, []);

    return null;
});
