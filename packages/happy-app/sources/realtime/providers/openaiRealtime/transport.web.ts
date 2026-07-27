import type {
    RealtimeTransport,
    RealtimeTransportCallbacks,
    SdpExchange,
} from './transportTypes';

/**
 * Browser WebRTC transport for the OpenAI Realtime calls API.
 *
 * The SDP is exchanged in a single HTTP round trip, so there is no signalling
 * channel to trickle ICE candidates over — the offer is sent as soon as
 * `setLocalDescription` resolves, exactly like the upstream reference client.
 */

const EVENT_CHANNEL_LABEL = 'oai-events';

export function createRealtimeTransport(
    callbacks: RealtimeTransportCallbacks,
): RealtimeTransport {
    let peerConnection: RTCPeerConnection | null = null;
    let dataChannel: RTCDataChannel | null = null;
    let microphone: MediaStream | null = null;
    let audioElement: HTMLAudioElement | null = null;
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

        if (audioElement) {
            audioElement.srcObject = null;
            audioElement.remove();
            audioElement = null;
        }

        callbacks.onClose();
    };

    const fail = (error: Error) => {
        if (closed) return;
        callbacks.onError(error);
        close();
    };

    const connect = async (exchangeSdp: SdpExchange) => {
        const pc = new RTCPeerConnection();
        peerConnection = pc;

        // Remote audio needs a sink attached before the answer arrives.
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.style.display = 'none';
        document.body.appendChild(audio);
        audioElement = audio;
        pc.ontrack = (event) => {
            audio.srcObject = event.streams[0] ?? null;
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed') {
                fail(new Error('Realtime peer connection failed'));
            } else if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
                close();
            }
        };

        microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of microphone.getTracks()) {
            pc.addTrack(track, microphone);
        }

        const channel = pc.createDataChannel(EVENT_CHANNEL_LABEL);
        dataChannel = channel;
        channel.onopen = () => callbacks.onOpen();
        channel.onclose = () => close();
        channel.onerror = () => fail(new Error('Realtime data channel error'));
        channel.onmessage = (event) => {
            if (typeof event.data === 'string') {
                callbacks.onEvent(event.data);
            }
        };

        const offer = await pc.createOffer();
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
