import { describe, expect, it } from "vitest";

import {
  buildChatDisplayItems,
  collapseTurnTimelineSteps,
  isTurnTimelineDisplayItem,
} from "./chatTimelineDisplay";
import type { AgentTextMessage, Message, ToolCallMessage } from "@/sync/typesMessage";

function createThinkingMessage(id: string, createdAt: number): AgentTextMessage {
  return {
    kind: "agent-text",
    id,
    localId: null,
    createdAt,
    text: "## Thinking\nPlan the next step",
    isThinking: true,
  };
}

function createToolCallMessage(id: string, createdAt: number): ToolCallMessage {
  return {
    kind: "tool-call",
    id,
    localId: null,
    createdAt,
    tool: {
      name: "mcp__happy__update_progress",
      state: "completed",
      input: { todos: [{ content: "A", status: "completed" }] },
      createdAt,
      startedAt: createdAt,
      completedAt: createdAt + 10,
      description: null,
      result: "ok",
    },
    children: [],
  };
}

function createReadyEvent(id: string, createdAt: number): Message {
  return {
    kind: "agent-event",
    id,
    createdAt,
    event: {
      type: "ready",
      model: "gpt-5.4",
      durationMs: 1200,
      numTurns: 1,
    },
  };
}

describe("buildChatDisplayItems", () => {
  it("groups thinking and tool-call messages into one turn timeline", () => {
    const messages: Message[] = [
      createReadyEvent("ready-1", 40),
      createToolCallMessage("tool-1", 30),
      createThinkingMessage("thinking-1", 20),
      {
        kind: "user-text",
        id: "user-1",
        realId: null,
        localId: null,
        createdAt: 10,
        text: "Hi",
      },
    ];

    const displayItems = buildChatDisplayItems(messages, {
      showThinkingTimeline: true,
    });

    expect(displayItems).toHaveLength(3);
    expect(isTurnTimelineDisplayItem(displayItems[0]!)).toBe(true);
    if (isTurnTimelineDisplayItem(displayItems[0]!)) {
      expect(displayItems[0].readyMessage.id).toBe("ready-1");
      expect(displayItems[0].steps.map((step) => step.message.id)).toEqual([
        "thinking-1",
        "tool-1",
      ]);
    }
    expect(displayItems[1]!.kind).toBe("turn-start-separator");
  });

  it("keeps messages separate when there is no thinking step", () => {
    const messages: Message[] = [
      createReadyEvent("ready-1", 30),
      createToolCallMessage("tool-1", 20),
      {
        kind: "user-text",
        id: "user-1",
        realId: null,
        localId: null,
        createdAt: 10,
        text: "Hi",
      },
    ];

    const displayItems = buildChatDisplayItems(messages, {
      showThinkingTimeline: true,
    });

    expect(displayItems).toHaveLength(4);
    expect(isTurnTimelineDisplayItem(displayItems[0]!)).toBe(false);
  });

  it("returns original messages when thinking timeline is disabled", () => {
    const messages: Message[] = [
      createReadyEvent("ready-1", 40),
      createToolCallMessage("tool-1", 30),
      createThinkingMessage("thinking-1", 20),
    ];

    const displayItems = buildChatDisplayItems(messages, {
      showThinkingTimeline: false,
    });

    expect(displayItems).toEqual(messages);
  });

  it("hides legacy plan preview text when an equivalent progress tool card exists in the same turn", () => {
    const messages: Message[] = [
      createThinkingMessage("thinking-hide-1", 50),
      {
        kind: "agent-text",
        id: "plan-preview-1",
        localId: null,
        createdAt: 40,
        text: [
          "第二版已实现：ChatList 现在会把同一 turn 中可见的 thinking 与 tool-call 合并成一个统一时间线块",
          "[completed] 梳理 ChatList / MessageView 中 thinking 与 tool-call 的渲染链路",
          "[completed] 实现统一时间线块，合并 thinking 与 tool-call 展示",
          "[completed] 补测试并做最小验证",
        ].join("\n"),
      },
      {
        kind: "tool-call",
        id: "progress-tool-1",
        localId: null,
        createdAt: 30,
        tool: {
          name: "mcp__happy__update_progress",
          state: "completed",
          input: {
            currentStage: "第二版已完成",
            todos: [
              {
                content: "梳理 ChatList / MessageView 中 thinking 与 tool-call 的渲染链路",
                status: "completed",
              },
              {
                content: "实现统一时间线块，合并 thinking 与 tool-call 展示",
                status: "completed",
              },
              {
                content: "补测试并做最小验证",
                status: "completed",
              },
            ],
          },
          createdAt: 30,
          startedAt: 30,
          completedAt: 60,
          description: null,
          result: "ok",
        },
        children: [],
      },
      {
        kind: "user-text",
        id: "user-1",
        realId: null,
        localId: null,
        createdAt: 10,
        text: "继续做第二版",
      },
    ];

    const displayItems = buildChatDisplayItems(messages, {
      showThinkingTimeline: true,
    });

    expect(displayItems).toHaveLength(4);
    expect(displayItems.some((item) => item.id === "plan-preview-1")).toBe(false);
    expect(displayItems.some((item) => item.id === "progress-tool-1")).toBe(true);
    expect(displayItems.some((item) => item.id === "thinking-hide-1")).toBe(true);
    const progressTool = displayItems.find(
      (item) => item.id === "progress-tool-1",
    ) as Message | undefined;
    expect(progressTool && progressTool.kind === "tool-call"
      ? progressTool.tool.input._derivedExplanation
      : null).toBe(
      "第二版已实现：ChatList 现在会把同一 turn 中可见的 thinking 与 tool-call 合并成一个统一时间线块",
    );
  });

  it("keeps plan preview visible when refresh only restores progress updates without replacement process content", () => {
    const messages: Message[] = [
      {
        kind: "agent-text",
        id: "plan-preview-refresh",
        localId: null,
        createdAt: 40,
        text: [
          "第二版已实现：ChatList 现在会把同一 turn 中可见的 thinking 与 tool-call 合并成一个统一时间线块",
          "[completed] 梳理 ChatList / MessageView 中 thinking 与 tool-call 的渲染链路",
          "[completed] 实现统一时间线块，合并 thinking 与 tool-call 展示",
          "[completed] 补测试并做最小验证",
        ].join("\n"),
      },
      {
        kind: "tool-call",
        id: "progress-tool-refresh",
        localId: null,
        createdAt: 30,
        tool: {
          name: "mcp__happy__update_progress",
          state: "completed",
          input: {
            currentStage: "第二版已完成",
            todos: [
              {
                content: "梳理 ChatList / MessageView 中 thinking 与 tool-call 的渲染链路",
                status: "completed",
              },
              {
                content: "实现统一时间线块，合并 thinking 与 tool-call 展示",
                status: "completed",
              },
              {
                content: "补测试并做最小验证",
                status: "completed",
              },
            ],
          },
          createdAt: 30,
          startedAt: 30,
          completedAt: 60,
          description: null,
          result: "ok",
        },
        children: [],
      },
      {
        kind: "user-text",
        id: "user-refresh",
        realId: null,
        localId: null,
        createdAt: 10,
        text: "刷新后看看",
      },
    ];

    const displayItems = buildChatDisplayItems(messages, {
      showThinkingTimeline: true,
    });

    expect(displayItems.map((item) => item.id)).toEqual([
      "plan-preview-refresh",
      "progress-tool-refresh",
      "turn-start:user-refresh",
      "user-refresh",
    ]);
  });

  it("collapses completed timeline tail but keeps non-completed tool steps visible", () => {
    const thinking = createThinkingMessage("thinking-1", 10);
    const runningTool = {
      kind: "tool-call" as const,
      id: "tool-running",
      localId: null,
      createdAt: 50,
      tool: {
        name: "Bash",
        state: "running" as const,
        input: {},
        createdAt: 50,
        startedAt: 50,
        completedAt: null,
        description: null,
      },
      children: [],
    };

    const result = collapseTurnTimelineSteps([
      { kind: "thinking", message: thinking },
      { kind: "tool-call", message: createToolCallMessage("tool-1", 20) as any },
      { kind: "tool-call", message: createToolCallMessage("tool-2", 30) as any },
      { kind: "tool-call", message: createToolCallMessage("tool-3", 40) as any },
      { kind: "tool-call", message: runningTool as any },
      { kind: "tool-call", message: createToolCallMessage("tool-4", 60) as any },
    ]);

    expect(result.visibleSteps.map((step) => step.message.id)).toEqual([
      "thinking-1",
      "tool-1",
      "tool-2",
      "tool-3",
      "tool-running",
    ]);
    expect(result.hiddenCount).toBe(1);
    expect(result.didCollapse).toBe(true);
  });

  it("collapses after the default prefix when every timeline step is completed", () => {
    const result = collapseTurnTimelineSteps([
      { kind: "thinking", message: createThinkingMessage("thinking-1", 10) },
      { kind: "tool-call", message: createToolCallMessage("tool-1", 20) as any },
      { kind: "tool-call", message: createToolCallMessage("tool-2", 30) as any },
      { kind: "tool-call", message: createToolCallMessage("tool-3", 40) as any },
      { kind: "tool-call", message: createToolCallMessage("tool-4", 50) as any },
      { kind: "tool-call", message: createToolCallMessage("tool-5", 60) as any },
    ]);

    expect(result.visibleSteps.map((step) => step.message.id)).toEqual([
      "thinking-1",
      "tool-1",
      "tool-2",
      "tool-3",
    ]);
    expect(result.hiddenCount).toBe(2);
    expect(result.didCollapse).toBe(true);
  });
});

import {
  buildVisibleChatDisplayItems,
  groupToolCallItems,
  type FinalChatDisplayItem,
} from "./chatTimelineDisplay";
import type { UserTextMessage } from "@/sync/typesMessage";

function createNamedToolCall(
  id: string,
  createdAt: number,
  name: string,
  state: "running" | "completed" = "completed",
): ToolCallMessage {
  return {
    kind: "tool-call",
    id,
    localId: null,
    createdAt,
    tool: {
      name,
      state,
      input: {},
      createdAt,
      startedAt: createdAt,
      completedAt: state === "completed" ? createdAt + 10 : null,
      description: null,
      result: state === "completed" ? "ok" : null,
    },
    children: [],
  } as unknown as ToolCallMessage;
}

function createUserText(id: string, createdAt: number, text: string): UserTextMessage {
  return {
    kind: "user-text",
    id,
    realId: null,
    localId: null,
    createdAt,
    text,
  };
}

function createAgentText(id: string, createdAt: number, text: string): AgentTextMessage {
  return {
    kind: "agent-text",
    id,
    localId: null,
    createdAt,
    text,
    isThinking: false,
  };
}

describe("buildVisibleChatDisplayItems", () => {
  it("keeps every tool call when viewInline is on", () => {
    const messages: Message[] = [
      createNamedToolCall("t1", 1, "Bash"),
      createNamedToolCall("t2", 2, "Read"),
    ];
    const items = buildVisibleChatDisplayItems(messages, {
      viewInline: true,
      showThinkingTimeline: false,
    });
    expect(items.map((i) => (i as Message).id)).toEqual(["t1", "t2"]);
  });

  it("hides non-essential tool calls when viewInline is off, keeping always-visible / mcp / pending ones", () => {
    const pending = createNamedToolCall("t4", 4, "Bash");
    (pending.tool as any).permission = { status: "pending" };
    const messages: Message[] = [
      createNamedToolCall("t1", 1, "Bash"),
      createNamedToolCall("t2", 2, "Read"),
      createNamedToolCall("t3", 3, "mcp__happy__change_title"),
      pending,
      createAgentText("a1", 5, "answer"),
    ];
    const items = buildVisibleChatDisplayItems(messages, {
      viewInline: false,
      showThinkingTimeline: false,
    });
    expect(items.map((i) => (i as Message).id)).toEqual(["t2", "t3", "t4", "a1"]);
  });
});

describe("groupToolCallItems", () => {
  it("groups consecutive tool calls between standalone messages and flags running groups", () => {
    const items = [
      createUserText("u1", 1, "do it"),
      createNamedToolCall("t1", 2, "Bash"),
      createNamedToolCall("t2", 3, "Read", "running"),
      createAgentText("a1", 4, "done"),
    ];
    const grouped = groupToolCallItems(items);

    expect(grouped).toHaveLength(3);
    expect((grouped[0] as Message).id).toBe("u1");
    const group = grouped[1] as Extract<FinalChatDisplayItem, { type: "tool-group" }>;
    expect(group.type).toBe("tool-group");
    expect(group.id).toBe("group-t2");
    expect(group.messages.map((m) => m.id)).toEqual(["t1", "t2"]);
    expect(group.hasRunning).toBe(true);
    expect((grouped[2] as Message).id).toBe("a1");
  });

  it("keeps file attachments standalone instead of folding them into a group", () => {
    const items = [
      createNamedToolCall("t1", 1, "Bash"),
      createNamedToolCall("f1", 2, "file"),
      createNamedToolCall("t2", 3, "Bash"),
    ];
    const grouped = groupToolCallItems(items);

    expect(grouped).toHaveLength(3);
    const first = grouped[0] as Extract<FinalChatDisplayItem, { type: "tool-group" }>;
    expect(first.type).toBe("tool-group");
    expect(first.messages.map((m) => m.id)).toEqual(["t1"]);
    expect((grouped[1] as Message).id).toBe("f1");
    const last = grouped[2] as Extract<FinalChatDisplayItem, { type: "tool-group" }>;
    expect(last.messages.map((m) => m.id)).toEqual(["t2"]);
  });
});
