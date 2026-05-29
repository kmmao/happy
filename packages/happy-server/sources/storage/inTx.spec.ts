import { describe, it, expect, vi, beforeEach } from "vitest";

// inTx wraps db.$transaction. Mock the db so the contract (after-commit
// callbacks, async awaiting, error isolation) can be tested without Postgres.
// The mock runs the wrapped fn immediately and returns its result, simulating a
// successful commit.
const transactionMock = vi.fn(async (fn: (tx: any) => Promise<any>) => {
    const tx = {};
    return await fn(tx);
});

vi.mock("@/storage/db", () => ({
    db: {
        get $transaction() {
            return transactionMock;
        },
    },
}));

const logMock = vi.fn();
vi.mock("@/utils/log", () => ({
    log: (...args: any[]) => logMock(...args),
}));

import { inTx, afterTx } from "./inTx";

describe("inTx / afterTx contract", () => {
    beforeEach(() => {
        transactionMock.mockClear();
        logMock.mockClear();
    });

    it("runs after-commit callbacks once the transaction resolves", async () => {
        const order: string[] = [];
        const result = await inTx(async (tx) => {
            order.push("body");
            afterTx(tx, () => {
                order.push("after");
            });
            return 42;
        });
        expect(result).toBe(42);
        expect(order).toEqual(["body", "after"]);
    });

    it("awaits async after-commit callbacks (no fire-and-forget)", async () => {
        let resolved = false;
        await inTx(async (tx) => {
            afterTx(tx, async () => {
                await Promise.resolve();
                resolved = true;
            });
        });
        // If the callback were not awaited, resolved would still be false here.
        expect(resolved).toBe(true);
    });

    it("runs callbacks in registration order, serially", async () => {
        const order: string[] = [];
        await inTx(async (tx) => {
            afterTx(tx, async () => {
                await Promise.resolve();
                order.push("first");
            });
            afterTx(tx, () => {
                order.push("second");
            });
        });
        expect(order).toEqual(["first", "second"]);
    });
    it("isolates a failing callback: later callbacks still run and inTx resolves", async () => {
        const order: string[] = [];
        const result = await inTx(async (tx) => {
            afterTx(tx, async () => {
                throw new Error("emit failed");
            });
            afterTx(tx, () => {
                order.push("survivor");
            });
            return "ok";
        });
        // The transaction already committed — a callback failure must not reject inTx.
        expect(result).toBe("ok");
        // The second callback still ran despite the first throwing.
        expect(order).toEqual(["survivor"]);
        // The failure was surfaced (not silently swallowed).
        expect(logMock).toHaveBeenCalledTimes(1);
    });

    it("surfaces a rejected async callback as a logged warning, not an unhandled rejection", async () => {
        await expect(
            inTx(async (tx) => {
                afterTx(tx, async () => {
                    throw new Error("async emit failed");
                });
            }),
        ).resolves.toBeUndefined();
        expect(logMock).toHaveBeenCalledTimes(1);
    });

    it("throws if afterTx is called outside of inTx (tx not seeded)", () => {
        expect(() => afterTx({} as any, () => {})).toThrow(/afterTx called outside of inTx/);
    });

    it("does not leak callbacks across transactions", async () => {
        const calls: string[] = [];
        await inTx(async (tx) => {
            afterTx(tx, () => { calls.push("tx1"); });
        });
        await inTx(async (tx) => {
            afterTx(tx, () => { calls.push("tx2"); });
        });
        // Each tx runs only its own callback (no accumulation across the WeakMap).
        expect(calls).toEqual(["tx1", "tx2"]);
    });
});
