import { describe, expect, it } from "vitest";

import {
  collapseProgressTodos,
  countHappyProgressTokens,
  shouldCollapseProgressExplanation,
  summarizeHappyProgressInput,
} from "./happyProgressViewData";

describe("happyProgressViewData", () => {
  it("summarizes checklist todos and status counts", () => {
    const summary = summarizeHappyProgressInput({
      _derivedExplanation: "ChatList 现在会把同一 turn 中可见的 thinking 与 tool-call 合并成一个统一时间线块",
      label: " Codex upgrade audit ",
      currentStage: " Confirm app-server state ",
      blockers: [" Missing logs ", "", null],
      todos: [
        { content: "Inspect config", status: "completed" },
        { content: "Verify backend", status: "in_progress", activeForm: "正在核实 backend" },
        { content: "Write summary", status: "pending", stage: "Wrap up" },
      ],
    });

    expect(summary.explanation).toBe(
      "ChatList 现在会把同一 turn 中可见的 thinking 与 tool-call 合并成一个统一时间线块",
    );
    expect(summary.label).toBe("Codex upgrade audit");
    expect(summary.currentStage).toBe("Confirm app-server state");
    expect(summary.blockers).toEqual(["Missing logs"]);
    expect(summary.todos).toEqual([
      { content: "Inspect config", status: "completed" },
      {
        content: "Verify backend",
        status: "in_progress",
        activeForm: "正在核实 backend",
      },
      { content: "Write summary", status: "pending", stage: "Wrap up" },
    ]);
    expect(summary.counts).toEqual({
      total: 3,
      completed: 1,
      inProgress: 1,
      pending: 1,
    });
  });

  it("drops invalid todo entries and empty text values", () => {
    const summary = summarizeHappyProgressInput({
      todos: [
        { content: "Valid", status: "completed" },
        { content: "", status: "pending" },
        { content: "Unknown", status: "blocked" },
        null,
      ],
      blockers: [undefined, "  ", "Needs follow-up"],
    });

    expect(summary.todos).toEqual([{ content: "Valid", status: "completed" }]);
    expect(summary.blockers).toEqual(["Needs follow-up"]);
    expect(summary.explanation).toBe(null);
    expect(summary.counts).toEqual({
      total: 1,
      completed: 1,
      inProgress: 0,
      pending: 0,
    });
  });

  it("counts usage tokens from nested agent events", () => {
    const total = countHappyProgressTokens([
      {
        kind: "agent-event",
        id: "evt-1",
        createdAt: 1,
        event: {
          type: "usage-stats",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_creation_input_tokens: 5,
            cache_read_input_tokens: 15,
          },
        },
      } as any,
      {
        kind: "tool-call",
        id: "tool-1",
        localId: null,
        createdAt: 2,
        tool: {
          name: "Task",
          state: "completed",
          input: {},
          createdAt: 2,
          startedAt: 2,
          completedAt: 3,
          description: null,
        },
        children: [
          {
            kind: "agent-event",
            id: "evt-2",
            createdAt: 3,
            event: {
              type: "ready",
              modelUsage: {
                "gpt-5.4": {
                  inputTokens: 50,
                  outputTokens: 10,
                  cacheReadInputTokens: 25,
                  cacheCreationInputTokens: 5,
                  costUSD: 0,
                  contextWindow: 0,
                  maxOutputTokens: 0,
                },
              },
            },
          } as any,
        ],
      } as any,
    ]);

    expect(total).toBe(230);
  });

  it("marks only long explanations as collapsible", () => {
    expect(shouldCollapseProgressExplanation("短说明")).toBe(false);
    expect(
      shouldCollapseProgressExplanation(
        "这是一段会明显撑爆头部卡片的说明文本。".repeat(12),
      ),
    ).toBe(true);
    expect(
      shouldCollapseProgressExplanation("第一行\n第二行"),
    ).toBe(true);
  });

  it("collapses completed tail items but keeps unfinished items visible", () => {
    const result = collapseProgressTodos([
      { content: "A", status: "completed" },
      { content: "B", status: "completed" },
      { content: "C", status: "in_progress" },
      { content: "D", status: "completed" },
      { content: "E", status: "completed" },
      { content: "F", status: "completed" },
    ], 3);

    expect(result.visibleTodos.map((todo) => todo.content)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(result.hiddenCount).toBe(3);
    expect(result.didCollapse).toBe(true);
  });

  it("expands the visible prefix until the last unfinished item", () => {
    const result = collapseProgressTodos([
      { content: "A", status: "completed" },
      { content: "B", status: "completed" },
      { content: "C", status: "completed" },
      { content: "D", status: "pending" },
      { content: "E", status: "completed" },
      { content: "F", status: "completed" },
    ], 3);

    expect(result.visibleTodos.map((todo) => todo.content)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(result.hiddenCount).toBe(2);
    expect(result.didCollapse).toBe(true);
  });
});
