import { describe, expect, it } from "vitest";

import { appendToolCallIdToCurrentProgressList } from "./progressToolCallAttribution";

describe("appendToolCallIdToCurrentProgressList", () => {
  it("appends a tool call id to the active progress list", () => {
    const metadata = {
      progress: {
        currentListId: "list-b",
        updatedAt: 10,
        lists: [
          {
            id: "list-a",
            todos: [{ content: "Old", status: "completed" as const }],
            startedAt: 1,
            updatedAt: 5,
            archivedAt: 9,
          },
          {
            id: "list-b",
            todos: [{ content: "Current", status: "in_progress" as const }],
            startedAt: 11,
            updatedAt: 12,
          },
        ],
      },
    };

    const updated = appendToolCallIdToCurrentProgressList(metadata, {
      toolCallId: "tool-1",
      now: 99,
    });

    expect(updated.progress?.lists?.[1]).toMatchObject({
      id: "list-b",
      toolCallIds: ["tool-1"],
      updatedAt: 99,
    });
    expect(updated.progress?.updatedAt).toBe(99);
  });

  it("falls back to the latest non-archived list when currentListId is missing", () => {
    const metadata = {
      progress: {
        updatedAt: 10,
        lists: [
          {
            id: "list-a",
            todos: [{ content: "Old", status: "completed" as const }],
            startedAt: 1,
            updatedAt: 5,
            archivedAt: 9,
          },
          {
            id: "list-b",
            todos: [{ content: "Current", status: "in_progress" as const }],
            startedAt: 11,
            updatedAt: 12,
          },
        ],
      },
    };

    const updated = appendToolCallIdToCurrentProgressList(metadata, {
      toolCallId: "tool-2",
      now: 101,
    });

    expect(updated.progress?.lists?.[1]?.toolCallIds).toEqual(["tool-2"]);
  });

  it("keeps metadata unchanged when there is no progress list", () => {
    const metadata = {};
    expect(
      appendToolCallIdToCurrentProgressList(metadata, {
        toolCallId: "tool-3",
      }),
    ).toBe(metadata);
  });

  it("does not duplicate tool call ids", () => {
    const metadata = {
      progress: {
        currentListId: "list-a",
        updatedAt: 10,
        lists: [
          {
            id: "list-a",
            todos: [{ content: "Current", status: "in_progress" as const }],
            startedAt: 11,
            updatedAt: 12,
            toolCallIds: ["tool-1"],
          },
        ],
      },
    };

    const updated = appendToolCallIdToCurrentProgressList(metadata, {
      toolCallId: "tool-1",
      now: 200,
    });

    expect(updated).toBe(metadata);
  });
});
