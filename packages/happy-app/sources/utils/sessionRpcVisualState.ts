export type SessionRpcVisualState = "disconnected" | "reconnecting" | "rpcPending" | "rpcReady";

interface ResolveSessionRpcVisualStateParams {
    readonly presence: "online" | number | undefined;
    readonly realtimeStatus: "disconnected" | "connecting" | "connected" | "error";
    readonly rpcReady: boolean;
}

export function resolveSessionRpcVisualState({
    presence,
    realtimeStatus,
    rpcReady,
}: ResolveSessionRpcVisualStateParams): SessionRpcVisualState {
    if (presence !== "online" || realtimeStatus === "disconnected" || realtimeStatus === "error") {
        return "disconnected";
    }

    if (realtimeStatus === "connecting") {
        return "reconnecting";
    }

    if (!rpcReady) {
        return "rpcPending";
    }

    return "rpcReady";
}
