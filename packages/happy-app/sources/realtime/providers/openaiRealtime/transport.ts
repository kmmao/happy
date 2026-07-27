import { AudioSession, AndroidAudioTypePresets } from '@livekit/react-native';
import { mediaDevices, RTCPeerConnection, type MediaStream } from '@livekit/react-native-webrtc';
import type {
    RealtimeTransport,
    RealtimeTransportCallbacks,
    SdpExchange,
} from './transportTypes';

/**
 * React Native WebRTC transport for the OpenAI Realtime calls API.
 *
 * Mirrors `transport.web.ts` with two platform differences: remote audio is
 * routed by the native audio session instead of an `<audio>` sink, and the
 * session has to be configured for voice communication before the microphone
 * is opened. Metro resolves this file on iOS and Android.
 */

const EVENT_CHANNEL_LABEL = 'oai-events';

type RTCDataChannel = ReturnType<RTCPeerConnection['createDataChannel']>;

async function startAudioSession(): Promise<void> {
    await AudioSession.configureAudio({
        android: { audioTypeOptions: AndroidAudioTypePresets.communication },
        ios: { defaultOutput: 'speaker' },
    });
    await AudioSession.startAudioSession();
}

export function createRealtimeTransport(
    callbacks: RealtimeTransportCallbacks,
): RealtimeTransport {
    let peerConnection: RTCPeerConnection | null = null;
    let dataChannel: RTCDataChannel | null = null;
    let microphone: MediaStream | null = null;
    let audioSessionStarted = false;
    let closed = false;

    const close = () => {
        if (closed) return;
        closed = true;

        dataChannel?.close();
        dataChannel = null;

        microphone?.getTracks().forEach((track) => track.stop());
        microphone = null;

        peerConnection?.close();
        peerConnection = null;

        if (audioSessionStarted) {
            audioSessionStarted = false;
            // Releasing the session is best effort — the call is already gone.
            void AudioSession.stopAudioSession().catch(() => {});
        }

        callbacks.onClose();
    };

    const fail = (error: Error) => {
        if (closed) return;
        callbacks.onError(error);
        close();
    };

    const connect = async (exchangeSdp: SdpExchange) => {
        // Must precede getUserMedia so the mic opens in communication mode.
        await startAudioSession();
        audioSessionStarted = true;

        const pc = new RTCPeerConnection();
        peerConnection = pc;

        // Remote audio needs no sink here: the native layer plays subscribed
        // tracks through the audio session configured above.
        pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'failed') {
                fail(new Error('Realtime peer connection failed'));
            } else if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
                close();
            }
        });

        microphone = await mediaDevices.getUserMedia({ audio: true });
        for (const track of microphone.getTracks()) {
            pc.addTrack(track, microphone);
        }

        const channel = pc.createDataChannel(EVENT_CHANNEL_LABEL);
        dataChannel = channel;
        channel.addEventListener('open', () => callbacks.onOpen());
        channel.addEventListener('close', () => close());
        channel.addEventListener('error', () => fail(new Error('Realtime data channel error')));
        channel.addEventListener('message', (event) => {
            if (typeof event.data === 'string') {
                callbacks.onEvent(event.data);
            }
        });

        const offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);

        const answerSdp = await exchangeSdp(offer.sdp ?? '');
        if (closed) return;
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    };

    return {
        connect,
        send: (event) => {
            if (dataChannel?.readyState !== 'open') return;
            dataChannel.send(JSON.stringify(event));
        },
        close,
    };
}
