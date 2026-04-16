import { describe, expect, it } from "vitest";
import { resolveSessionRpcVisualState } from "./sessionRpcVisualState";

describe("resolveSessionRpcVisualState", () => {
    it("离线或 socket 断开时返回 disconnected", () => {
        expect(resolveSessionRpcVisualState({
            presence: "online",
            realtimeStatus: "disconnected",
            rpcReady: true,
        })).toBe("disconnected");

        expect(resolveSessionRpcVisualState({
            presence: 1776329000000,
            realtimeStatus: "connected",
            rpcReady: true,
        })).toBe("disconnected");
    });

    it("socket 连接中时返回 reconnecting，rpc 尚未就绪时返回 rpcPending", () => {
        expect(resolveSessionRpcVisualState({
            presence: "online",
            realtimeStatus: "connecting",
            rpcReady: false,
        })).toBe("reconnecting");

        expect(resolveSessionRpcVisualState({
            presence: "online",
            realtimeStatus: "connected",
            rpcReady: false,
        })).toBe("rpcPending");
    });

    it("在线且 rpcReady 时返回 rpcReady", () => {
        expect(resolveSessionRpcVisualState({
            presence: "online",
            realtimeStatus: "connected",
            rpcReady: true,
        })).toBe("rpcReady");
    });
});
