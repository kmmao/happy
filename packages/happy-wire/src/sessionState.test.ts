import { describe, expect, it } from "vitest";

import {
  sessionProgressStateSchema,
  sessionSummaryRefreshActiveRequestSchema,
  sessionSummaryRefreshRecentEntrySchema,
  sessionSummaryRefreshStateSchema,
  sessionSummaryStateSchema,
} from "./sessionState";

describe("sessionProgressStateSchema", () => {
  it("preserves multi-list fields needed by CLI and App progress UIs", () => {
    const result = sessionProgressStateSchema.safeParse({
      lists: [
        {
          id: "list-1",
          label: "Patch parser",
          todos: [
            {
              content: "Patch parser",
              status: "in_progress",
              activeForm: "Patching parser",
              stage: "Phase 2",
            },
          ],
          currentStage: "Phase 2",
          blockers: ["Waiting on fixture"],
          startedAt: 100,
          updatedAt: 200,
          archivedAt: 300,
          toolCallIds: ["tool-1"],
          summaryGeneratedAt: 400,
        },
      ],
      currentListId: "list-1",
      todos: [
        {
          content: "Patch parser",
          status: "in_progress",
          activeForm: "Patching parser",
          stage: "Phase 2",
        },
      ],
      currentStage: "Phase 2",
      blockers: ["Waiting on fixture"],
      updatedAt: 200,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.lists?.[0]).toMatchObject({
      id: "list-1",
      label: "Patch parser",
      toolCallIds: ["tool-1"],
      summaryGeneratedAt: 400,
    });
    expect(result.data.currentListId).toBe("list-1");
    expect(result.data.currentStage).toBe("Phase 2");
    expect(result.data.blockers).toEqual(["Waiting on fixture"]);
  });
});

describe("sessionSummaryStateSchema", () => {
  it("accepts narrative milestone summaries", () => {
    const result = sessionSummaryStateSchema.safeParse({
      goal: "Ship progress tab improvements",
      currentFocus: "Deduplicate shared schema usage",
      keyDecisions: ["Reuse happy-wire as the single schema source"],
      openQuestions: ["Should App write metadata back later?"],
      impactScope: ["packages/happy-wire", "packages/happy-app"],
      updatedAt: 123,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.goal).toBe("Ship progress tab improvements");
    expect(result.data.keyDecisions).toEqual([
      "Reuse happy-wire as the single schema source",
    ]);
  });
});

describe("sessionSummaryRefreshActiveRequestSchema", () => {
  it("accepts active summary refresh requests", () => {
    const result = sessionSummaryRefreshActiveRequestSchema.safeParse({
      requestId: "summary-refresh_123",
      requestedAt: 456,
      requester: "happy-agent",
      command: "summary-refresh",
      requireSummary: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data).toMatchObject({
      requestId: "summary-refresh_123",
      requestedAt: 456,
      requester: "happy-agent",
      command: "summary-refresh",
      requireSummary: true,
    });
  });
});

describe("sessionSummaryRefreshRecentEntrySchema", () => {
  it("accepts applied and superseded acknowledgements", () => {
    const applied = sessionSummaryRefreshRecentEntrySchema.safeParse({
      requestId: "summary-refresh_123",
      status: "applied",
      resolvedAt: 500,
      summaryUpdatedAt: 490,
    });
    const superseded = sessionSummaryRefreshRecentEntrySchema.safeParse({
      requestId: "summary-refresh_122",
      status: "superseded",
      resolvedAt: 499,
      supersededByRequestId: "summary-refresh_123",
    });

    expect(applied.success).toBe(true);
    expect(superseded.success).toBe(true);
  });
});

describe("sessionSummaryRefreshStateSchema", () => {
  it("accepts protocol state with active request and recent history", () => {
    const result = sessionSummaryRefreshStateSchema.safeParse({
      protocolVersion: 1,
      active: {
        requestId: "summary-refresh_124",
        requestedAt: 600,
        requester: "happy-agent",
        command: "summary-refresh",
        requireSummary: false,
      },
      recent: [
        {
          requestId: "summary-refresh_123",
          status: "applied",
          resolvedAt: 500,
          summaryUpdatedAt: 490,
        },
        {
          requestId: "summary-refresh_122",
          status: "superseded",
          resolvedAt: 499,
          supersededByRequestId: "summary-refresh_123",
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.active?.requestId).toBe("summary-refresh_124");
    expect(result.data.recent).toHaveLength(2);
    expect(result.data.recent?.[1]).toMatchObject({
      status: "superseded",
      supersededByRequestId: "summary-refresh_123",
    });
  });

  it("rejects invalid refresh state payloads", () => {
    const result = sessionSummaryRefreshStateSchema.safeParse({
      protocolVersion: 2,
      active: {
        requestId: "",
        requestedAt: "bad",
        requester: "unknown",
        command: "bad-command",
        requireSummary: "yes",
      },
      recent: [
        {
          requestId: "",
          resolvedAt: "bad",
          summaryUpdatedAt: "bad",
        },
      ],
      status: "unknown",
    });

    expect(result.success).toBe(false);
  });
});
