import { describe, expect, it } from "vitest";

import {
  buildProgressStateFromLists,
  capProgressLists,
} from "./progressState";

describe("capProgressLists", () => {
  it("drops the earliest archived list first when over the cap", () => {
    const lists = [
      {
        id: "archived-oldest",
        todos: [],
        startedAt: 1,
        updatedAt: 1,
        archivedAt: 2,
      },
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `list-${index + 1}`,
        todos: [],
        startedAt: index + 10,
        updatedAt: index + 10,
      })),
    ];

    const result = capProgressLists(lists);

    expect(result).toHaveLength(20);
    expect(result.some((list) => list.id === "archived-oldest")).toBe(false);
  });
});

describe("buildProgressStateFromLists", () => {
  it("syncs the legacy flat mirror from the active list", () => {
    const progress = buildProgressStateFromLists({
      lists: [
        {
          id: "list-a",
          todos: [{ content: "Old", status: "completed" }],
          startedAt: 1,
          updatedAt: 2,
          archivedAt: 3,
        },
        {
          id: "list-b",
          todos: [{ content: "Current", status: "in_progress" }],
          currentStage: "Phase 2",
          blockers: ["Waiting on CI"],
          startedAt: 4,
          updatedAt: 5,
        },
      ],
      currentListId: "list-b",
      updatedAt: 6,
    });

    expect(progress).toMatchObject({
      currentListId: "list-b",
      todos: [{ content: "Current", status: "in_progress" }],
      currentStage: "Phase 2",
      blockers: ["Waiting on CI"],
      updatedAt: 6,
    });
  });

  it("falls back to explicit values when the active list is missing", () => {
    const progress = buildProgressStateFromLists({
      lists: [],
      currentListId: "missing",
      updatedAt: 9,
      fallbackTodos: [{ content: "Fallback", status: "pending" }],
      fallbackCurrentStage: "Bootstrapping",
      fallbackBlockers: ["Need input"],
    });

    expect(progress).toEqual({
      lists: [],
      currentListId: "missing",
      todos: [{ content: "Fallback", status: "pending" }],
      currentStage: "Bootstrapping",
      blockers: ["Need input"],
      updatedAt: 9,
    });
  });
});
