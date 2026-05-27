import { describe, expect, it, vi, afterEach } from "vitest";
import { waitForSessionRpcReady } from "./waitForSessionRpcReady";

describe("waitForSessionRpcReady", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("resolves true immediately when already ready", async () => {
        const result = await waitForSessionRpcReady(() => true, 1000, 50);
        expect(result).toBe(true);
    });

    it("resolves true once ready before timeout", async () => {
        vi.useFakeTimers();
        let ready = false;
        const promise = waitForSessionRpcReady(() => ready, 10_000, 100);

        // Not ready yet after a few polls
        await vi.advanceTimersByTimeAsync(300);
        ready = true;
        await vi.advanceTimersByTimeAsync(100);

        expect(await promise).toBe(true);
    });

    it("resolves false when never ready before timeout", async () => {
        vi.useFakeTimers();
        const promise = waitForSessionRpcReady(() => false, 500, 100);

        await vi.advanceTimersByTimeAsync(600);

        expect(await promise).toBe(false);
    });
});
