import { describe, expect, it } from "vitest";
import {
    failedTaskFollowup,
    blockedGoalDecompose,
    pendingDecisionInvestigate,
    completedTaskSkill,
} from "./worldSuggestionGenerate";

describe("failedTaskFollowup", () => {
    it("should generate a suggested_task for a failed task with error message", () => {
        const result = failedTaskFollowup(
            {
                id: "task-1",
                title: "Fix auth endpoint",
                errorMessage: "Connection refused: ECONNREFUSED 127.0.0.1:5432",
                goalId: "goal-1",
            },
            "Build a better auth system",
        );

        expect(result.type).toBe("suggested_task");
        expect(result.dedupeKey).toBe("failed_task:task-1");
        expect(result.relatedGoalId).toBe("goal-1");
        expect(result.relatedTaskId).toBe("task-1");
        expect(result.requiresHuman).toBe(true);
        expect(result.evidence).toHaveLength(1);
        expect(result.evidence[0].kind).toBe("task");
        expect(result.evidence[0].id).toBe("task-1");
        expect(result.payload.task).toBeDefined();
        expect(result.payload.task!.goalId).toBe("goal-1");
        expect(result.payload.task!.prompt).toContain("Connection refused");
    });

    it("should handle missing error message", () => {
        const result = failedTaskFollowup(
            { id: "task-2", title: "Deploy", errorMessage: null, goalId: null },
            null,
        );

        expect(result.reason).toContain("Unknown error");
        expect(result.relatedGoalId).toBeNull();
        expect(result.payload.task!.goalId).toBeUndefined();
    });

    it("should handle missing title", () => {
        const result = failedTaskFollowup(
            { id: "task-3", title: null, errorMessage: "Oops", goalId: null },
            null,
        );

        expect(result.title).toContain("task-3");
        expect(result.evidence[0].label).toContain("task-3");
    });
});

describe("blockedGoalDecompose", () => {
    it("should generate suggestion with failed task as blocker source", () => {
        const result = blockedGoalDecompose(
            {
                id: "goal-1",
                title: "Ship v2.0",
                description: "Release version 2.0",
                tasks: [{ id: "task-1", title: "Build UI", errorMessage: "Component not found" }],
            },
            null,
        );

        expect(result.type).toBe("suggested_task");
        expect(result.dedupeKey).toBe("blocked_goal:goal-1");
        expect(result.relatedGoalId).toBe("goal-1");
        expect(result.relatedTaskId).toBe("task-1");
        expect(result.evidence).toHaveLength(2); // goal + task
        expect(result.evidence[0].kind).toBe("goal");
        expect(result.evidence[1].kind).toBe("task");
        expect(result.reason).toContain("Component not found");
        expect(result.payload.task!.goalId).toBe("goal-1");
    });

    it("should handle blocked goal with no failed tasks", () => {
        const result = blockedGoalDecompose(
            {
                id: "goal-2",
                title: "Migrate DB",
                description: null,
                tasks: [],
            },
            null,
        );

        expect(result.evidence).toHaveLength(1); // just goal
        expect(result.reason).toContain("blocked");
    });

    it("should handle no blocker source gracefully", () => {
        const result = blockedGoalDecompose(
            {
                id: "goal-3",
                title: "Unknown block",
                description: null,
                tasks: [],
            },
            null,
        );

        expect(result.evidence).toHaveLength(1); // just goal
        expect(result.reason).toContain("blocked");
    });
});

describe("pendingDecisionInvestigate", () => {
    it("should generate a suggested_task for a pending decision", () => {
        const result = pendingDecisionInvestigate(
            { id: "dec-1", question: "Should we use PostgreSQL or MongoDB?", goalId: "goal-1" },
            null,
        );

        expect(result.type).toBe("suggested_task");
        expect(result.dedupeKey).toBe("pending_decision:dec-1");
        expect(result.relatedGoalId).toBe("goal-1");
        expect(result.relatedTaskId).toBeNull();
        expect(result.evidence).toHaveLength(1);
        expect(result.evidence[0].kind).toBe("decision");
        expect(result.payload.task!.prompt).toContain("PostgreSQL or MongoDB");
    });

    it("should handle null goalId", () => {
        const result = pendingDecisionInvestigate(
            { id: "dec-2", question: "Pick a framework", goalId: null },
            null,
        );

        expect(result.relatedGoalId).toBeNull();
        expect(result.payload.task!.goalId).toBeUndefined();
    });

    it("should truncate long question in title", () => {
        const longQuestion = "A".repeat(200);
        const result = pendingDecisionInvestigate(
            { id: "dec-3", question: longQuestion, goalId: null },
            null,
        );

        expect(result.title.length).toBeLessThanOrEqual(70); // "Investigate: " + 50 + "..."
    });
});

describe("completedTaskSkill", () => {
    it("should generate a suggested_skill for a completed task", () => {
        const result = completedTaskSkill({
            id: "task-1",
            title: "Refactor auth middleware",
            goalId: "goal-1",
            sessionId: "session-1",
        });

        expect(result.type).toBe("suggested_skill");
        expect(result.dedupeKey).toBe("completed_task_skill:task-1");
        expect(result.relatedGoalId).toBe("goal-1");
        expect(result.relatedTaskId).toBe("task-1");
        expect(result.requiresHuman).toBe(true);
        expect(result.evidence).toHaveLength(1);
        expect(result.evidence[0].kind).toBe("task");
        expect(result.payload.skill).toBeDefined();
        expect(result.payload.skill!.title).toBe("Refactor auth middleware");
        expect(result.payload.skill!.sourceTaskId).toBe("task-1");
        expect(result.payload.skill!.content).toContain("# Refactor auth middleware");
    });

    it("should handle null goalId and sessionId", () => {
        const result = completedTaskSkill({
            id: "task-2",
            title: "Quick fix",
            goalId: null,
            sessionId: null,
        });

        expect(result.relatedGoalId).toBeNull();
        expect(result.payload.skill!.title).toBe("Quick fix");
    });
});
