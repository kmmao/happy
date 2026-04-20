import { describe, expect, it } from "vitest";

import { applyHappyProgressUpdate } from "./happyProgressMetadata";

describe("applyHappyProgressUpdate", () => {
  it("updates the current list in place when checklist items still overlap", () => {
    const result = applyHappyProgressUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        progress: {
          lists: [
            {
              id: "list-1",
              label: "First phase",
              todos: [
                { content: "Inspect logs", status: "completed" },
                { content: "Patch parser", status: "in_progress" },
              ],
              startedAt: 100,
              updatedAt: 120,
            },
          ],
          currentListId: "list-1",
          todos: [{ content: "Patch parser", status: "in_progress" }],
          updatedAt: 120,
        },
      },
      {
        todos: [
          { content: "Patch parser", status: "completed" },
          { content: "Run tests", status: "in_progress" },
        ],
        now: 200,
      },
    );

    expect(result.metadata.progress?.currentListId).toBe("list-1");
    expect(result.metadata.progress?.lists).toHaveLength(1);
    expect(result.metadata.progress?.lists?.[0]).toMatchObject({
      id: "list-1",
      updatedAt: 200,
      todos: [
        { content: "Patch parser", status: "completed" },
        { content: "Run tests", status: "in_progress" },
      ],
    });
  });

  it("creates a new archived boundary list when an implicit update has zero overlap", () => {
    const result = applyHappyProgressUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        progress: {
          lists: [
            {
              id: "list-1",
              label: "First phase",
              todos: [{ content: "Inspect logs", status: "completed" }],
              startedAt: 100,
              updatedAt: 120,
            },
          ],
          currentListId: "list-1",
          todos: [{ content: "Inspect logs", status: "completed" }],
          updatedAt: 120,
        },
      },
      {
        todos: [{ content: "Investigate iOS UI", status: "in_progress" }],
        currentStage: "定位前端显示问题",
        now: 300,
        createId: () => "list-2",
      },
    );

    expect(result.metadata.progress?.currentListId).toBe("list-2");
    expect(result.metadata.progress?.lists).toHaveLength(2);
    expect(result.metadata.progress?.lists?.[0]).toMatchObject({
      id: "list-1",
      archivedAt: 300,
    });
    expect(result.metadata.progress?.lists?.[1]).toMatchObject({
      id: "list-2",
      currentStage: "定位前端显示问题",
      startedAt: 300,
      updatedAt: 300,
      todos: [{ content: "Investigate iOS UI", status: "in_progress" }],
    });
  });

  it("creates a new archived boundary list when only a generic verification todo overlaps", () => {
    const result = applyHappyProgressUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        progress: {
          lists: [
            {
              id: "list-1",
              label: "First phase",
              todos: [
                { content: "Inspect logs", status: "completed" },
                { content: "Patch parser", status: "completed" },
                { content: "Run related checks", status: "completed" },
              ],
              startedAt: 100,
              updatedAt: 120,
            },
          ],
          currentListId: "list-1",
          todos: [
            { content: "Inspect logs", status: "completed" },
            { content: "Patch parser", status: "completed" },
            { content: "Run related checks", status: "completed" },
          ],
          updatedAt: 120,
        },
      },
      {
        todos: [
          { content: "Adjust toolbar alignment", status: "in_progress" },
          { content: "Refine the hover state", status: "pending" },
          { content: "Run related checks", status: "pending" },
        ],
        currentStage: "第二轮微调",
        now: 300,
        createId: () => "list-2",
      },
    );

    expect(result.metadata.progress?.currentListId).toBe("list-2");
    expect(result.metadata.progress?.lists).toHaveLength(2);
    expect(result.metadata.progress?.lists?.[0]).toMatchObject({
      id: "list-1",
      archivedAt: 300,
    });
    expect(result.metadata.progress?.lists?.[1]).toMatchObject({
      id: "list-2",
      currentStage: "第二轮微调",
      todos: [
        { content: "Adjust toolbar alignment", status: "in_progress" },
        { content: "Refine the hover state", status: "pending" },
        { content: "Run related checks", status: "pending" },
      ],
    });
  });

  it("still honors explicit listId new and triggers summary only for same-list completion", () => {
    const result = applyHappyProgressUpdate(
      {
        path: "/tmp/project",
        host: "test-host",
        homeDir: "/Users/test",
        happyHomeDir: "/Users/test/.happy",
        happyLibDir: "/Users/test/.happy/lib",
        happyToolsDir: "/Users/test/.happy/tools",
        progress: {
          lists: [
            {
              id: "list-1",
              label: "First phase",
              todos: [{ content: "Inspect logs", status: "in_progress" }],
              startedAt: 100,
              updatedAt: 120,
            },
          ],
          currentListId: "list-1",
          todos: [{ content: "Inspect logs", status: "in_progress" }],
          updatedAt: 120,
        },
      },
      {
        listId: "new",
        todos: [{ content: "Ship patch", status: "completed" }],
        now: 400,
        createId: () => "list-2",
      },
    );

    expect(result.shouldTriggerAutoSummary).toBe(false);
    expect(result.metadata.progress?.currentListId).toBe("list-2");
    expect(result.metadata.progress?.lists?.[0]).toMatchObject({
      id: "list-1",
      archivedAt: 400,
    });
    expect(result.metadata.progress?.lists?.[1]).toMatchObject({
      id: "list-2",
      todos: [{ content: "Ship patch", status: "completed" }],
    });
  });
});
