import { describe, expect, it } from "vitest";
import {
  buildAutoOptionCandidate,
  buildOptionsHash,
  createInitialAutoOptionSendState,
  getRecommendedOptionIndex,
  rankAndSelectOptions,
  reduceAutoOptionSendEvent,
  type AutoOptionSendContext,
  type AutoOptionFeedbackStats,
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

  it("纯查看型选项不会被推荐（精确匹配）", () => {
    expect(getRecommendedOptionIndex(["查看 diff", "继续修 token"])).toBeNull();
    expect(getRecommendedOptionIndex(["看日志", "继续排查"])).toBeNull();
    expect(getRecommendedOptionIndex(["浏览输出", "整理结论"])).toBeNull();
  });

  it("纯查看型选项不会被推荐（关键词模式匹配）", () => {
    expect(getRecommendedOptionIndex(["给我列当前这次修复涉及的文件", "继续修 token"])).toBeNull();
    expect(getRecommendedOptionIndex(["列出改动文件", "整理结论"])).toBeNull();
    expect(getRecommendedOptionIndex(["列举这次涉及的模块", "继续排查"])).toBeNull();
    expect(getRecommendedOptionIndex(["查看这次提交的关键改动摘要", "继续"])).toBeNull();
    expect(getRecommendedOptionIndex(["看一下当前的测试覆盖率", "修复测试"])).toBeNull();
    expect(getRecommendedOptionIndex(["检查当前工作区状态", "提交代码"])).toBeNull();
    expect(getRecommendedOptionIndex(["显示所有改动的文件", "开始重构"])).toBeNull();
  });

  it("纯查看型选项不会被推荐（英文关键词）", () => {
    expect(getRecommendedOptionIndex(["View the diff", "Run tests"])).toBeNull();
    expect(getRecommendedOptionIndex(["Review the changes", "Deploy"])).toBeNull();
    expect(getRecommendedOptionIndex(["Check current workspace status", "Commit"])).toBeNull();
    expect(getRecommendedOptionIndex(["Show all modified files", "Start refactoring"])).toBeNull();
    expect(getRecommendedOptionIndex(["Display the error output", "Fix tests"])).toBeNull();
    expect(getRecommendedOptionIndex(["List the affected modules", "Continue"])).toBeNull();
    expect(getRecommendedOptionIndex(["Browse the logs", "Retry deploy"])).toBeNull();
    expect(getRecommendedOptionIndex(["Inspect the build output", "Fix errors"])).toBeNull();
    expect(getRecommendedOptionIndex(["view diff", "run tests"])).toBeNull();
    expect(getRecommendedOptionIndex(["LIST changed files", "commit"])).toBeNull();
  });

  it("复合动作首项不会被误伤", () => {
    expect(getRecommendedOptionIndex(["查看 diff 并修复回归", "整理检查清单"])).toBe(0);
    expect(getRecommendedOptionIndex(["看日志后继续定位", "总结原因"])).toBe(0);
    expect(getRecommendedOptionIndex(["检查并修复类型错误", "跳过"])).toBe(0);
    expect(getRecommendedOptionIndex(["列出问题并逐个修复", "跳过"])).toBe(0);
    expect(getRecommendedOptionIndex(["View diff and fix regressions", "Skip"])).toBe(0);
    expect(getRecommendedOptionIndex(["Check logs then continue debugging", "Summarize"])).toBe(0);
    expect(getRecommendedOptionIndex(["Review and fix type errors", "Skip"])).toBe(0);
    expect(getRecommendedOptionIndex(["List issues and fix them one by one", "Skip"])).toBe(0);
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

  it("纯查看型首项时打开开关会保持 idle，不进入 armed", () => {
    const next = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext({
        snapshot: {
          sourceType: "markdown-options",
          sourceMessageId: "msg-1",
          items: ["查看 diff", "继续修 token"],
          recommendedIndex: 0,
          optionsHash: buildOptionsHash(["查看 diff", "继续修 token"]),
        },
      }),
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
  });

  it("候选构建会包含质量分数", () => {
    const candidate = buildAutoOptionCandidate(createContext());
    expect(candidate).not.toBeNull();
    expect(candidate?.qualityScore).toBeGreaterThanOrEqual(70);
    expect(candidate?.qualityReasons.length).toBeGreaterThan(0);
  });

  it("历史负反馈高时会取消推荐", () => {
    const statsResolver = (): AutoOptionFeedbackStats => ({
      send: 0,
      editSend: 0,
      timeoutIgnore: 3,
      dismiss: 2,
      total: 5,
    });

    expect(
      getRecommendedOptionIndex(["继续修 token", "整理检查清单"], statsResolver),
    ).toBeNull();
  });

  it("rankAndSelectOptions 会去重并保留 top3", () => {
    const result = rankAndSelectOptions([
      "继续修 token",
      "继续修 token",
      "运行测试",
      "更新文档",
      "提交代码",
    ]);

    expect(result.ranked.length).toBeLessThanOrEqual(3);
    expect(result.ranked.map((item) => item.text)).toContain("继续修 token");
  });
});
