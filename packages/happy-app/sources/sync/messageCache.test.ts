import { beforeEach, describe, expect, it, vi } from "vitest";

const mmkvStore = new Map<string, string | number | boolean>();

vi.mock("react-native-mmkv", () => ({
  MMKV: class {
    getString(key: string): string | undefined {
      const value = mmkvStore.get(key);
      return typeof value === "string" ? value : undefined;
    }

    getBoolean(key: string): boolean | undefined {
      const value = mmkvStore.get(key);
      return typeof value === "boolean" ? value : undefined;
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
  },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("@/log", () => ({
  log: {
    log: vi.fn(),
  },
}));

import {
  clearAllMessageCaches,
  initMessageCache,
  loadMessageCache,
  saveMessageCache,
} from "./messageCache";

function userMessage(id: string, text: string, createdAt: number) {
  return {
    kind: "user-text" as const,
    id,
    realId: id,
    localId: null,
    createdAt,
    text,
  };
}

describe("messageCache session preview", () => {
  beforeEach(() => {
    mmkvStore.clear();
    initMessageCache("test-key");
  });

  it("persists latest user request preview with cached messages", () => {
    saveMessageCache(
      "session-1",
      [userMessage("message-1", "hello preview", 1)],
      1,
      { text: "hello preview", isAutoOptionSend: false },
    );

    expect(loadMessageCache("session-1")?.latestUserRequestPreview).toEqual({
      text: "hello preview",
      isAutoOptionSend: false,
    });
  });

  it("keeps latest user request preview even when cached messages are trimmed", () => {
    const messages = Array.from({ length: 351 }, (_, index) =>
      userMessage(`message-${index}`, `message ${index}`, index),
    );

    saveMessageCache(
      "session-1",
      messages,
      351,
      { text: "oldest important request", isAutoOptionSend: true },
    );

    const cached = loadMessageCache("session-1");
    expect(cached?.messages).toHaveLength(350);
    expect(cached?.isTrimmed).toBe(true);
    expect(cached?.latestUserRequestPreview).toEqual({
      text: "oldest important request",
      isAutoOptionSend: true,
    });
  });

  it("loads v1 caches without preview as compatible v2 data", () => {
    const message = userMessage("message-1", "legacy preview", 1);
    mmkvStore.set(
      "msg-v1-session-legacy",
      JSON.stringify({
        schemaVersion: 1,
        messages: [message],
        lastSeq: 1,
        savedAt: 1_710_000_000_000,
        isTrimmed: false,
      }),
    );

    expect(loadMessageCache("session-legacy")).toEqual({
      schemaVersion: 2,
      messages: [message],
      lastSeq: 1,
      savedAt: 1_710_000_000_000,
      isTrimmed: false,
      latestUserRequestPreview: undefined,
    });
  });

  it("clears cached preview when all message caches are cleared", () => {
    saveMessageCache(
      "session-1",
      [userMessage("message-1", "hello preview", 1)],
      1,
      { text: "hello preview", isAutoOptionSend: false },
    );

    clearAllMessageCaches();

    initMessageCache("test-key");
    expect(loadMessageCache("session-1")).toBeNull();
  });
});
