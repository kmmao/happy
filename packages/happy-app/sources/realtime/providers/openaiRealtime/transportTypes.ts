/**
 * Platform-agnostic contract for the WebRTC leg of a realtime call.
 *
 * The transport owns the peer connection, the microphone track, remote audio
 * playback and the `oai-events` data channel. It knows nothing about the
 * gateway: SDP is exchanged through the `exchangeSdp` callback passed to
 * `connect`, so the same implementation works against any compatible endpoint.
 */

export interface RealtimeTransportCallbacks {
    /** A raw data channel frame — always a JSON encoded realtime event. */
    onEvent: (raw: string) => void;
    /** The data channel became usable; safe to send events from here on. */
    onOpen: () => void;
    /** The call ended, either locally or remotely. Fires at most once. */
    onClose: () => void;
    /** A fatal transport error. `onClose` still follows. */
    onError: (error: Error) => void;
}

/** Exchanges a local SDP offer for a remote SDP answer. */
export type SdpExchange = (offerSdp: string) => Promise<string>;

export interface RealtimeTransport {
    connect(exchangeSdp: SdpExchange): Promise<void>;
    /** Serialize and send a client event. No-op when the channel is not open. */
    send(event: Record<string, unknown>): void;
    /** Tear down the call. Idempotent. */
    close(): void;
}
