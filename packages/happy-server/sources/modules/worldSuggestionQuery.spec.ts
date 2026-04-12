import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, state, resetState } = vi.hoisted(() => {
    const state = {
        suggestions: [] as Array<any>,
    };

    const resetState = () => {
        state.suggestions = [];
    };

    const dbMock = {
        worldSuggestion: {
            findMany: vi.fn(async (args: any) => {
                if (args?.select?.id && args?.select?.bucket) {
                    return state.suggestions
                        .filter((row) => row.accountId === args.where.accountId)
                        .filter((row) => row.projectId === args.where.projectId)
                        .filter((row) => !args.where.status?.in || args.where.status.in.includes(row.status))
                        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                        .slice(0, args.take ?? state.suggestions.length)
                        .map((row) => ({
                            id: row.id,
                            type: row.type,
                            title: row.title,
                            payload: row.payload,
                            evidence: row.evidence,
                            requiresHuman: row.requiresHuman,
                            bucket: row.bucket,
                        }));
                }

                return state.suggestions
                    .filter((row) => row.accountId === args.where.accountId)
                    .filter((row) => row.projectId === args.where.projectId)
                    .filter((row) => !args.where.relatedGoalId || row.relatedGoalId === args.where.relatedGoalId)
                    .filter((row) => !args.where.bucket || row.bucket === args.where.bucket)
                    .filter((row) => Array.isArray(args.where.status?.in) ? args.where.status.in.includes(row.status) : row.status === args.where.status)
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                    .slice(0, args.take ?? state.suggestions.length);
            }),
            update: vi.fn(async ({ where, data }: any) => {
                const row = state.suggestions.find((item) => item.id === where.id);
                if (row) {
                    row.bucket = data.bucket;
                }
                return row;
            }),
        },
    };

    return { dbMock, state, resetState };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));

import { worldSuggestionQuery } from "./worldSuggestionQuery";

describe("worldSuggestionQuery", () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it("backfills derived bucket before filtering", async () => {
        state.suggestions = [
            {
                id: "sug-1",
                accountId: "user-1",
                projectId: "project-1",
                relatedGoalId: null,
                relatedTaskId: null,
                type: "suggested_decision",
                title: "Need decision",
                summary: "Need decision",
                reason: "Need decision",
                evidence: "[]",
                recommendedRole: null,
                payload: JSON.stringify({ decision: { question: "What next?", options: [{ id: "a", description: "A" }, { id: "b", description: "B" }] } }),
                requiresHuman: true,
                status: "suspended",
                dedupeKey: "dedupe:1",
                bucket: "next_step",
                createdAt: new Date("2026-04-10T10:00:00Z"),
                actedAt: null,
                acceptSource: null,
                acceptAudit: null,
                autoAcceptStatus: null,
                autoAcceptReasonCode: null,
            },
        ];

        const result = await worldSuggestionQuery("user-1", "project-1", {
            status: "open",
            bucket: "needs_decision",
        });

        expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "sug-1" },
            data: { bucket: "needs_decision" },
        });
        expect(result.map((item) => item.id)).toEqual(["sug-1"]);
        expect(result[0]?.bucket).toBe("needs_decision");
    });

    it("derives bucket from normalized payload instead of stale raw branch", async () => {
        state.suggestions = [
            {
                id: "sug-raw-mismatch",
                accountId: "user-1",
                projectId: "project-1",
                relatedGoalId: null,
                relatedTaskId: null,
                type: "suggested_goal",
                title: "Recovered goal",
                summary: "Recovered goal",
                reason: "Recovered goal",
                evidence: "[]",
                recommendedRole: null,
                payload: JSON.stringify({
                    decision: { question: "Wrong branch", options: [{ id: "a", description: "A" }, { id: "b", description: "B" }] },
                }),
                requiresHuman: true,
                status: "open",
                dedupeKey: "dedupe:2",
                bucket: "needs_decision",
                createdAt: new Date("2026-04-10T11:00:00Z"),
                actedAt: null,
                acceptSource: null,
                acceptAudit: null,
                autoAcceptStatus: null,
                autoAcceptReasonCode: null,
            },
        ];

        const result = await worldSuggestionQuery("user-1", "project-1", {
            status: "open",
            bucket: "needs_human_input",
        });

        expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "sug-raw-mismatch" },
            data: { bucket: "needs_human_input" },
        });
        expect(result.map((item) => item.id)).toEqual(["sug-raw-mismatch"]);
        expect(result[0]?.type).toBe("suggested_goal");
        expect(result[0]?.bucket).toBe("needs_human_input");
        expect(result[0]?.payload).toEqual({ goal: { title: "Recovered goal" } });
    });

    it("returns accept source and audit snapshot in serialized suggestions", async () => {
        state.suggestions = [
            {
                id: "sug-auto-1",
                accountId: "user-1",
                projectId: "project-1",
                relatedGoalId: null,
                relatedTaskId: "task-1",
                type: "suggested_task",
                title: "Retry failed API",
                summary: "summary",
                reason: "reason",
                evidence: "[]",
                recommendedRole: "builder",
                payload: JSON.stringify({
                    task: { title: "Retry failed API", prompt: "Inspect retry logic", priority: "user" },
                }),
                requiresHuman: false,
                status: "accepted",
                dedupeKey: "dedupe:auto-1",
                bucket: "next_step",
                createdAt: new Date("2026-04-10T12:00:00Z"),
                actedAt: new Date("2026-04-10T12:05:00Z"),
                acceptSource: "system_auto",
                acceptAudit: JSON.stringify({
                    rule: "safe_suggested_task_auto_accept",
                    checks: ["type:suggested_task"],
                }),
                autoAcceptStatus: null,
                autoAcceptReasonCode: null,
            },
        ];

        const result = await worldSuggestionQuery("user-1", "project-1", {
            status: "accepted",
        });

        expect(result).toEqual([
            expect.objectContaining({
                id: "sug-auto-1",
                acceptSource: "system_auto",
                acceptAudit: {
                    rule: "safe_suggested_task_auto_accept",
                    checks: ["type:suggested_task"],
                },
            }),
        ]);
    });

    it("returns auto-accept skipped and failed outcome fields in serialized suggestions", async () => {
        state.suggestions = [
            {
                id: "sug-skip-1",
                accountId: "user-1",
                projectId: "project-1",
                relatedGoalId: null,
                relatedTaskId: "task-1",
                type: "suggested_task",
                title: "Retry failed API",
                summary: "summary",
                reason: "reason",
                evidence: "[]",
                recommendedRole: "builder",
                payload: JSON.stringify({
                    task: { title: "Retry failed API", prompt: "Inspect retry logic", priority: "user" },
                }),
                requiresHuman: false,
                status: "open",
                dedupeKey: "dedupe:skip-1",
                bucket: "next_step",
                createdAt: new Date("2026-04-10T12:00:00Z"),
                actedAt: null,
                acceptSource: null,
                acceptAudit: null,
                autoAcceptStatus: "skipped",
                autoAcceptReasonCode: "quota_exhausted",
            },
            {
                id: "sug-fail-1",
                accountId: "user-1",
                projectId: "project-1",
                relatedGoalId: null,
                relatedTaskId: "task-2",
                type: "suggested_task",
                title: "Retry failed queue",
                summary: "summary",
                reason: "reason",
                evidence: "[]",
                recommendedRole: "builder",
                payload: JSON.stringify({
                    task: { title: "Retry failed queue", prompt: "Inspect queue", priority: "user" },
                }),
                requiresHuman: false,
                status: "open",
                dedupeKey: "dedupe:fail-1",
                bucket: "next_step",
                createdAt: new Date("2026-04-10T12:10:00Z"),
                actedAt: null,
                acceptSource: null,
                acceptAudit: null,
                autoAcceptStatus: "failed",
                autoAcceptReasonCode: "accept_failed",
            },
        ];

        const result = await worldSuggestionQuery("user-1", "project-1", {
            status: "open",
        });

        expect(result).toEqual([
            expect.objectContaining({
                id: "sug-fail-1",
                autoAcceptStatus: "failed",
                autoAcceptReasonCode: "accept_failed",
            }),
            expect.objectContaining({
                id: "sug-skip-1",
                autoAcceptStatus: "skipped",
                autoAcceptReasonCode: "quota_exhausted",
            }),
        ]);
    });
});
