import { describe, expect, it, vi, beforeEach } from "vitest";

const { worldSuggestionAccept, dbMock } = vi.hoisted(() => ({
  worldSuggestionAccept: vi.fn(async () => ({
    suggestionId: "sug-1",
    createdEntityType: "task",
    createdEntityId: "task-1",
  })),
  dbMock: {
    worldSuggestion: {
      count: vi.fn(async () => 0),
      update: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("./worldSuggestionAccept", () => ({ worldSuggestionAccept }));
vi.mock("@/storage/db", () => ({ db: dbMock }));

import {
  autoAcceptSuggestedTasksIfEnabled,
  buildAutoAcceptAudit,
  parseWorldSuggestionAutoAcceptProjectConfig,
  shouldAutoAcceptSuggestedTask,
} from "./worldSuggestionAutoAccept";

describe("parseWorldSuggestionAutoAcceptProjectConfig", () => {
  it("returns disabled by default", () => {
    expect(parseWorldSuggestionAutoAcceptProjectConfig(null)).toEqual({
      autoAcceptSafeSuggestedTasks: false,
      maxAutoAcceptsPerDay: null,
    });
  });

  it("reads boolean flag from supervisorConfig JSON", () => {
    expect(parseWorldSuggestionAutoAcceptProjectConfig(JSON.stringify({
      worldAutonomy: { autoAcceptSafeSuggestedTasks: true },
    }))).toEqual({
      autoAcceptSafeSuggestedTasks: true,
      maxAutoAcceptsPerDay: null,
    });
  });

  it("reads numeric daily limit from supervisorConfig JSON", () => {
    expect(parseWorldSuggestionAutoAcceptProjectConfig(JSON.stringify({
      worldAutonomy: {
        autoAcceptSafeSuggestedTasks: true,
        maxAutoAcceptsPerDay: 2,
      },
    }))).toEqual({
      autoAcceptSafeSuggestedTasks: true,
      maxAutoAcceptsPerDay: 2,
    });
  });
});

describe("shouldAutoAcceptSuggestedTask", () => {
  it("returns true for low-risk suggested_task in next_step bucket when project opt-in is enabled", () => {
    expect(shouldAutoAcceptSuggestedTask({
      projectConfig: { autoAcceptSafeSuggestedTasks: true, maxAutoAcceptsPerDay: null },
      suggestion: {
        id: "sug-1",
        projectId: "project-1",
        relatedGoalId: "goal-1",
        relatedTaskId: null,
        type: "suggested_task",
        title: "Investigate API retry",
        summary: "Follow up failed retry path",
        reason: "Task failed and suggests a narrow diagnostic follow-up",
        evidence: [{ kind: "task", id: "task-1", label: "Retry failed" }],
        recommendedRole: "builder",
        payload: {
          task: {
            title: "Investigate API retry",
            prompt: "Inspect retry logic and propose minimal fix",
            priority: "user",
          },
        },
        requiresHuman: false,
        status: "open",
        dedupeKey: "dedupe:1",
        bucket: "next_step",
        createdAt: 1,
        actedAt: null,
        acceptSource: null,
        acceptAudit: null,
        autoAcceptStatus: null,
        autoAcceptReasonCode: null,
      } as any,
    })).toBe(true);
  });

  it("returns false for non-open suggestions", () => {
    expect(shouldAutoAcceptSuggestedTask({
      projectConfig: { autoAcceptSafeSuggestedTasks: true, maxAutoAcceptsPerDay: null },
      suggestion: {
        id: "sug-1",
        projectId: "project-1",
        relatedGoalId: null,
        relatedTaskId: null,
        type: "suggested_task",
        title: "Investigate API retry",
        summary: "summary",
        reason: "reason",
        evidence: [],
        recommendedRole: null,
        payload: { task: { title: "Investigate API retry", prompt: "Inspect retry logic" } },
        requiresHuman: false,
        status: "accepted",
        dedupeKey: "dedupe:1",
        bucket: "next_step",
        createdAt: 1,
        actedAt: 1,
        acceptSource: "system_auto",
        acceptAudit: null,
        autoAcceptStatus: null,
        autoAcceptReasonCode: null,
      } as any,
    })).toBe(false);
  });

  it("returns false for non-task suggestions", () => {
    expect(shouldAutoAcceptSuggestedTask({
      projectConfig: { autoAcceptSafeSuggestedTasks: true, maxAutoAcceptsPerDay: null },
      suggestion: {
        id: "sug-2",
        projectId: "project-1",
        relatedGoalId: null,
        relatedTaskId: null,
        type: "suggested_goal",
        title: "Create follow-up goal",
        summary: "summary",
        reason: "reason",
        evidence: [],
        recommendedRole: null,
        payload: { goal: { title: "Create follow-up goal" } },
        requiresHuman: false,
        status: "open",
        dedupeKey: "dedupe:2",
        bucket: "next_step",
        createdAt: 1,
        actedAt: null,
        acceptSource: null,
        acceptAudit: null,
        autoAcceptStatus: null,
        autoAcceptReasonCode: null,
      } as any,
    })).toBe(false);
  });

  it("returns false for task suggestions outside next_step bucket", () => {
    expect(shouldAutoAcceptSuggestedTask({
      projectConfig: { autoAcceptSafeSuggestedTasks: true, maxAutoAcceptsPerDay: null },
      suggestion: {
        id: "sug-3",
        projectId: "project-1",
        relatedGoalId: null,
        relatedTaskId: null,
        type: "suggested_task",
        title: "Need human input first",
        summary: "summary",
        reason: "reason",
        evidence: [],
        recommendedRole: null,
        payload: { task: { title: "Need human input first", prompt: "Wait for approval" } },
        requiresHuman: false,
        status: "open",
        dedupeKey: "dedupe:3",
        bucket: "needs_human_input",
        createdAt: 1,
        actedAt: null,
        acceptSource: null,
        acceptAudit: null,
        autoAcceptStatus: null,
        autoAcceptReasonCode: null,
      } as any,
    })).toBe(false);
  });

  it("returns false when evidence contains message or decision involvement", () => {
    expect(shouldAutoAcceptSuggestedTask({
      projectConfig: { autoAcceptSafeSuggestedTasks: true, maxAutoAcceptsPerDay: null },
      suggestion: {
        id: "sug-4",
        projectId: "project-1",
        relatedGoalId: null,
        relatedTaskId: null,
        type: "suggested_task",
        title: "Wait for decision",
        summary: "summary",
        reason: "reason",
        evidence: [{ kind: "decision", id: "dec-1", label: "Pending decision" }],
        recommendedRole: null,
        payload: { task: { title: "Wait for decision", prompt: "Hold until decision closes" } },
        requiresHuman: false,
        status: "open",
        dedupeKey: "dedupe:4",
        bucket: "next_step",
        createdAt: 1,
        actedAt: null,
        acceptSource: null,
        acceptAudit: null,
        autoAcceptStatus: null,
        autoAcceptReasonCode: null,
      } as any,
    })).toBe(false);
  });
});

describe("buildAutoAcceptAudit", () => {
  it("builds a stable reason snapshot for eligible task suggestions", () => {
    const audit = buildAutoAcceptAudit({
      suggestion: {
        id: "sug-1",
        projectId: "project-1",
        relatedGoalId: "goal-1",
        relatedTaskId: null,
        type: "suggested_task",
        title: "Investigate API retry",
        summary: "summary",
        reason: "reason",
        evidence: [{ kind: "task", id: "task-1", label: "Retry failed" }],
        recommendedRole: "builder",
        payload: { task: { title: "Investigate API retry", prompt: "Inspect retry logic", priority: "user" } },
        requiresHuman: false,
        status: "open",
        dedupeKey: "dedupe:1",
        bucket: "next_step",
        createdAt: 1,
        actedAt: null,
        acceptSource: null,
        acceptAudit: null,
        autoAcceptStatus: null,
        autoAcceptReasonCode: null,
      } as any,
    });

    expect(audit).toEqual({
      rule: "safe_suggested_task_auto_accept",
      checks: [
        "type:suggested_task",
        "bucket:next_step",
        "requiresHuman:false",
        "payload:task_title_prompt_present",
        "evidence:no_message_decision",
      ],
    });
  });
});

describe("autoAcceptSuggestedTasksIfEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.worldSuggestion.count.mockResolvedValue(0);
  });

  it("reuses worldSuggestionAccept for eligible tasks with system audit source and reason snapshot", async () => {
    await autoAcceptSuggestedTasksIfEnabled({
      accountId: "user-1",
      projectId: "project-1",
      supervisorConfig: JSON.stringify({ worldAutonomy: { autoAcceptSafeSuggestedTasks: true } }),
      suggestions: [
        {
          id: "sug-1",
          projectId: "project-1",
          relatedGoalId: null,
          relatedTaskId: null,
          type: "suggested_task",
          title: "Investigate API retry",
          summary: "summary",
          reason: "reason",
          evidence: [],
          recommendedRole: null,
          payload: { task: { title: "Investigate API retry", prompt: "Inspect retry logic" } },
          requiresHuman: false,
          status: "open",
          dedupeKey: "dedupe:1",
          bucket: "next_step",
          createdAt: 1,
          actedAt: null,
          acceptSource: null,
          acceptAudit: null,
          autoAcceptStatus: null,
          autoAcceptReasonCode: null,
        } as any,
      ],
    });

    expect(worldSuggestionAccept).toHaveBeenCalledWith({
      accountId: "user-1",
      projectId: "project-1",
      suggestionId: "sug-1",
      acceptSource: "system_auto",
      acceptAudit: {
        rule: "safe_suggested_task_auto_accept",
        checks: [
          "type:suggested_task",
          "bucket:next_step",
          "requiresHuman:false",
          "payload:task_title_prompt_present",
          "evidence:no_message_decision",
        ],
      },
    });
  });

  it("records skipped status when daily quota is exhausted", async () => {
    dbMock.worldSuggestion.count.mockResolvedValue(2);

    await autoAcceptSuggestedTasksIfEnabled({
      accountId: "user-1",
      projectId: "project-1",
      supervisorConfig: JSON.stringify({
        worldAutonomy: {
          autoAcceptSafeSuggestedTasks: true,
          maxAutoAcceptsPerDay: 2,
        },
      }),
      suggestions: [
        {
          id: "sug-1",
          projectId: "project-1",
          relatedGoalId: null,
          relatedTaskId: null,
          type: "suggested_task",
          title: "Investigate API retry",
          summary: "summary",
          reason: "reason",
          evidence: [],
          recommendedRole: null,
          payload: { task: { title: "Investigate API retry", prompt: "Inspect retry logic" } },
          requiresHuman: false,
          status: "open",
          dedupeKey: "dedupe:1",
          bucket: "next_step",
          createdAt: 1,
          actedAt: null,
          acceptSource: null,
          acceptAudit: null,
          autoAcceptStatus: null,
          autoAcceptReasonCode: null,
        } as any,
      ],
    });

    expect(worldSuggestionAccept).not.toHaveBeenCalled();
    expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
      where: { id: "sug-1" },
      data: {
        autoAcceptStatus: "skipped",
        autoAcceptReasonCode: "quota_exhausted",
      },
    });
  });

  it("records skipped status when accept loses already-acted race", async () => {
    worldSuggestionAccept.mockRejectedValueOnce(new Error("Suggestion not found or already acted upon"));

    await autoAcceptSuggestedTasksIfEnabled({
      accountId: "user-1",
      projectId: "project-1",
      supervisorConfig: JSON.stringify({ worldAutonomy: { autoAcceptSafeSuggestedTasks: true } }),
      suggestions: [
        {
          id: "sug-1",
          projectId: "project-1",
          relatedGoalId: null,
          relatedTaskId: null,
          type: "suggested_task",
          title: "Investigate API retry",
          summary: "summary",
          reason: "reason",
          evidence: [],
          recommendedRole: null,
          payload: { task: { title: "Investigate API retry", prompt: "Inspect retry logic" } },
          requiresHuman: false,
          status: "open",
          dedupeKey: "dedupe:1",
          bucket: "next_step",
          createdAt: 1,
          actedAt: null,
          acceptSource: null,
          acceptAudit: null,
          autoAcceptStatus: null,
          autoAcceptReasonCode: null,
        } as any,
      ],
    });

    expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
      where: { id: "sug-1" },
      data: {
        autoAcceptStatus: "skipped",
        autoAcceptReasonCode: "already_acted",
      },
    });
  });

  it("records failed status when accept throws a non-race error", async () => {
    worldSuggestionAccept.mockRejectedValueOnce(new Error("dispatch failed"));

    await expect(autoAcceptSuggestedTasksIfEnabled({
      accountId: "user-1",
      projectId: "project-1",
      supervisorConfig: JSON.stringify({ worldAutonomy: { autoAcceptSafeSuggestedTasks: true } }),
      suggestions: [
        {
          id: "sug-1",
          projectId: "project-1",
          relatedGoalId: null,
          relatedTaskId: null,
          type: "suggested_task",
          title: "Investigate API retry",
          summary: "summary",
          reason: "reason",
          evidence: [],
          recommendedRole: null,
          payload: { task: { title: "Investigate API retry", prompt: "Inspect retry logic" } },
          requiresHuman: false,
          status: "open",
          dedupeKey: "dedupe:1",
          bucket: "next_step",
          createdAt: 1,
          actedAt: null,
          acceptSource: null,
          acceptAudit: null,
          autoAcceptStatus: null,
          autoAcceptReasonCode: null,
        } as any,
      ],
    })).rejects.toThrow("dispatch failed");

    expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
      where: { id: "sug-1" },
      data: {
        autoAcceptStatus: "failed",
        autoAcceptReasonCode: "accept_failed",
      },
    });
  });

  it("counts only system_auto accepts toward the daily quota", async () => {
    dbMock.worldSuggestion.count.mockResolvedValue(1);

    await autoAcceptSuggestedTasksIfEnabled({
      accountId: "user-1",
      projectId: "project-1",
      supervisorConfig: JSON.stringify({
        worldAutonomy: {
          autoAcceptSafeSuggestedTasks: true,
          maxAutoAcceptsPerDay: 2,
        },
      }),
      suggestions: [],
    });

    expect(dbMock.worldSuggestion.count).toHaveBeenCalledWith({
      where: {
        accountId: "user-1",
        projectId: "project-1",
        status: "accepted",
        acceptSource: "system_auto",
        actedAt: { gte: expect.any(Date) },
      },
    });
  });

  it("stops auto-accepting when project daily quota is already exhausted", async () => {
    dbMock.worldSuggestion.count.mockResolvedValue(2);

    await autoAcceptSuggestedTasksIfEnabled({
      accountId: "user-1",
      projectId: "project-1",
      supervisorConfig: JSON.stringify({
        worldAutonomy: {
          autoAcceptSafeSuggestedTasks: true,
          maxAutoAcceptsPerDay: 2,
        },
      }),
      suggestions: [
        {
          id: "sug-1",
          projectId: "project-1",
          relatedGoalId: null,
          relatedTaskId: null,
          type: "suggested_task",
          title: "Investigate API retry",
          summary: "summary",
          reason: "reason",
          evidence: [],
          recommendedRole: null,
          payload: { task: { title: "Investigate API retry", prompt: "Inspect retry logic" } },
          requiresHuman: false,
          status: "open",
          dedupeKey: "dedupe:1",
          bucket: "next_step",
          createdAt: 1,
          actedAt: null,
          acceptSource: null,
          acceptAudit: null,
          autoAcceptStatus: null,
          autoAcceptReasonCode: null,
        } as any,
      ],
    });

    expect(worldSuggestionAccept).not.toHaveBeenCalled();
  });

  it("only auto-accepts suggestions up to the remaining daily quota", async () => {
    dbMock.worldSuggestion.count.mockResolvedValue(1);

    await autoAcceptSuggestedTasksIfEnabled({
      accountId: "user-1",
      projectId: "project-1",
      supervisorConfig: JSON.stringify({
        worldAutonomy: {
          autoAcceptSafeSuggestedTasks: true,
          maxAutoAcceptsPerDay: 2,
        },
      }),
      suggestions: [
        {
          id: "sug-1",
          projectId: "project-1",
          relatedGoalId: null,
          relatedTaskId: null,
          type: "suggested_task",
          title: "Investigate API retry",
          summary: "summary",
          reason: "reason",
          evidence: [],
          recommendedRole: null,
          payload: { task: { title: "Investigate API retry", prompt: "Inspect retry logic" } },
          requiresHuman: false,
          status: "open",
          dedupeKey: "dedupe:1",
          bucket: "next_step",
          createdAt: 1,
          actedAt: null,
          acceptSource: null,
          acceptAudit: null,
          autoAcceptStatus: null,
          autoAcceptReasonCode: null,
        } as any,
        {
          id: "sug-2",
          projectId: "project-1",
          relatedGoalId: null,
          relatedTaskId: null,
          type: "suggested_task",
          title: "Investigate second retry",
          summary: "summary",
          reason: "reason",
          evidence: [],
          recommendedRole: null,
          payload: { task: { title: "Investigate second retry", prompt: "Inspect second retry logic" } },
          requiresHuman: false,
          status: "open",
          dedupeKey: "dedupe:2",
          bucket: "next_step",
          createdAt: 2,
          actedAt: null,
          acceptSource: null,
          acceptAudit: null,
          autoAcceptStatus: null,
          autoAcceptReasonCode: null,
        } as any,
      ],
    });

    expect(worldSuggestionAccept).toHaveBeenCalledTimes(1);
    expect(worldSuggestionAccept).toHaveBeenCalledWith(expect.objectContaining({ suggestionId: "sug-1" }));
  });
});
