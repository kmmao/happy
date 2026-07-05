import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory MMKV fake, hoisted above the persistence import so `new MMKV()` at
// module load receives it. Exercises the shared `loadJson` envelope through its
// public callers (a Pattern-B unchecked loader and a Pattern-A validated one).
const mmkvStore = new Map<string, string | number | boolean>();

vi.mock("react-native-mmkv", () => ({
  MMKV: class {
    getAllKeys() { return Array.from(mmkvStore.keys()); }
    getString(key: string): string | undefined {
      const v = mmkvStore.get(key);
      return typeof v === "string" ? v : undefined;
    }
    set(key: string, value: string | number | boolean) { mmkvStore.set(key, value); }
    delete(key: string) { mmkvStore.delete(key); }
    clearAll() { mmkvStore.clear(); }
    contains(key: string) { return mmkvStore.has(key); }
  },
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

// Silence the expected parse-failure logging.
vi.mock("@/log", () => ({ log: { error: vi.fn(), log: vi.fn() } }));

import { loadSessionDrafts, loadPendingSessionPreferences } from "./persistence";

describe("loadJson envelope (via public loaders)", () => {
  beforeEach(() => { mmkvStore.clear(); });

  it("returns the decoded value when present and valid (unchecked loader)", () => {
    mmkvStore.set("session-drafts", JSON.stringify({ s1: "hello", s2: "world" }));
    expect(loadSessionDrafts()).toEqual({ s1: "hello", s2: "world" });
  });

  it("returns the fallback (not throwing) on corrupt JSON", () => {
    mmkvStore.set("session-drafts", "{ this is not json");
    expect(loadSessionDrafts()).toEqual({});
  });

  it("returns the fallback when the key is absent", () => {
    expect(loadSessionDrafts()).toEqual({});
  });

  it("returns the fallback when the validating parse throws (validated loader)", () => {
    // A record-schema loader given a non-record value → schema.parse throws →
    // caught by loadJson → fallback.
    mmkvStore.set("pending-session-preferences", JSON.stringify([1, 2, 3]));
    expect(loadPendingSessionPreferences()).toEqual({});
  });

  it("returns the validated value when the stored shape is valid", () => {
    mmkvStore.set("pending-session-preferences", JSON.stringify({}));
    expect(loadPendingSessionPreferences()).toEqual({});
  });
});
