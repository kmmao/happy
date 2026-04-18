import { describe, expect, it } from "vitest";
import type { Socket } from "socket.io";
import { listRpcReadyScopes } from "./listRpcReadyScopes";

function createSocket(
    clientType: "user-scoped" | "session-scoped" | "machine-scoped",
    connected = true,
): Socket {
    return {
        connected,
        handshake: {
            auth: {
                clientType,
            },
        },
    } as unknown as Socket;
}

describe("listRpcReadyScopes", () => {
    it("汇总当前已连接的 session/machine rpc ready scope", () => {
        const rpcListeners = new Map<string, Socket>([
            ["session-1:bash", createSocket("session-scoped")],
            ["session-1:listDirectory", createSocket("session-scoped")],
            ["machine-1:bash", createSocket("machine-scoped")],
        ]);

        expect(listRpcReadyScopes(rpcListeners)).toEqual([
            { scope: "session", id: "session-1" },
            { scope: "machine", id: "machine-1" },
        ]);
    });

    it("忽略断开的 listener 和非 session/machine 的 listener", () => {
        const rpcListeners = new Map<string, Socket>([
            ["session-1:bash", createSocket("session-scoped", false)],
            ["machine-1:bash", createSocket("machine-scoped")],
            ["user-1:bash", createSocket("user-scoped")],
            ["invalid", createSocket("session-scoped")],
        ]);

        expect(listRpcReadyScopes(rpcListeners)).toEqual([
            { scope: "machine", id: "machine-1" },
        ]);
    });
});
