import { describe, expect, it } from "vitest";
import {
  AcceptBodySchema,
  SuggestionAcceptAuditSchema,
  getSuggestionPayloadSchema,
  SuggestionPayloadSchema,
  SUGGESTION_ACCEPT_SOURCES,
  SUGGESTION_BUCKETS,
  SUGGESTION_STATUSES,
  SUGGESTION_TYPES,
  WorldSuggestionUpdatedSchema,
} from "@kmmao/happy-wire";
import {
  normalizeSuggestionPayload,
  serializeSuggestion,
} from "./worldSuggestionTypes";

describe("worldSuggestionContract", () => {
  it("exports pure suggestion enums from the contract layer", () => {
    expect(SUGGESTION_TYPES).toEqual(["suggested_goal", "suggested_task", "suggested_skill", "suggested_decision"]);
    expect(SUGGESTION_STATUSES).toEqual(["open", "processing", "accepted", "suspended", "dismissed", "expired"]);
    expect(SUGGESTION_BUCKETS).toEqual(["next_step", "needs_decision", "needs_human_input"]);
    expect(SUGGESTION_ACCEPT_SOURCES).toEqual(["human", "system_auto"]);
  });

  it("exports payload schemas from the contract layer", () => {
    expect(getSuggestionPayloadSchema("suggested_task").safeParse({
      task: {
        title: "Fix build",
        prompt: "Investigate failing build",
      },
    }).success).toBe(true);

    expect(SuggestionPayloadSchema.safeParse({
      decision: {
        question: "What next?",
        options: [
          { id: "a", description: "A" },
          { id: "b", description: "B" },
        ],
      },
    }).success).toBe(true);

    expect(AcceptBodySchema.safeParse({
      machineId: "machine-1",
      priorityOverride: "user",
    }).success).toBe(true);
  });

  it("exports accept audit schema", () => {
    expect(SuggestionAcceptAuditSchema.safeParse({
      rule: "safe_suggested_task_auto_accept",
      checks: ["type:suggested_task"],
    }).success).toBe(true);
  });

  it("exports world suggestion updated schema with constrained status", () => {
    expect(WorldSuggestionUpdatedSchema.safeParse({
      type: "world-suggestion-updated",
      projectId: "project-1",
      suggestionId: "sug-1",
      status: "accepted",
    }).success).toBe(true);

    expect(WorldSuggestionUpdatedSchema.safeParse({
      type: "world-suggestion-updated",
      projectId: "project-1",
      suggestionId: "sug-1",
      status: "not-a-real-status",
    }).success).toBe(false);
  });
});

describe("normalizeSuggestionPayload", () => {
  it("keeps only the payload branch bound to suggestion type", () => {
    const result = normalizeSuggestionPayload({
      type: "suggested_task",
      title: "Recovered task",
      rawPayload: {
        goal: { title: "Wrong goal payload" },
        task: { title: "Real task", prompt: "Do the task", priority: "user" },
      },
    });

    expect(result).toEqual({
      task: { title: "Real task", prompt: "Do the task", priority: "user" },
    });
  });

  it("falls back to the suggestion title when payload does not match type schema", () => {
    const result = normalizeSuggestionPayload({
      type: "suggested_goal",
      title: "Recovered goal",
      rawPayload: {
        task: { title: "Wrong task payload", prompt: "oops" },
      },
    });

    expect(result).toEqual({
      goal: { title: "Recovered goal" },
    });
  });
});

describe("serializeSuggestion", () => {
  it("should serialize a suggestion row to API format", () => {
    const row = {
      id: "sug-1",
      projectId: "proj-1",
      relatedGoalId: "goal-1",
      relatedTaskId: "task-1",
      type: "suggested_decision" as const,
      title: "Review decision",
      summary: "Decision needs attention",
      reason: "Decision pending",
      evidence: JSON.stringify([{ kind: "decision", id: "dec-1", label: "Review decision" }]),
      recommendedRole: null,
      payload: JSON.stringify({ decision: { question: "Fix it", existingDecisionId: "dec-1", options: [{ id: "a", description: "A" }, { id: "b", description: "B" }] } }),
      requiresHuman: true,
      status: "expired" as const,
      dedupeKey: "failed_task_followup:task-1:1:3:boom",
      bucket: "needs_decision" as const,
      createdAt: new Date("2026-04-10T10:00:00Z"),
      actedAt: null,
      acceptSource: null,
      acceptAudit: null,
    };

    const result = serializeSuggestion(row);

    expect(result).toEqual({
      id: "sug-1",
      projectId: "proj-1",
      relatedGoalId: "goal-1",
      relatedTaskId: "task-1",
      type: "suggested_decision",
      title: "Review decision",
      summary: "Decision needs attention",
      reason: "Decision pending",
      evidence: [{ kind: "decision", id: "dec-1", label: "Review decision" }],
      recommendedRole: null,
      payload: { decision: { question: "Fix it", existingDecisionId: "dec-1", options: [{ id: "a", description: "A" }, { id: "b", description: "B" }] } },
      requiresHuman: true,
      status: "expired",
      dedupeKey: "failed_task_followup:task-1:1:3:boom",
      bucket: "needs_decision",
      createdAt: new Date("2026-04-10T10:00:00Z").getTime(),
      actedAt: null,
      acceptSource: null,
      acceptAudit: null,
    });
  });

  it("parses auto-accept audit snapshot when present", () => {
    const row = {
      id: "sug-auto-audit",
      projectId: "proj-1",
      relatedGoalId: null,
      relatedTaskId: "task-1",
      type: "suggested_task" as const,
      title: "Retry failed API",
      summary: "summary",
      reason: "reason",
      evidence: "[]",
      recommendedRole: "builder",
      payload: JSON.stringify({ task: { title: "Retry failed API", prompt: "Inspect retry logic", priority: "user" } }),
      requiresHuman: false,
      status: "accepted" as const,
      dedupeKey: "dedupe:auto-1",
      bucket: "next_step" as const,
      createdAt: new Date("2026-04-10T10:00:00Z"),
      actedAt: new Date("2026-04-10T10:05:00Z"),
      acceptSource: "system_auto" as const,
      acceptAudit: JSON.stringify({
        rule: "safe_suggested_task_auto_accept",
        checks: ["type:suggested_task"],
      }),
    };

    const result = serializeSuggestion(row as any);

    expect(result.acceptAudit).toEqual({
      rule: "safe_suggested_task_auto_accept",
      checks: ["type:suggested_task"],
    });
  });

  it("falls back to a type-safe goal payload when stored payload shape mismatches type", () => {
    const row = {
      id: "sug-mismatch-goal",
      projectId: "proj-1",
      relatedGoalId: null,
      relatedTaskId: null,
      type: "suggested_goal" as const,
      title: "Recovered goal",
      summary: "Recovered goal",
      reason: "Recovered goal",
      evidence: "[]",
      recommendedRole: null,
      payload: JSON.stringify({ task: { title: "Wrong task payload", prompt: "oops" } }),
      requiresHuman: true,
      status: "open" as const,
      dedupeKey: "goal:1",
      bucket: "next_step" as const,
      createdAt: new Date("2026-04-10T10:00:00Z"),
      actedAt: null,
      acceptSource: null,
      acceptAudit: null,
    };

    const result = serializeSuggestion(row as any);

    expect(result.type).toBe("suggested_goal");
    expect(result.payload).toEqual({ goal: { title: "Recovered goal" } });
  });

  it("prefers the branch bound to suggestion type when payload contains multiple branches", () => {
    const row = {
      id: "sug-multi-branch-task",
      projectId: "proj-1",
      relatedGoalId: null,
      relatedTaskId: null,
      type: "suggested_task" as const,
      title: "Recovered task",
      summary: "Recovered task",
      reason: "Recovered task",
      evidence: "[]",
      recommendedRole: null,
      payload: JSON.stringify({
        goal: { title: "Wrong goal payload" },
        task: { title: "Real task", prompt: "Do the task", priority: "user" },
      }),
      requiresHuman: true,
      status: "open" as const,
      dedupeKey: "task:1",
      bucket: "next_step" as const,
      createdAt: new Date("2026-04-10T10:00:00Z"),
      actedAt: null,
      acceptSource: null,
      acceptAudit: null,
    };

    const result = serializeSuggestion(row as any);

    expect(result.type).toBe("suggested_task");
    expect(result.payload).toEqual({
      task: { title: "Real task", prompt: "Do the task", priority: "user" },
    });
  });

  it("should handle malformed JSON gracefully", () => {
    const row = {
      id: "sug-2",
      projectId: "proj-1",
      relatedGoalId: null,
      relatedTaskId: null,
      type: "suggested_goal" as const,
      title: "Test",
      summary: "Test",
      reason: "Test",
      evidence: "not-json",
      recommendedRole: null,
      payload: "{broken",
      requiresHuman: true,
      status: "open" as const,
      dedupeKey: "test:1",
      bucket: undefined,
      createdAt: new Date("2026-04-10T10:00:00Z"),
      actedAt: new Date("2026-04-10T12:00:00Z"),
      acceptSource: "human" as const,
      acceptAudit: "{broken",
    };

    const result = serializeSuggestion(row as any);

    expect(result.evidence).toEqual([]);
    expect(result.payload).toEqual({ goal: { title: "Test" } });
    expect(result.actedAt).toBe(new Date("2026-04-10T12:00:00Z").getTime());
    expect(result.bucket).toBe("needs_human_input");
    expect(result.acceptSource).toBe("human");
    expect(result.acceptAudit).toBeNull();
  });
});
