import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskEventRefreshRetrier } from "./taskEventRefresh";

describe("createTaskEventRefreshRetrier", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("retries after a failed event refresh until one attempt succeeds", async () => {
        const refresh = vi
            .fn<() => Promise<boolean>>()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        const retrier = createTaskEventRefreshRetrier(refresh, { intervalMs: 1000 });

        retrier.trigger();
        await vi.runAllTicks();
        expect(refresh).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1000);
        expect(refresh).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(1000);
        expect(refresh).toHaveBeenCalledTimes(3);

        await vi.advanceTimersByTimeAsync(5000);
        expect(refresh).toHaveBeenCalledTimes(3);

        retrier.dispose();
    });

    it("coalesces repeated events while a retry loop is already active", async () => {
        let resolveFirst: ((value: boolean) => void) | undefined;
        const refresh = vi
            .fn<() => Promise<boolean>>()
            .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
                resolveFirst = resolve;
            }))
            .mockResolvedValueOnce(true);
        const retrier = createTaskEventRefreshRetrier(refresh, { intervalMs: 1000 });

        retrier.trigger();
        retrier.trigger();
        await vi.runAllTicks();
        expect(refresh).toHaveBeenCalledTimes(1);

        expect(resolveFirst).toBeDefined();
        resolveFirst!(false);
        vi.runAllTicks();
        await vi.advanceTimersByTimeAsync(1000);
        expect(refresh).toHaveBeenCalledTimes(2);

        retrier.dispose();
    });

    it("runs one more refresh when a new event arrives during a successful refresh", async () => {
        let resolveFirst: ((value: boolean) => void) | undefined;
        const refresh = vi
            .fn<() => Promise<boolean>>()
            .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
                resolveFirst = resolve;
            }))
            .mockResolvedValueOnce(true);
        const retrier = createTaskEventRefreshRetrier(refresh, { intervalMs: 1000 });

        retrier.trigger();
        vi.runAllTicks();
        expect(refresh).toHaveBeenCalledTimes(1);

        retrier.trigger();
        expect(resolveFirst).toBeDefined();
        resolveFirst!(true);
        await Promise.resolve();
        await Promise.resolve();

        expect(refresh).toHaveBeenCalledTimes(2);

        retrier.dispose();
    });
});
