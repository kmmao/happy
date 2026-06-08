import { beforeEach, describe, expect, it, vi } from "vitest";

const { emitEphemeralMock, logMock, debugMock } = vi.hoisted(() => ({
    emitEphemeralMock: vi.fn(),
    logMock: vi.fn(),
    debugMock: vi.fn(),
}));

vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: {
        _emitEphemeralInternal: emitEphemeralMock,
    },
    buildRpcReadyEphemeral: vi.fn(
        (scope: "machine" | "session", id: string, ready: boolean) => ({
            type: "rpc-ready",
            scope,
            id,
            ready,
        }),
    ),
}));

vi.mock("@/utils/log", () => ({
    log: logMock,
    debug: debugMock,
}));

import { rpcHandler } from "./rpcHandler";

type MockSocket = ReturnType<typeof createMockSocket>;

function createMockSocket(options: {
    id: string;
    connected?: boolean;
    clientType?: "user-scoped" | "session-scoped" | "machine-scoped";
}) {
    const handlers = new Map<string, (...args: any[]) => any>();

    return {
        id: options.id,
        connected: options.connected ?? true,
        handshake: {
            auth: {
                clientType: options.clientType,
            },
        },
        on: vi.fn((event: string, handler: (...args: any[]) => any) => {
            handlers.set(event, handler);
        }),
        emit: vi.fn(),
        timeout: vi.fn(),
        emitWithAck: vi.fn(),
        trigger(event: string, ...args: any[]) {
            const handler = handlers.get(event);
            if (!handler) {
                throw new Error(`No handler registered for ${event}`);
            }
            return handler(...args);
        },
    };
}

describe("rpcHandler stale listener cleanup", () => {
    let userSocket: MockSocket;
    let rpcListeners: Map<string, any>;

    beforeEach(() => {
        vi.clearAllMocks();
        userSocket = createMockSocket({
            id: "user-socket",
            clientType: "user-scoped",
        });
        rpcListeners = new Map<string, any>();
        rpcHandler({
            userId: "user-1",
            socket: userSocket as any,
            rpcListeners,
            clientType: "user-scoped",
        });
    });

    it("会在陈旧 session RPC listener 被清理时广播 session scope 的 rpc-ready:false", async () => {
        const staleSessionSocket = createMockSocket({
            id: "stale-session",
            connected: false,
            clientType: "session-scoped",
        });
        rpcListeners.set("session-1:bash", staleSessionSocket as any);
        const callback = vi.fn();

        await userSocket.trigger(
            "rpc-call",
            { method: "session-1:bash", params: {} },
            callback,
        );

        expect(rpcListeners.has("session-1:bash")).toBe(false);
        expect(emitEphemeralMock).toHaveBeenCalledWith({
            userId: "user-1",
            payload: {
                type: "rpc-ready",
                scope: "session",
                id: "session-1",
                ready: false,
            },
            recipientFilter: { type: "user-scoped-only" },
        });
        expect(callback).toHaveBeenCalledWith({
            ok: false,
            error: "RPC method not available",
        });
    });

    it("会在陈旧 machine RPC listener 被清理时继续广播 machine scope 的 rpc-ready:false", async () => {
        const staleMachineSocket = createMockSocket({
            id: "stale-machine",
            connected: false,
            clientType: "machine-scoped",
        });
        rpcListeners.set("machine-1:spawn-happy-session", staleMachineSocket as any);
        const callback = vi.fn();

        await userSocket.trigger(
            "rpc-call",
            { method: "machine-1:spawn-happy-session", params: {} },
            callback,
        );

        expect(emitEphemeralMock).toHaveBeenCalledWith({
            userId: "user-1",
            payload: {
                type: "rpc-ready",
                scope: "machine",
                id: "machine-1",
                ready: false,
            },
            recipientFilter: { type: "user-scoped-only" },
        });
        expect(callback).toHaveBeenCalledWith({
            ok: false,
            error: "RPC method not available",
        });
    });
});
