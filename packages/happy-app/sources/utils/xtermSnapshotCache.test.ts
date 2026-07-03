/**
 * Vitest suite for xtermSnapshotCache — an untyped in-memory Storage
 * polyfill stands in for `window.localStorage` under Node.js so the module
 * runs unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    clearAllXtermSnapshots,
    deleteXtermSnapshot,
    loadXtermSnapshot,
    saveXtermSnapshot,
} from "./xtermSnapshotCache";

// ─── In-memory localStorage stub ──────────────────────────────────────────

class MemoryStorage {
    store: Map<string, string> = new Map();
    quotaBytes: number = Number.POSITIVE_INFINITY;

    private get bytes(): number {
        let n = 0;
        for (const [k, v] of this.store) n += k.length + v.length;
        return n;
    }

    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
        const nextBytes = this.bytes - (this.store.get(key)?.length ?? 0) + value.length;
        if (nextBytes > this.quotaBytes) {
            const err = new Error("QuotaExceededError");
            err.name = "QuotaExceededError";
            throw err;
        }
        this.store.set(key, value);
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
    clear(): void {
        this.store.clear();
    }
    key(index: number): string | null {
        return Array.from(this.store.keys())[index] ?? null;
    }
    get length(): number {
        return this.store.size;
    }
}

let mockStorage: MemoryStorage;

beforeEach(() => {
    mockStorage = new MemoryStorage();
    // Vitest's happy-dom / jsdom would give us a `window` here; explicitly
    // wire our own to be robust across environments.
    vi.stubGlobal("window", { localStorage: mockStorage });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ─── Round-trip ───────────────────────────────────────────────────────────

describe("xtermSnapshotCache — round trip", () => {
    it("saves a snapshot and loads the same content back", () => {
        saveXtermSnapshot("claude:abc", "\x1b[2Jhello world");
        expect(loadXtermSnapshot("claude:abc")).toBe("\x1b[2Jhello world");
    });

    it("returns null for an unknown terminalId", () => {
        expect(loadXtermSnapshot("nope")).toBeNull();
    });

    it("returns null when window is undefined (native platforms)", () => {
        vi.unstubAllGlobals();
        vi.stubGlobal("window", undefined);
        expect(loadXtermSnapshot("claude:abc")).toBeNull();
        // save is a no-op — no throw, no state written
        saveXtermSnapshot("claude:abc", "content");
        // Restore for the following test's afterEach unstub
        vi.stubGlobal("window", { localStorage: mockStorage });
        // Nothing should have landed
        expect(loadXtermSnapshot("claude:abc")).toBeNull();
    });

    it("deleteXtermSnapshot forgets the entry", () => {
        saveXtermSnapshot("claude:abc", "content");
        expect(loadXtermSnapshot("claude:abc")).not.toBeNull();
        deleteXtermSnapshot("claude:abc");
        expect(loadXtermSnapshot("claude:abc")).toBeNull();
    });

    it("clearAllXtermSnapshots wipes every session + the index", () => {
        saveXtermSnapshot("a", "1");
        saveXtermSnapshot("b", "2");
        saveXtermSnapshot("c", "3");
        clearAllXtermSnapshots();
        expect(loadXtermSnapshot("a")).toBeNull();
        expect(loadXtermSnapshot("b")).toBeNull();
        expect(loadXtermSnapshot("c")).toBeNull();
        expect(mockStorage.store.size).toBe(0);
    });
});

// ─── Schema guards ────────────────────────────────────────────────────────

describe("xtermSnapshotCache — schema guards", () => {
    it("ignores payloads from a different schema version", () => {
        mockStorage.setItem(
            "xterm-v1-abc",
            JSON.stringify({ schemaVersion: 999, serialized: "old" }),
        );
        expect(loadXtermSnapshot("abc")).toBeNull();
    });

    it("ignores malformed JSON", () => {
        mockStorage.setItem("xterm-v1-abc", "{not json");
        expect(loadXtermSnapshot("abc")).toBeNull();
    });

    it("ignores payloads without a serialized string", () => {
        mockStorage.setItem(
            "xterm-v1-abc",
            JSON.stringify({ schemaVersion: 1, serialized: 42 }),
        );
        expect(loadXtermSnapshot("abc")).toBeNull();
    });
});

// ─── Size + LRU ──────────────────────────────────────────────────────────

describe("xtermSnapshotCache — size and LRU", () => {
    it("silently drops snapshots larger than MAX_SNAPSHOT_BYTES", () => {
        const big = "x".repeat(600 * 1024); // > 512 KB cap
        saveXtermSnapshot("claude:big", big);
        expect(loadXtermSnapshot("claude:big")).toBeNull();
        expect(mockStorage.store.size).toBe(0);
    });

    it("evicts the oldest sessions once the LRU cap is exceeded", async () => {
        // MAX_SESSIONS is 20 — write 25 with distinguishable savedAt.
        for (let i = 0; i < 25; i += 1) {
            saveXtermSnapshot(`t${i}`, `content-${i}`);
            // Advance real time enough to break the LRU tie. Otherwise every
            // save happens within the same millisecond and sort order is
            // arbitrary — which the test would then flake on.
            await new Promise((r) => setTimeout(r, 1));
        }
        // t0..t4 are the oldest — should be evicted; t5..t24 survive.
        for (let i = 0; i < 5; i += 1) {
            expect(loadXtermSnapshot(`t${i}`)).toBeNull();
        }
        for (let i = 5; i < 25; i += 1) {
            expect(loadXtermSnapshot(`t${i}`)).toBe(`content-${i}`);
        }
    });

    it("recovers from QuotaExceededError by evicting oldest half", async () => {
        // Tight quota — just enough for a handful of small snapshots + index.
        mockStorage.quotaBytes = 4 * 1024;
        for (let i = 0; i < 6; i += 1) {
            saveXtermSnapshot(`t${i}`, "x".repeat(400));
            await new Promise((r) => setTimeout(r, 1));
        }
        // Newest survivors are guaranteed to be present, and cache size
        // did not exceed the quota (didn't blow up).
        expect(loadXtermSnapshot("t5")).toBe("x".repeat(400));
    });
});
