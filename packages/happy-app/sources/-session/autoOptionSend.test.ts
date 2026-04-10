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
      lastAutoSentKey: null,
      lastCancelReason: null,
      shouldSendText: null,
    });
  });

  it("打开自动模式时若当前还不能 arm 会进入待命状态", () => {
    const next = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext({ snapshot: null }),
    );

    expect(next.enabled).toBe(true);
    expect(next.status).toBe("idle");
    expect(next.candidate).toBeNull();
    expect(next.remainingMs).toBeNull();
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

  it("没有 options 时打开开关会进入待命状态", () => {
    const next = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext({ snapshot: null }),
    );

    expect(next.enabled).toBe(true);
    expect(next.status).toBe("idle");
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
    expect(fired.status).toBe("idle");
    expect(fired.enabled).toBe(true);
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
    expect(next.status).toBe("idle");
    expect(next.enabled).toBe(true);
  });

  it("同一轮 candidate 不会再次自动发送", () => {
    const state = {
      ...createInitialAutoOptionSendState(),
      lastAutoSentText: "继续修 token",
      lastAutoSentKey:
        'msg-1:["继续修 token","整理检查清单"]:继续修 token',
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
    expect(next.status).toBe("idle");
    expect(next.enabled).toBe(true);
  });

  it("自动发送后保持 on 并进入待命状态", () => {
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

    const fired = reduceAutoOptionSendEvent(
      ready,
      { type: "attempt-fire" },
      createContext({ now: 11_000 }),
    );

    expect(fired.shouldSendText).toBe("继续修 token");
    expect(fired.enabled).toBe(true);
    expect(fired.status).toBe("idle");
    expect(fired.candidate).toBeNull();
  });

  it("ready 状态收到同一组 options 不会重新计时", () => {
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

    const next = reduceAutoOptionSendEvent(
      ready,
      { type: "options-updated" },
      createContext({ now: 11_100 }),
    );

    expect(next.status).toBe("ready");
    expect(next.remainingMs).toBe(0);
    expect(next.candidate?.recommendedText).toBe("继续修 token");
  });
  it("待命状态在 options 暂时消失时保持开启", () => {
    const next = reduceAutoOptionSendEvent(
      {
        ...createInitialAutoOptionSendState(),
        enabled: true,
        status: "idle",
        lastAutoSentText: "继续修 token",
      },
      { type: "context-invalidated", reason: "options-missing" },
      createContext({ snapshot: null }),
    );

    expect(next.enabled).toBe(true);
    expect(next.status).toBe("idle");
    expect(next.candidate).toBeNull();
    expect(next.lastAutoSentText).toBe("继续修 token");
  });
  it("待命状态遇到新 options 后会重新进入 armed", () => {
    const next = reduceAutoOptionSendEvent(
      {
        ...createInitialAutoOptionSendState(),
        enabled: true,
        status: "idle",
        lastAutoSentText: "继续修 token",
      },
      { type: "options-updated" },
      createContext({
        now: 12_000,
        snapshot: {
          sourceType: "markdown-options",
          sourceMessageId: "msg-2",
          items: ["继续补阶段 B", "整理检查清单"],
          recommendedIndex: 0,
          optionsHash: buildOptionsHash(["继续补阶段 B", "整理检查清单"]),
        },
      }),
    );

    expect(next.enabled).toBe(true);
    expect(next.status).toBe("armed");
    expect(next.candidate?.recommendedText).toBe("继续补阶段 B");
    expect(next.remainingMs).toBe(10_000);
  });
  it("新一轮 options 即使首项文本相同也可以再次自动发送", () => {
    const firstCycleReady = reduceAutoOptionSendEvent(
      reduceAutoOptionSendEvent(
        createInitialAutoOptionSendState(),
        { type: "toggle", enabled: true },
        createContext(),
      ),
      { type: "timer-finished" },
      createContext({ now: 11_000 }),
    );

    const afterFirstSend = reduceAutoOptionSendEvent(
      firstCycleReady,
      { type: "attempt-fire" },
      createContext({ now: 11_000 }),
    );

    const secondCycleArmed = reduceAutoOptionSendEvent(
      { ...afterFirstSend, shouldSendText: null },
      { type: "options-updated" },
      createContext({
        now: 12_000,
        snapshot: {
          sourceType: "markdown-options",
          sourceMessageId: "msg-2",
          items: ["继续修 token", "整理新的检查清单"],
          recommendedIndex: 0,
          optionsHash: buildOptionsHash(["继续修 token", "整理新的检查清单"]),
        },
      }),
    );

    expect(secondCycleArmed.status).toBe("armed");

    const secondCycleReady = reduceAutoOptionSendEvent(
      secondCycleArmed,
      { type: "timer-finished" },
      createContext({
        now: 22_000,
        snapshot: {
          sourceType: "markdown-options",
          sourceMessageId: "msg-2",
          items: ["继续修 token", "整理新的检查清单"],
          recommendedIndex: 0,
          optionsHash: buildOptionsHash(["继续修 token", "整理新的检查清单"]),
        },
      }),
    );

    const secondCycleFired = reduceAutoOptionSendEvent(
      secondCycleReady,
      { type: "attempt-fire" },
      createContext({
        now: 22_000,
        snapshot: {
          sourceType: "markdown-options",
          sourceMessageId: "msg-2",
          items: ["继续修 token", "整理新的检查清单"],
          recommendedIndex: 0,
          optionsHash: buildOptionsHash(["继续修 token", "整理新的检查清单"]),
        },
      }),
    );

    expect(secondCycleFired.shouldSendText).toBe("继续修 token");
    expect(secondCycleFired.status).toBe("idle");
  });

  it("发送后待命时遇到同一轮 options 会保持 idle，不重新倒计时", () => {
    const firstCycleReady = reduceAutoOptionSendEvent(
      reduceAutoOptionSendEvent(
        createInitialAutoOptionSendState(),
        { type: "toggle", enabled: true },
        createContext(),
      ),
      { type: "timer-finished" },
      createContext({ now: 11_000 }),
    );

    const idle = reduceAutoOptionSendEvent(
      firstCycleReady,
      { type: "attempt-fire" },
      createContext({ now: 11_000 }),
    );

    const next = reduceAutoOptionSendEvent(
      { ...idle, shouldSendText: null },
      { type: "options-updated" },
      createContext({ now: 11_100 }),
    );

    expect(next.enabled).toBe(true);
    expect(next.status).toBe("idle");
    expect(next.candidate).toBeNull();
    expect(next.remainingMs).toBeNull();
  });

  it("armed 状态遇到 options 暂时消失会降级到 idle 而不是关闭", () => {
    const armed = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext(),
    );

    const next = reduceAutoOptionSendEvent(
      armed,
      { type: "context-invalidated", reason: "options-missing" },
      createContext({ snapshot: null }),
    );

    expect(next.enabled).toBe(true);
    expect(next.status).toBe("idle");
    expect(next.candidate).toBeNull();
    expect(next.remainingMs).toBeNull();
  });

  it("ready 状态遇到 options 暂时消失会降级到 idle 而不是关闭", () => {
    const ready = reduceAutoOptionSendEvent(
      reduceAutoOptionSendEvent(
        createInitialAutoOptionSendState(),
        { type: "toggle", enabled: true },
        createContext(),
      ),
      { type: "timer-finished" },
      createContext({ now: 11_000 }),
    );

    const next = reduceAutoOptionSendEvent(
      ready,
      { type: "context-invalidated", reason: "options-missing" },
      createContext({ snapshot: null, now: 11_100 }),
    );

    expect(next.enabled).toBe(true);
    expect(next.status).toBe("idle");
    expect(next.candidate).toBeNull();
    expect(next.remainingMs).toBeNull();
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
