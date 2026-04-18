import { describe, expect, it } from "vitest";

import {
  appendCodexToolCallIdToPlanList,
  getCodexPlanListId,
  mirrorCodexPlanToProgress,
} from "./codexPlanProgress";

describe("mirrorCodexPlanToProgress", () => {
  it("creates the first Codex progress list from a turn plan update", () => {
    const result = mirrorCodexPlanToProgress(
      {},
      {
        turnId: "turn-1",
        now: 100,
        plan: [
          { step: "Inspect logs", status: "completed" },
          { step: "Patch parser", status: "inProgress" },
        ],
      },
    );

    expect(result.wroteProgress).toBe(true);
    expect(result.shouldTriggerAutoSummary).toBe(false);
    expect(result.metadata.progress).toMatchObject({
      currentListId: getCodexPlanListId("turn-1"),
      todos: [
        { content: "Inspect logs", status: "completed" },
        { content: "Patch parser", status: "in_progress" },
      ],
      updatedAt: 100,
      lists: [
        {
          id: getCodexPlanListId("turn-1"),
          label: "Inspect logs",
          todos: [
            { content: "Inspect logs", status: "completed" },
            { content: "Patch parser", status: "in_progress" },
          ],
          startedAt: 100,
          updatedAt: 100,
        },
      ],
    });
  });

  it("updates the same turn in place and triggers auto-summary on completion transition", () => {
    const initial = mirrorCodexPlanToProgress(
      {},
      {
        turnId: "turn-1",
        now: 100,
        plan: [
          { step: "Inspect logs", status: "completed" },
          { step: "Patch parser", status: "in_progress" },
        ],
      },
    ).metadata;

    const result = mirrorCodexPlanToProgress(initial, {
      turnId: "turn-1",
      now: 200,
      plan: [
        { step: "Inspect logs", status: "completed" },
        { step: "Patch parser", status: "completed" },
      ],
    });

    expect(result.wroteProgress).toBe(true);
    expect(result.shouldTriggerAutoSummary).toBe(true);
    expect(result.metadata.progress?.lists).toHaveLength(1);
    expect(result.metadata.progress?.lists?.[0]).toMatchObject({
      id: getCodexPlanListId("turn-1"),
      startedAt: 100,
      updatedAt: 200,
      summaryGeneratedAt: 200,
      todos: [
        { content: "Inspect logs", status: "completed" },
        { content: "Patch parser", status: "completed" },
      ],
    });
  });

  it("archives the previous active list when a new turn starts a new plan", () => {
    const initial = mirrorCodexPlanToProgress(
      {},
      {
        turnId: "turn-1",
        now: 100,
        plan: [{ step: "Inspect logs", status: "in_progress" }],
      },
    ).metadata;

    const result = mirrorCodexPlanToProgress(initial, {
      turnId: "turn-2",
      now: 250,
      plan: [{ step: "Verify UI", status: "pending" }],
    });

    expect(result.metadata.progress).toMatchObject({
      currentListId: getCodexPlanListId("turn-2"),
      todos: [{ content: "Verify UI", status: "pending" }],
    });
    expect(result.metadata.progress?.lists).toHaveLength(2);
    expect(result.metadata.progress?.lists?.[0]).toMatchObject({
      id: getCodexPlanListId("turn-1"),
      archivedAt: 250,
    });
    expect(result.metadata.progress?.lists?.[1]).toMatchObject({
      id: getCodexPlanListId("turn-2"),
      startedAt: 250,
      updatedAt: 250,
    });
  });

  it("ignores empty or invalid plan payloads", () => {
    const result = mirrorCodexPlanToProgress(
      {
        progress: {
          updatedAt: 10,
          currentListId: getCodexPlanListId("turn-1"),
          todos: [{ content: "Existing", status: "in_progress" }],
          lists: [
            {
              id: getCodexPlanListId("turn-1"),
              label: "Existing",
              todos: [{ content: "Existing", status: "in_progress" }],
              startedAt: 10,
              updatedAt: 10,
            },
          ],
        },
      },
      {
        turnId: "turn-2",
        now: 20,
        plan: [{ step: "", status: "pending" }],
      },
    );

    expect(result.wroteProgress).toBe(false);
    expect(result.shouldTriggerAutoSummary).toBe(false);
    expect(result.metadata.progress?.currentListId).toBe(getCodexPlanListId("turn-1"));
  });
});

describe("appendCodexToolCallIdToPlanList", () => {
  it("attaches file-edit tool ids to the matching Codex turn list only", () => {
    const metadata = mirrorCodexPlanToProgress(
      {},
      {
        turnId: "turn-1",
        now: 100,
        plan: [{ step: "Patch parser", status: "in_progress" }],
      },
    ).metadata;

    const updated = appendCodexToolCallIdToPlanList(metadata, {
      turnId: "turn-1",
      toolCallId: "tool-1",
      now: 150,
    });

    expect(updated.progress?.lists?.[0]).toMatchObject({
      id: getCodexPlanListId("turn-1"),
      toolCallIds: ["tool-1"],
      updatedAt: 150,
    });
  });

  it("does not misattribute tool calls to an older active list from a different turn", () => {
    const metadata = mirrorCodexPlanToProgress(
      {},
      {
        turnId: "turn-1",
        now: 100,
        plan: [{ step: "Patch parser", status: "in_progress" }],
      },
    ).metadata;

    const updated = appendCodexToolCallIdToPlanList(metadata, {
      turnId: "turn-2",
      toolCallId: "tool-2",
      now: 200,
    });

    expect(updated).toEqual(metadata);
  });
});
