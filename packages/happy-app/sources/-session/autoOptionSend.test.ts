import { describe, expect, it } from "vitest";
import {
  buildAutoOptionCandidate,
  buildAutoSentKey,
  buildOptionsHash,
  createInitialAutoOptionSendState,
  extractContextKeywords,
  getRecommendedOptionIndex,
  normalizeOptionText,
  rankAndSelectOptions,
  reduceAutoOptionSendEvent,
  type AutoOptionSendContext,
  type AutoOptionCandidate,
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

  it("normalizeOptionText 统一空白和大小写", () => {
    expect(normalizeOptionText("  Hello  World ")).toBe("hello world");
    expect(normalizeOptionText("继续\t修复")).toBe("继续 修复");
    expect(normalizeOptionText("")).toBe("");
  });

  it("buildAutoSentKey 生成唯一键", () => {
    const candidate: AutoOptionCandidate = {
      sourceMessageId: "msg-1",
      optionsHash: '["a","b"]',
      recommendedText: "a",
      startedAt: 1000,
      durationMs: 10000,
      qualityScore: 80,
      qualityReasons: ["source-priority-1"],
    };
    expect(buildAutoSentKey(candidate)).toBe('msg-1:["a","b"]:a');
  });

  it("buildAutoSentKey 处理 null sourceMessageId", () => {
    const candidate: AutoOptionCandidate = {
      sourceMessageId: null,
      optionsHash: '["x"]',
      recommendedText: "x",
      startedAt: 0,
      durationMs: 5000,
      qualityScore: 70,
      qualityReasons: [],
    };
    expect(buildAutoSentKey(candidate)).toBe('none:["x"]:x');
  });

  it("用户正在输入时不会进入 armed", () => {
    const next = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext({ inputText: "typing..." }),
    );
    expect(next.enabled).toBe(true);
    expect(next.status).toBe("idle");
  });

  it("有待处理图片时不会进入 armed", () => {
    const next = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext({ hasPendingImages: true }),
    );
    expect(next.enabled).toBe(true);
    expect(next.status).toBe("idle");
  });

  it("STT 监听中不会进入 armed", () => {
    const next = reduceAutoOptionSendEvent(
      createInitialAutoOptionSendState(),
      { type: "toggle", enabled: true },
      createContext({ isSttListening: true }),
    );
    expect(next.enabled).toBe(true);
    expect(next.status).toBe("idle");
  });

  it("空洞选项被黑名单拦截，高质量选项仍可推荐（中文）", () => {
    expect(getRecommendedOptionIndex(["继续", "整理检查清单"])).toBeNull();
    expect(getRecommendedOptionIndex(["好的", "开始部署"])).toBeNull();
    expect(getRecommendedOptionIndex(["确认", "下一步"])).toBeNull();
    expect(getRecommendedOptionIndex(["ok", "继续修复 token"])).toBe(1);
  });

  it("空洞选项被黑名单拦截，低质量选项不推荐（英文）", () => {
    expect(getRecommendedOptionIndex(["continue", "Fix the auth bug"])).toBeNull();
    expect(getRecommendedOptionIndex(["go ahead", "Deploy to staging"])).toBeNull();
    expect(getRecommendedOptionIndex(["run tests", "Fix failing specs"])).toBeNull();
    expect(getRecommendedOptionIndex(["fix it", "Refactor auth module"])).toBeNull();
    expect(getRecommendedOptionIndex(["ship it", "Run integration tests"])).toBeNull();
  });

  it("动词后缺乏目标的选项被惩罚", () => {
    const result = rankAndSelectOptions(["继续修", "整理检查清单"]);
    const first = result.ranked.find((r) => r.text === "继续修");
    expect(first?.passed).toBe(false);
    expect(first?.reasons).toContain("vague-no-target");
  });

  it("fix bug 英文过短目标被惩罚", () => {
    const result = rankAndSelectOptions(["fix bug", "Refactor the module"]);
    const first = result.ranked.find((r) => r.text === "fix bug");
    expect(first?.passed).toBe(false);
    expect(first?.reasons).toContain("vague-no-target");
  });

  it("有明确目标的动词选项不被惩罚", () => {
    const result = rankAndSelectOptions(["继续修复 auth 模块", "整理检查清单"]);
    const first = result.ranked.find((r) => r.text === "继续修复 auth 模块");
    expect(first?.passed).toBe(true);
    expect(first?.reasons).not.toContain("vague-no-target");
  });

  it("含文件名的选项获得技术具体性加分", () => {
    const result = rankAndSelectOptions(["修复 autoOptionSend.ts 的评分逻辑", "跳过"]);
    const first = result.ranked.find((r) => r.text === "修复 autoOptionSend.ts 的评分逻辑");
    expect(first?.passed).toBe(true);
    expect(first?.reasons).toContain("technical-specificity");
  });

  it("含函数调用的选项获得技术具体性加分", () => {
    const result = rankAndSelectOptions(["优化 scoreOption() 的权重计算", "跳过"]);
    const first = result.ranked.find((r) => r.text === "优化 scoreOption() 的权重计算");
    expect(first?.passed).toBe(true);
    expect(first?.reasons).toContain("technical-specificity");
  });

  it("含领域关键词且足够长的中文选项获得领域具体性加分", () => {
    const result = rankAndSelectOptions(["修复认证模块的 token 刷新逻辑", "跳过"]);
    const first = result.ranked.find((r) => r.text === "修复认证模块的 token 刷新逻辑");
    expect(first?.passed).toBe(true);
    expect(first?.reasons).toContain("domain-specificity");
  });

  it("中英混合技术词获得混合语言加分", () => {
    const result = rankAndSelectOptions(["继续修 token", "整理检查清单"]);
    const first = result.ranked.find((r) => r.text === "继续修 token");
    expect(first?.passed).toBe(true);
    expect(first?.reasons).toContain("mixed-lang-technical");
  });

  it("复合动作中尾部含动词的选项获得 compound-action 加分", () => {
    const result = rankAndSelectOptions(["看日志后继续定位", "总结原因"]);
    const first = result.ranked.find((r) => r.text === "看日志后继续定位");
    expect(first?.passed).toBe(true);
    expect(first?.reasons).toContain("compound-action");
  });

  it("长描述选项获得 detailed 加分", () => {
    const result = rankAndSelectOptions([
      "继续修复 auth 模块的 token 刷新逻辑并运行集成测试",
      "跳过",
    ]);
    const first = result.ranked[0];
    expect(first?.reasons).toContain("detailed");
  });

  it("extractContextKeywords 从文本中提取技术关键词", () => {
    const keywords = extractContextKeywords([
      "修改了 autoOptionSend.ts 中的 scoreOption 函数",
      "使用 buildAutoSentKey 构建唯一键",
    ]);
    expect(keywords.has("autooptionsend.ts")).toBe(true);
    expect(keywords.has("scoreoption")).toBe(true);
    expect(keywords.has("buildautosentkey")).toBe(true);
  });

  it("上下文关联选项获得 context-match 加分", () => {
    const ctx = new Set(["scoreoption", "autooptionsend.ts"]);
    const result = rankAndSelectOptions(
      ["优化 scoreOption 的权重计算", "部署到生产环境"],
      undefined,
      ctx,
    );
    const matched = result.ranked.find((r) => r.text === "优化 scoreOption 的权重计算");
    expect(matched?.reasons).toContain("context-match");
  });

  it("多个上下文关键词命中获得 context-match-strong 加分", () => {
    const ctx = new Set(["scoreoption", "autooptionsend.ts"]);
    const result = rankAndSelectOptions(
      ["重构 autoOptionSend.ts 中的 scoreOption 逻辑", "跳过"],
      undefined,
      ctx,
    );
    const matched = result.ranked.find((r) => r.text.includes("scoreOption"));
    expect(matched?.reasons).toContain("context-match-strong");
  });

  it("无上下文关键词时不影响评分", () => {
    const result = rankAndSelectOptions(
      ["继续修 token", "整理检查清单"],
      undefined,
      new Set(),
    );
    const first = result.ranked.find((r) => r.text === "继续修 token");
    expect(first?.reasons).not.toContain("context-match");
    expect(first?.reasons).not.toContain("context-match-strong");
  });
});
