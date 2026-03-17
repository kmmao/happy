import { describe, it, expect } from "vitest";
import { AsyncLock } from "./lock";

describe("AsyncLock", () => {
    it("should execute a function and return its result", async () => {
        const lock = new AsyncLock();
        const result = await lock.inLock(() => 42);
        expect(result).toBe(42);
    });

    it("should execute async functions", async () => {
        const lock = new AsyncLock();
        const result = await lock.inLock(async () => {
            return "async-result";
        });
        expect(result).toBe("async-result");
    });

    it("should serialize concurrent access", async () => {
        const lock = new AsyncLock();
        const order: number[] = [];

        const task1 = lock.inLock(async () => {
            order.push(1);
            await new Promise((r) => setTimeout(r, 50));
            order.push(2);
            return "first";
        });

        const task2 = lock.inLock(async () => {
            order.push(3);
            return "second";
        });

        const [r1, r2] = await Promise.all([task1, task2]);

        expect(r1).toBe("first");
        expect(r2).toBe("second");
        expect(order).toEqual([1, 2, 3]);
    });

    it("should release lock even if function throws", async () => {
        const lock = new AsyncLock();

        await expect(
            lock.inLock(() => {
                throw new Error("test error");
            }),
        ).rejects.toThrow("test error");

        const result = await lock.inLock(() => "recovered");
        expect(result).toBe("recovered");
    });

    it("should handle multiple sequential operations", async () => {
        const lock = new AsyncLock();
        const results: number[] = [];

        for (let i = 0; i < 5; i++) {
            const r = await lock.inLock(() => i);
            results.push(r);
        }

        expect(results).toEqual([0, 1, 2, 3, 4]);
    });

    it("should handle multiple concurrent waiters", async () => {
        const lock = new AsyncLock();
        const order: number[] = [];

        const tasks = Array.from({ length: 5 }, (_, i) =>
            lock.inLock(async () => {
                order.push(i);
                await new Promise((r) => setTimeout(r, 10));
                return i;
            }),
        );

        const results = await Promise.all(tasks);

        expect(results).toEqual([0, 1, 2, 3, 4]);
        expect(order).toEqual([0, 1, 2, 3, 4]);
    });
});
