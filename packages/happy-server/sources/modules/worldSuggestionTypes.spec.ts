import { describe, expect, it } from "vitest";
import { serializeSuggestion } from "./worldSuggestionTypes";

describe("serializeSuggestion", () => {
    it("should serialize a suggestion row to API format", () => {
        const row = {
            id: "sug-1",
            projectId: "proj-1",
            relatedGoalId: "goal-1",
            relatedTaskId: "task-1",
            type: "suggested_task",
            title: "Fix: API endpoint",
            summary: "Task failed, needs follow-up",
            reason: "Task failed with: connection timeout",
            evidence: JSON.stringify([{ kind: "task", id: "task-1", label: "Failed: API endpoint" }]),
            recommendedRole: "builder",
            payload: JSON.stringify({ task: { title: "Fix it", prompt: "Do the fix", priority: "user" } }),
            requiresHuman: true,
            status: "open",
            dedupeKey: "failed_task:task-1",
            createdAt: new Date("2026-04-10T10:00:00Z"),
            actedAt: null,
        };

        const result = serializeSuggestion(row);

        expect(result).toEqual({
            id: "sug-1",
            projectId: "proj-1",
            relatedGoalId: "goal-1",
            relatedTaskId: "task-1",
            type: "suggested_task",
            title: "Fix: API endpoint",
            summary: "Task failed, needs follow-up",
            reason: "Task failed with: connection timeout",
            evidence: [{ kind: "task", id: "task-1", label: "Failed: API endpoint" }],
            recommendedRole: "builder",
            payload: { task: { title: "Fix it", prompt: "Do the fix", priority: "user" } },
            requiresHuman: true,
            status: "open",
            dedupeKey: "failed_task:task-1",
            createdAt: new Date("2026-04-10T10:00:00Z").getTime(),
            actedAt: null,
        });
    });

    it("should handle malformed JSON gracefully", () => {
        const row = {
            id: "sug-2",
            projectId: "proj-1",
            relatedGoalId: null,
            relatedTaskId: null,
            type: "suggested_goal",
            title: "Test",
            summary: "Test",
            reason: "Test",
            evidence: "not-json",
            recommendedRole: null,
            payload: "{broken",
            requiresHuman: true,
            status: "open",
            dedupeKey: "test:1",
            createdAt: new Date("2026-04-10T10:00:00Z"),
            actedAt: new Date("2026-04-10T12:00:00Z"),
        };

        const result = serializeSuggestion(row);

        expect(result.evidence).toEqual([]);
        expect(result.payload).toEqual({});
        expect(result.actedAt).toBe(new Date("2026-04-10T12:00:00Z").getTime());
    });
});
