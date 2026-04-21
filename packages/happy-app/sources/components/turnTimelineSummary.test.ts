import { describe, expect, it } from "vitest";

import { summarizeHiddenTimelineSteps } from "./turnTimelineSummary";
import type { TurnTimelineStep } from "./chatTimelineDisplay";

describe("summarizeHiddenTimelineSteps", () => {
  it("prioritizes the most frequent hidden step types", () => {
    const steps: TurnTimelineStep[] = [
      {
        kind: "thinking",
        message: {
          kind: "agent-text",
          id: "thinking-1",
          localId: null,
          createdAt: 1,
          text: "Thinking",
          isThinking: true,
        },
      },
      {
        kind: "tool-call",
        message: {
          kind: "tool-call",
          id: "tool-1",
          localId: null,
          createdAt: 2,
          tool: {
            name: "CodexBash",
            state: "completed",
            input: { command: "cat src/a.ts" },
            createdAt: 2,
            startedAt: 2,
            completedAt: 3,
            description: null,
          },
          children: [],
        },
      },
      {
        kind: "tool-call",
        message: {
          kind: "tool-call",
          id: "tool-2",
          localId: null,
          createdAt: 3,
          tool: {
            name: "CodexBash",
            state: "completed",
            input: { command: "cat src/b.ts" },
            createdAt: 3,
            startedAt: 3,
            completedAt: 4,
            description: null,
          },
          children: [],
        },
      },
      {
        kind: "tool-call",
        message: {
          kind: "tool-call",
          id: "tool-3",
          localId: null,
          createdAt: 4,
          tool: {
            name: "mcp__happy__update_progress",
            state: "completed",
            input: {},
            createdAt: 4,
            startedAt: 4,
            completedAt: 5,
            description: null,
          },
          children: [],
        },
      },
    ];

    expect(summarizeHiddenTimelineSteps(steps, null)).toEqual({
      items: [
        { kind: "read", count: 2 },
        { kind: "thinking", count: 1 },
      ],
      otherCount: 1,
    });
  });

  it("falls back to generic tool kind for unknown tools", () => {
    const steps: TurnTimelineStep[] = [
      {
        kind: "tool-call",
        message: {
          kind: "tool-call",
          id: "tool-1",
          localId: null,
          createdAt: 2,
          tool: {
            name: "SomethingElse",
            state: "completed",
            input: {},
            createdAt: 2,
            startedAt: 2,
            completedAt: 3,
            description: null,
          },
          children: [],
        },
      },
    ];

    expect(summarizeHiddenTimelineSteps(steps, null)).toEqual({
      items: [{ kind: "tool", count: 1 }],
      otherCount: 0,
    });
  });
});
