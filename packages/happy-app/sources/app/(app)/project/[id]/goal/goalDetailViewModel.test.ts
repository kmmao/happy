import { describe, expect, it } from "vitest";
import {
  buildGoalDetailSections,
  deriveGoalDetailScreenState,
  filterGoalDetailSuggestions,
} from "./goalDetailViewModel";
import type { GoalDetail } from "@/sync/apiProjects";
import type { SuggestionSummary } from "@/sync/apiWorld";

function createSuggestion(overrides: Partial<SuggestionSummary> = {}): SuggestionSummary {
  const base: SuggestionSummary = {
    id: "suggestion-1",
    projectId: "project-1",
    relatedGoalId: "goal-1",
    relatedTaskId: null,
    type: "suggested_decision",
    title: "Need a decision",
    summary: "Choose an option",
    reason: "Decision pending",
    evidence: [],
    recommendedRole: null,
    payload: {
      decision: {
        question: "Use modal or sheet?",
        options: [
          { id: "a", description: "Modal" },
          { id: "b", description: "Sheet" },
        ],
      },
    },
    requiresHuman: true,
    status: "open",
    dedupeKey: "dedupe:suggestion-1",
    bucket: "needs_decision",
    createdAt: 1,
    actedAt: null,
    acceptSource: null,
  };
  return { ...base, ...overrides } as SuggestionSummary;
}

function createGoalDetail(overrides: Partial<GoalDetail> = {}): GoalDetail {
  return {
    id: "goal-1",
    projectId: "project-1",
    title: "Launch feature",
    description: "Ship the new flow",
    status: "in_progress",
    progress: 42,
    priority: "urgent",
    deadline: null,
    parentGoalId: null,
    machineId: "machine-1",
    createdBy: "user-1",
    plannerTaskId: null,
    createdAt: 1,
    updatedAt: 2,
    subGoalCount: 1,
    taskCount: 2,
    decisionCount: 1,
    taskStatusSummary: {
      dispatching: 0,
      queued: 1,
      running: 1,
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
    latestSession: {
      sessionId: "session-1",
      taskId: "task-1",
      taskTitle: "Implement UI",
      status: "running",
      updatedAt: 2,
    },
    blocker: null,
    tasks: [
      {
        id: "task-1",
        title: "Implement UI",
        status: "running",
        sessionId: "session-1",
        roleType: "builder",
        promptPreview: "Do the UI work",
        priority: "user",
        createdAt: 1,
        completedAt: null,
      },
      {
        id: "task-2",
        title: "Write tests",
        status: "queued",
        sessionId: null,
        roleType: "builder",
        promptPreview: "Add tests",
        priority: "user",
        createdAt: 1,
        completedAt: null,
      },
    ],
    subGoals: [
      {
        id: "subgoal-1",
        title: "Polish UX",
        status: "planning",
        progress: 0,
        priority: "normal",
      },
    ],
    blockers: [
      {
        kind: "task_failed",
        summary: "Task failed: API migration",
        sourceTaskId: "task-3",
        requiresHuman: false,
      },
    ],
    decisions: [
      {
        id: "decision-1",
        question: "Use modal or sheet?",
        status: "pending",
        createdAt: 1,
      },
    ],
    ...overrides,
  };
}

describe("deriveGoalDetailScreenState", () => {
  it("returns loading state while request is in flight", () => {
    expect(deriveGoalDetailScreenState({ loading: true, goal: null, error: null })).toEqual({ kind: "loading" });
  });

  it("returns error state when request fails", () => {
    expect(deriveGoalDetailScreenState({ loading: false, goal: null, error: "boom" })).toEqual({ kind: "error", message: "boom" });
  });

  it("returns empty state when goal is missing", () => {
    expect(deriveGoalDetailScreenState({ loading: false, goal: null, error: null })).toEqual({ kind: "empty" });
  });

  it("returns ready state when goal data is available", () => {
    const goal = createGoalDetail();
    expect(deriveGoalDetailScreenState({ loading: false, goal, error: null })).toEqual({ kind: "ready" });
  });
});

describe("buildGoalDetailSections", () => {
  it("builds hero badges and detail sections", () => {
    const result = buildGoalDetailSections(createGoalDetail());

    expect(result.hero.badges).toContain("in_progress");
    expect(result.hero.badges).toContain("urgent");
    expect(result.hero.progressLabel).toBe("42%");
    expect(result.hero.stats).toEqual([
      { label: "tasks", value: "2" },
      { label: "subGoals", value: "1" },
      { label: "decisions", value: "1" },
    ]);
    expect(result.sections.map((section) => section.key)).toEqual([
      "latest-session",
      "tasks",
      "subgoals",
      "blockers",
      "decisions",
    ]);
  });
});

describe("filterGoalDetailSuggestions", () => {
  it("keeps only suggestions linked to the current goal", () => {
    const result = filterGoalDetailSuggestions([
      createSuggestion({ id: "s1", relatedGoalId: "goal-1" }),
      createSuggestion({ id: "s2", relatedGoalId: "goal-2" }),
      createSuggestion({ id: "s3", relatedGoalId: null }),
    ], "goal-1");

    expect(result.map((item: SuggestionSummary) => item.id)).toEqual(["s1"]);
  });
});
