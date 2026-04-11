import { describe, expect, it } from "vitest";
import { serializeSuggestion } from "./worldSuggestionTypes";

describe("serializeSuggestion", () => {
    it("should serialize a suggestion row to API format", () => {
        const row = {
            id: "sug-1",
            projectId: "proj-1",
            relatedGoalId: "goal-1",
            relatedTaskId: "task-1",
            type: "suggested_decision",
            title: "Review decision",
            summary: "Decision needs attention",
            reason: "Decision pending",
            evidence: JSON.stringify([{ kind: "decision", id: "dec-1", label: "Review decision" }]),
            recommendedRole: null,
            payload: JSON.stringify({ decision: { question: "Fix it", existingDecisionId: "dec-1", options: [{ id: "a", description: "A" }, { id: "b", description: "B" }] } }),
            requiresHuman: true,
            status: "expired",
            dedupeKey: "failed_task_followup:task-1:1:3:boom",
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
