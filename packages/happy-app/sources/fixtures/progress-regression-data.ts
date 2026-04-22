import type { Message, ToolCall, ToolCallMessage } from "@/sync/typesMessage";
import type { Metadata } from "@/sync/storageTypes";

const BASE_TIME = Date.now();

function at(offsetMs: number): number {
  return BASE_TIME - offsetMs;
}

function createToolCall(
  name: string,
  state: ToolCall["state"],
  input: any,
  opts: {
    createdAtOffset: number;
    startedAtOffset?: number | null;
    completedAtOffset?: number | null;
    description?: string | null;
    result?: any;
  },
): ToolCall {
  return {
    name,
    state,
    input,
    createdAt: at(opts.createdAtOffset),
    startedAt:
      opts.startedAtOffset === undefined
        ? at(opts.createdAtOffset - 120)
        : opts.startedAtOffset === null
          ? null
          : at(opts.startedAtOffset),
    completedAt:
      opts.completedAtOffset === undefined
        ? state === "completed" || state === "error"
          ? at(Math.max(0, opts.createdAtOffset - 800))
          : null
        : opts.completedAtOffset === null
          ? null
          : at(opts.completedAtOffset),
    description: opts.description ?? null,
    ...(opts.result !== undefined ? { result: opts.result } : {}),
  };
}

function createToolMessage(
  id: string,
  tool: ToolCall,
  children: Message[] = [],
): ToolCallMessage {
  return {
    kind: "tool-call",
    id,
    localId: null,
    createdAt: tool.createdAt,
    tool,
    children,
  };
}

export const progressRegressionMetadata: Metadata = {
  path: "/Users/sangreal/Documents/dev-workspace/happy",
  host: "sangreal-mac",
  flavor: "codex",
};

export const progressRegressionMessages: Message[] = [
  {
    kind: "agent-event",
    id: "reg-ready-1",
    createdAt: at(1000),
    event: {
      type: "ready",
      model: "gpt-5.4",
      durationMs: 54200,
      numTurns: 1,
      modelUsage: {
        "gpt-5.4": {
          inputTokens: 21000,
          outputTokens: 1800,
          cacheReadInputTokens: 9200,
          cacheCreationInputTokens: 700,
          costUSD: 0.42,
          contextWindow: 1000000,
          maxOutputTokens: 16000,
        },
      },
      totalCostUsd: 0.42,
    },
  },
  createToolMessage(
    "reg-tool-progress-2",
    createToolCall(
      "mcp__happy__update_progress",
      "completed",
      {
        currentStage: "统一时间线摘要文案与折叠策略",
        label: "Progress/Timeline 视觉收口",
        todos: [
          {
            content: "确认真实 UI 回归路径和可复现数据源",
            status: "completed",
            stage: "定位",
          },
          {
            content: "统一 Progress explanation、当前焦点与 checklist 层级",
            status: "in_progress",
            activeForm: "正在统一 explanation、当前焦点与 checklist 层级",
            stage: "实现",
          },
          {
            content: "给 explanation 增加折叠/展开",
            status: "completed",
            stage: "实现",
          },
          {
            content: "给 checklist 增加默认前缀显示与展开全部",
            status: "completed",
            stage: "实现",
          },
          {
            content: "统一 turn 时间线的折叠逻辑",
            status: "completed",
            stage: "实现",
          },
          {
            content: "把隐藏步骤摘要收紧为 top 2 + other",
            status: "completed",
            stage: "实现",
          },
          {
            content: "在真实浏览器里验证长 explanation、长 checklist、长时间线组合效果",
            status: "completed",
            stage: "验证",
          },
        ],
        blockers: [
          "真实会话在 web 端不稳定复现，需要一个 dev-only 回归场景页承接浏览器验证。",
          "如果再继续堆 chips 和摘要，卡片会从产品组件退回调试器观感。",
        ],
      },
      {
        createdAtOffset: 2200,
        completedAtOffset: 1800,
        result: "Progress updated (7 items).",
      },
    ),
  ),
  createToolMessage(
    "reg-tool-progress-1",
    createToolCall(
      "mcp__happy__update_progress",
      "completed",
      {
        currentStage: "统一时间线摘要文案与折叠策略",
        label: "Progress/Timeline 视觉收口",
        todos: [
          {
            content: "确认真实 UI 回归路径和可复现数据源",
            status: "completed",
          },
          {
            content: "统一 Progress explanation、当前焦点与 checklist 层级",
            status: "completed",
          },
          {
            content: "给 explanation 增加折叠/展开",
            status: "completed",
          },
          {
            content: "给 checklist 增加默认前缀显示与展开全部",
            status: "completed",
          },
          {
            content: "统一 turn 时间线的折叠逻辑",
            status: "completed",
          },
          {
            content: "把隐藏步骤摘要收紧为 top 2 + other",
            status: "completed",
          },
          {
            content: "在真实浏览器里验证长 explanation、长 checklist、长时间线组合效果",
            status: "in_progress",
          },
        ],
      },
      {
        createdAtOffset: 3200,
        completedAtOffset: 2600,
        result: "Progress updated (7 items).",
      },
    ),
  ),
  createToolMessage(
    "reg-tool-diff-1",
    createToolCall(
      "CodexDiff",
      "completed",
      {
        unified_diff: [
          "diff --git a/TurnTimelineMessageView.tsx b/TurnTimelineMessageView.tsx",
          "@@ -310,6 +328,22 @@",
          "-  const hidden = collapsedCount;",
          "+  const hiddenSummary = topTwoKinds(hiddenSteps);",
          "+  const hiddenOther = hiddenSteps.length - hiddenSummary.count;",
          "+  // show top2 + other chip",
        ].join("\n"),
      },
      {
        createdAtOffset: 4300,
        completedAtOffset: 3500,
        result: { status: "completed" },
      },
    ),
  ),
  createToolMessage(
    "reg-tool-write-1",
    createToolCall(
      "CodexBash",
      "completed",
      {
        command: 'python - <<\'PY\'\nprint("patched progress card")\nPY',
        description: "Patch progress card layout",
      },
      {
        createdAtOffset: 5200,
        completedAtOffset: 4300,
        description: "Patch progress card layout",
        result: "patched progress card",
      },
    ),
  ),
  createToolMessage(
    "reg-tool-search-1",
    createToolCall(
      "CodexBash",
      "completed",
      {
        command: "rg -n \"progressShowAll|showLess|collapse|expand\" packages/happy-app/sources/text -S",
        description: "Search reusable expand/collapse copy",
      },
      {
        createdAtOffset: 6100,
        completedAtOffset: 5400,
        description: "Search reusable expand/collapse copy",
        result: "packages/happy-app/sources/text/_default.ts:642: progressShowAll\npackages/happy-app/sources/text/_default.ts:1086: showLess",
      },
    ),
  ),
  createToolMessage(
    "reg-tool-read-1",
    createToolCall(
      "CodexBash",
      "completed",
      {
        command: "sed -n '1,260p' packages/happy-app/sources/components/TurnTimelineMessageView.tsx",
        description: "Read TurnTimelineMessageView",
      },
      {
        createdAtOffset: 7200,
        completedAtOffset: 6500,
        description: "Read TurnTimelineMessageView",
        result: "import * as React from \"react\";\n// ...snip...",
      },
    ),
  ),
  {
    kind: "agent-text",
    id: "reg-thinking-1",
    localId: null,
    createdAt: at(8400),
    text: [
      "## 回归思路",
      "",
      "先别急着在真实会话页里乱点。当前真正要验证的是：",
      "",
      "1. 长 explanation 会不会把头部撑成废话墙",
      "2. checklist 默认折叠后是否仍能保留未完成项可见",
      "3. 时间线的隐藏摘要在 top 2 + other 之后是否还保持可读",
      "",
      "如果这三者一起出现仍然顺眼，才说明这轮收口不是自我感动。",
    ].join("\n"),
    isThinking: true,
  },
  {
    kind: "agent-text",
    id: "reg-plan-preview-1",
    localId: null,
    createdAt: at(9000),
    text: [
      "这轮回归的核心不是再堆字段，而是确认 explanation、当前焦点、checklist、时间线摘要在同一张卡片里不会互相抢戏；如果它们开始抢戏，说明信息架构还没真的收住。这里还要额外确认：长说明默认折叠后，用户仍然能快速判断值不值得展开，而不是被迫先读完一大段才理解卡片在说什么。\n同时也要确认 checklist 和时间线的展开控件不会互相抢注意力，否则这轮所谓收口只是把混乱换了个位置。",
      "[completed] 确认真实 UI 回归路径和可复现数据源",
      "[in_progress] 统一 Progress explanation、当前焦点与 checklist 层级",
      "[completed] 给 explanation 增加折叠/展开",
      "[completed] 给 checklist 增加默认前缀显示与展开全部",
      "[completed] 统一 turn 时间线的折叠逻辑",
      "[completed] 把隐藏步骤摘要收紧为 top 2 + other",
      "[completed] 在真实浏览器里验证长 explanation、长 checklist、长时间线组合效果",
    ].join("\n"),
  },
  {
    kind: "user-text",
    id: "reg-user-1",
    realId: null,
    localId: null,
    createdAt: at(12000),
    text: "帮我做一次真实 UI 回归，专看长时间线/长 checklist/长 explanation 的组合效果。",
  },
];
