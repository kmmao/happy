import { describe, expect, it, vi } from "vitest";
import { claimRepeatKey, fetchRepeatKey } from "./repeatKey";

type RepeatKeyRecord = {
    key: string;
    value: string;
    expiresAt: Date;
    createdAt: Date;
};

function createTx(now: Date, initial?: RepeatKeyRecord) {
    const store = new Map<string, RepeatKeyRecord>();
    if (initial) {
        store.set(initial.key, initial);
    }

    return {
        store,
        tx: {
            repeatKey: {
                findUnique: vi.fn(async ({ where }: any) => {
                    const record = store.get(where.key) ?? null;
                    if (!record) return null;
                    if (where.expiresAt?.gte && record.expiresAt < where.expiresAt.gte) return null;
                    if (where.expiresAt?.lte && record.expiresAt > where.expiresAt.lte) return null;
                    return record;
                }),
                create: vi.fn(async ({ data }: any) => {
                    const existing = store.get(data.key);
                    if (existing) {
                        const error = new Error("Unique constraint failed");
                        (error as { code?: string }).code = "P2002";
                        throw error;
                    }
                    const record = { ...data, createdAt: now };
                    store.set(data.key, record);
                    return record;
                }),
                upsert: vi.fn(async ({ where, create, update }: any) => {
                    const existing = store.get(where.key);
                    const record = {
                        key: where.key,
                        value: existing ? update.value : create.value,
                        expiresAt: existing ? update.expiresAt : create.expiresAt,
                        createdAt: existing?.createdAt ?? now,
                    };
                    store.set(where.key, record);
                    return record;
                }),
                delete: vi.fn(async ({ where }: any) => {
                    if (!store.has(where.key)) {
                        const error = new Error("Record to delete does not exist");
                        (error as { code?: string }).code = "P2025";
                        throw error;
                    }
                    store.delete(where.key);
                }),
            },
        },
    };
}

describe("claimRepeatKey", () => {
    it("returns false when the key is still unexpired", async () => {
        const now = new Date("2025-01-01T12:00:00.000Z");
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const { tx } = createTx(now, {
            key: "repeat-key-1",
            value: "used",
            expiresAt: new Date("2025-01-01T13:00:00.000Z"),
            createdAt: new Date("2025-01-01T11:00:00.000Z"),
        });

        const claimed = await claimRepeatKey(tx as any, "repeat-key-1", "next", Date.now() + 60_000);

        expect(claimed).toBe(false);
        vi.useRealTimers();
    });

    it("reuses an expired key and refreshes its value and expiry", async () => {
        const now = new Date("2025-01-01T12:00:00.000Z");
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const { tx, store } = createTx(now, {
            key: "repeat-key-1",
            value: "stale",
            expiresAt: new Date("2025-01-01T11:00:00.000Z"),
            createdAt: new Date("2025-01-01T10:00:00.000Z"),
        });

        const nextExpiry = Date.now() + 5 * 60 * 1000;
        const claimed = await claimRepeatKey(tx as any, "repeat-key-1", "fresh", nextExpiry);
        const fetched = await fetchRepeatKey(tx as any, "repeat-key-1");

        expect(claimed).toBe(true);
        expect(fetched).toBe("fresh");
        expect(store.get("repeat-key-1")?.expiresAt.getTime()).toBe(nextExpiry);
        vi.useRealTimers();
    });

    it("returns false when another claimant deletes the expired key first", async () => {
        const now = new Date("2025-01-01T12:00:00.000Z");
        vi.useFakeTimers();
        vi.setSystemTime(now);
        const { tx, store } = createTx(now, {
            key: "repeat-key-1",
            value: "stale",
            expiresAt: new Date("2025-01-01T11:00:00.000Z"),
            createdAt: new Date("2025-01-01T10:00:00.000Z"),
        });
        tx.repeatKey.delete.mockImplementationOnce(async ({ where }: any) => {
            store.delete(where.key);
            const error = new Error("Record to delete does not exist");
            (error as { code?: string }).code = "P2025";
            throw error;
        });

        const claimed = await claimRepeatKey(tx as any, "repeat-key-1", "fresh", Date.now() + 60_000);

        expect(claimed).toBe(false);
        expect(store.has("repeat-key-1")).toBe(false);
        vi.useRealTimers();
    });
});
