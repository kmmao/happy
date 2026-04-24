import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory MMKV fake. `vi.mock` is hoisted above the imports below, so
// persistence.ts receives this stub when it runs `new MMKV()` at module load.
const mmkvStore = new Map<string, string | number | boolean>();

vi.mock("react-native-mmkv", () => ({
  MMKV: class {
    getAllKeys() {
      return Array.from(mmkvStore.keys());
    }
    getString(key: string): string | undefined {
      const v = mmkvStore.get(key);
      return typeof v === "string" ? v : undefined;
    }
    getNumber(key: string): number | undefined {
      const v = mmkvStore.get(key);
      return typeof v === "number" ? v : undefined;
    }
    getBoolean(key: string): boolean | undefined {
      const v = mmkvStore.get(key);
      return typeof v === "boolean" ? v : undefined;
    }
    set(key: string, value: string | number | boolean) {
      mmkvStore.set(key, value);
    }
    delete(key: string) {
      mmkvStore.delete(key);
    }
    clearAll() {
      mmkvStore.clear();
    }
    contains(key: string) {
      return mmkvStore.has(key);
    }
  },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

// Imported after vi.mock registration.
import {
  loadBackfillBoundaries,
  saveBackfillBoundary,
  deleteBackfillBoundary,
  type BackfillBoundary,
} from "./persistence";

const BOUNDARY_KEY = (sessionId: string) =>
  `msg-backfill-boundary-${sessionId}`;

describe("backfillBoundary persistence", () => {
  beforeEach(() => {
    mmkvStore.clear();
  });

  it("save → load roundtrips a valid boundary unchanged", () => {
    const boundary: BackfillBoundary = {
      minSeq: 9700,
      maxSeq: 9999,
      updatedAt: Date.now(),
    };

    saveBackfillBoundary("session-1", boundary);

    const loaded = loadBackfillBoundaries();
    expect(loaded.get("session-1")).toEqual(boundary);
  });

  it("load returns an empty Map when no boundaries exist", () => {
    expect(loadBackfillBoundaries().size).toBe(0);
  });

  it("delete removes a previously saved boundary", () => {
    saveBackfillBoundary("session-1", {
      minSeq: 1,
      maxSeq: 100,
      updatedAt: Date.now(),
    });
    deleteBackfillBoundary("session-1");

    expect(loadBackfillBoundaries().has("session-1")).toBe(false);
  });

  it("load auto-deletes an entry whose updatedAt is older than 30 days", () => {
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    mmkvStore.set(
      BOUNDARY_KEY("session-1"),
      JSON.stringify({
        minSeq: 1,
        maxSeq: 100,
        updatedAt: thirtyOneDaysAgo,
      }),
    );

    const loaded = loadBackfillBoundaries();
    expect(loaded.has("session-1")).toBe(false);
    // Expired entries are swept from the store so subsequent loads skip them.
    expect(mmkvStore.has(BOUNDARY_KEY("session-1"))).toBe(false);
  });

  it("load auto-deletes an entry whose minSeq > maxSeq", () => {
    mmkvStore.set(
      BOUNDARY_KEY("session-1"),
      JSON.stringify({
        minSeq: 500,
        maxSeq: 100, // inverted
        updatedAt: Date.now(),
      }),
    );

    const loaded = loadBackfillBoundaries();
    expect(loaded.has("session-1")).toBe(false);
    expect(mmkvStore.has(BOUNDARY_KEY("session-1"))).toBe(false);
  });

  it("load auto-deletes an entry with malformed JSON", () => {
    mmkvStore.set(BOUNDARY_KEY("session-1"), "{not-json");

    const loaded = loadBackfillBoundaries();
    expect(loaded.has("session-1")).toBe(false);
    expect(mmkvStore.has(BOUNDARY_KEY("session-1"))).toBe(false);
  });

  it("load auto-deletes an entry that fails schema validation", () => {
    mmkvStore.set(
      BOUNDARY_KEY("session-1"),
      JSON.stringify({
        minSeq: "not-a-number",
        maxSeq: 100,
        updatedAt: Date.now(),
      }),
    );
    mmkvStore.set(
      BOUNDARY_KEY("session-2"),
      JSON.stringify({ minSeq: -1, maxSeq: 100, updatedAt: Date.now() }),
    );

    const loaded = loadBackfillBoundaries();
    expect(loaded.has("session-1")).toBe(false);
    expect(loaded.has("session-2")).toBe(false);
    expect(mmkvStore.has(BOUNDARY_KEY("session-1"))).toBe(false);
    expect(mmkvStore.has(BOUNDARY_KEY("session-2"))).toBe(false);
  });

  it("load isolates valid entries from invalid ones in a single call", () => {
    saveBackfillBoundary("good-session", {
      minSeq: 100,
      maxSeq: 500,
      updatedAt: Date.now(),
    });
    mmkvStore.set(BOUNDARY_KEY("bad-session"), "{broken");

    const loaded = loadBackfillBoundaries();
    expect(loaded.size).toBe(1);
    expect(loaded.get("good-session")).toEqual({
      minSeq: 100,
      maxSeq: 500,
      updatedAt: expect.any(Number),
    });
    expect(loaded.has("bad-session")).toBe(false);
  });

  it("save overwrites an existing boundary for the same session", () => {
    const older: BackfillBoundary = {
      minSeq: 1,
      maxSeq: 100,
      updatedAt: Date.now() - 1000,
    };
    const newer: BackfillBoundary = {
      minSeq: 200,
      maxSeq: 500,
      updatedAt: Date.now(),
    };

    saveBackfillBoundary("session-1", older);
    saveBackfillBoundary("session-1", newer);

    const loaded = loadBackfillBoundaries();
    expect(loaded.get("session-1")).toEqual(newer);
  });

  it("load handles multiple concurrent sessions independently", () => {
    saveBackfillBoundary("session-a", {
      minSeq: 100,
      maxSeq: 200,
      updatedAt: Date.now(),
    });
    saveBackfillBoundary("session-b", {
      minSeq: 1000,
      maxSeq: 2000,
      updatedAt: Date.now(),
    });
    saveBackfillBoundary("session-c", {
      minSeq: 50,
      maxSeq: 60,
      updatedAt: Date.now(),
    });

    const loaded = loadBackfillBoundaries();
    expect(loaded.size).toBe(3);
    expect(loaded.get("session-a")?.maxSeq).toBe(200);
    expect(loaded.get("session-b")?.maxSeq).toBe(2000);
    expect(loaded.get("session-c")?.maxSeq).toBe(60);
  });
});
