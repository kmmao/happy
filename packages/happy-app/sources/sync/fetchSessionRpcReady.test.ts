import { describe, expect, it } from "vitest";
import { resolveFetchedSessionRpcReady } from "./fetchSessionRpcReady";

describe("resolveFetchedSessionRpcReady", () => {
    it("保留现有 session 的 rpcReady=true", () => {
        expect(resolveFetchedSessionRpcReady({ rpcReady: true })).toBe(true);
    });

    it("在现有 session 缺失时默认返回 false", () => {
        expect(resolveFetchedSessionRpcReady(undefined)).toBe(false);
    });
});
