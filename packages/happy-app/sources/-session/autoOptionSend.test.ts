import { describe, expect, it } from "vitest";
import {
  buildAutoOptionCandidate,
  buildOptionsHash,
  createInitialAutoOptionSendState,
  reduceAutoOptionSendEvent,
  type AutoOptionSendContext,
} from "./autoOptionSend";

function createContext(
  partial: Partial<AutoOptionSendContext> = {},
): AutoOptionSendContext {
  return {
    sessionId: "session-1",
    currentSessionId: "session-1",
    inputText: "",
    hasPendingImages: false,
    isSttListening: false,
    hasAskUserQuestionVisible: false,
    isCurrentSessionActive: true,
    now: 1000,
    durationMs: 10_000,
    snapshot: {
      sourceType: "markdown-options",
      sourceMessageId: "msg-1",
      items: ["继续修 token", "整理检查清单"],
      recommendedIndex: 0,
      optionsHash: buildOptionsHash(["继续修 token", "整理检查清单"]),
    },
    ...partial,
  };
}

describe("autoOptionSend", () => {
  it("默认状态为 off", () => {
    expect(createInitialAutoOptionSendState()).toEqual({
      enabled: false,
      status: "off",
      candidate: null,
      remainingMs: null,
      lastAutoSentText: null,
      lastCancelReason: null,
      shouldSendText: null,
    });
  });

  it("有有效 options 时打开开关会进入 armed", () => {
    const next = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext(),
    );

    expect(next.enabled).toBe(true);
    expect(next.status).toBe("armed");
    expect(next.remainingMs).toBe(10_000);
    expect(next.candidate?.recommendedText).toBe("继续修 token");
  });

  it("没有 options 时打开开关会保持 off", () => {
    const next = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext({ snapshot: null }),
    );

    expect(next.enabled).toBe(false);
    expect(next.status).toBe("off");
    expect(next.candidate).toBeNull();
  });

  it("出现 AskUserQuestion 时会取消并关闭", () => {
    const armed = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext(),
    );

    const next = reduceAutoOptionSendEvent(
      armed,
      { type: "context-invalidated", reason: "ask-user-question" },
      createContext({ hasAskUserQuestionVisible: true }),
    );

    expect(next.enabled).toBe(false);
    expect(next.status).toBe("off");
    expect(next.lastCancelReason).toBe("ask-user-question");
  });

  it("用户输入时会取消并关闭", () => {
    const armed = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext(),
    );

    const next = reduceAutoOptionSendEvent(
      armed,
      { type: "context-invalidated", reason: "user-typed" },
      createContext({ inputText: "hello" }),
    );

    expect(next.enabled).toBe(false);
    expect(next.status).toBe("off");
    expect(next.lastCancelReason).toBe("user-typed");
  });

  it("timer 到时后满足条件会请求发送推荐项", () => {
    const armed = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext(),
    );

    const ready = reduceAutoOptionSendEvent(
      armed,
      { type: "timer-finished" },
      createContext({ now: 11_000 }),
    );

    expect(ready.status).toBe("ready");

    const fired = reduceAutoOptionSendEvent(
      ready,
      { type: "attempt-fire" },
      createContext({ now: 11_000 }),
    );

    expect(fired.shouldSendText).toBe("继续修 token");
    expect(fired.status).toBe("fired");
    expect(fired.enabled).toBe(false);
    expect(fired.lastAutoSentText).toBe("继续修 token");
  });

  it("timer 到时后若推荐项已变化则不发送", () => {
    const armed = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext(),
    );

    const ready = reduceAutoOptionSendEvent(
      armed,
      { type: "timer-finished" },
      createContext({
        now: 11_000,
        snapshot: {
          sourceType: "markdown-options",
          sourceMessageId: "msg-1",
          items: ["继续审阶段 B", "整理检查清单"],
          recommendedIndex: 0,
          optionsHash: buildOptionsHash(["继续审阶段 B", "整理检查清单"]),
        },
      }),
    );

    const next = reduceAutoOptionSendEvent(
      ready,
      { type: "attempt-fire" },
      createContext({
        now: 11_000,
        snapshot: {
          sourceType: "markdown-options",
          sourceMessageId: "msg-1",
          items: ["继续审阶段 B", "整理检查清单"],
          recommendedIndex: 0,
          optionsHash: buildOptionsHash(["继续审阶段 B", "整理检查清单"]),
        },
      }),
    );

    expect(next.shouldSendText).toBeNull();
    expect(next.status).toBe("off");
  });

  it("重复推荐文本不会再次自动发送", () => {
    const state = {
      ...createInitialAutoOptionSendState(),
      lastAutoSentText: "继续修 token",
    };

    const armed = reduceAutoOptionSendEvent(
      state,
      { type: "toggle", enabled: true },
      createContext(),
    );

    const ready = reduceAutoOptionSendEvent(
      armed,
      { type: "timer-finished" },
      createContext({ now: 11_000 }),
    );

    const next = reduceAutoOptionSendEvent(
      ready,
      { type: "attempt-fire" },
      createContext({ now: 11_000 }),
    );

    expect(next.shouldSendText).toBeNull();
    expect(next.status).toBe("off");
  });

  it("可以构建 candidate", () => {
    const candidate = buildAutoOptionCandidate(createContext());
    expect(candidate).toEqual({
      sourceMessageId: "msg-1",
      optionsHash: buildOptionsHash(["继续修 token", "整理检查清单"]),
      recommendedText: "继续修 token",
      startedAt: 1000,
      durationMs: 10_000,
    });
  });
});
