import { Socket } from "socket.io";

export interface RpcReadyScope {
    readonly scope: "machine" | "session";
    readonly id: string;
}

export function listRpcReadyScopes(
    rpcListeners: ReadonlyMap<string, Socket>,
): RpcReadyScope[] {
    const scopes = new Map<string, RpcReadyScope>();

    for (const [method, socket] of rpcListeners.entries()) {
        if (!socket.connected) {
            continue;
        }

        const colonIndex = method.indexOf(":");
        if (colonIndex <= 0) {
            continue;
        }

        const clientType = socket.handshake.auth.clientType;
        const scope =
            clientType === "machine-scoped"
                ? "machine"
                : clientType === "session-scoped"
                    ? "session"
                    : null;

        if (!scope) {
            continue;
        }

        const id = method.substring(0, colonIndex);
        scopes.set(`${scope}:${id}`, { scope, id });
    }

    return [...scopes.values()];
}
