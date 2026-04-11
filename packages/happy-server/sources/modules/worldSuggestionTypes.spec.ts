import { describe, expect, it } from "vitest";
import { serializeSuggestion } from "./worldSuggestionTypes";

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
        };

        const result = serializeSuggestion(row as any);

        expect(result.evidence).toEqual([]);
        expect(result.payload).toEqual({ goal: { title: "Test" } });
        expect(result.actedAt).toBe(new Date("2026-04-10T12:00:00Z").getTime());
        expect(result.bucket).toBe("needs_human_input");
    });
});
