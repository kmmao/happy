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
            findMany: vi.fn(async (args: any) =>
                state.suggestions
                    .filter((row) => row.accountId === args.where.accountId)
                    .filter((row) => row.projectId === args.where.projectId)
                    .filter((row) => !args.where.relatedGoalId || row.relatedGoalId === args.where.relatedGoalId)
                    .filter((row) => !args.where.bucket || row.bucket === args.where.bucket)
                    .filter((row) => Array.isArray(args.where.status?.in) ? args.where.status.in.includes(row.status) : row.status === args.where.status)
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                    .slice(0, args.take ?? state.suggestions.length),
            ),
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

    it("does not write derived bucket fixes during query reads", async () => {
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
                autoAcceptFailureDetail: null,
            },
        ];

        const result = await worldSuggestionQuery("user-1", "project-1", {
            status: "open",
        });

        expect(dbMock.worldSuggestion.update).not.toHaveBeenCalled();
        expect(result.map((item) => item.id)).toEqual(["sug-1"]);
        expect(result[0]?.bucket).toBe("next_step");
    });

    it("filters by persisted bucket without trying to repair stale rows during query", async () => {
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
                autoAcceptFailureDetail: null,
            },
        ];

        const result = await worldSuggestionQuery("user-1", "project-1", {
            status: "open",
            bucket: "needs_human_input",
        });

        expect(dbMock.worldSuggestion.update).not.toHaveBeenCalled();
        expect(result).toEqual([]);
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
                autoAcceptFailureDetail: null,
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

    it("excludes expired already-acted suggestions from open query results", async () => {
        state.suggestions = [
            {
                id: "sug-expired-race",
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
                status: "expired",
                dedupeKey: "dedupe:expired-1",
                bucket: "next_step",
                createdAt: new Date("2026-04-10T12:00:00Z"),
                actedAt: new Date("2026-04-10T12:05:00Z"),
                acceptSource: null,
                acceptAudit: null,
                autoAcceptStatus: "skipped",
                autoAcceptReasonCode: "already_acted",
                autoAcceptFailureDetail: null,
            },
            {
                id: "sug-open-1",
                accountId: "user-1",
                projectId: "project-1",
                relatedGoalId: null,
                relatedTaskId: "task-2",
                type: "suggested_task",
                title: "Inspect queue",
                summary: "summary",
                reason: "reason",
                evidence: "[]",
                recommendedRole: "builder",
                payload: JSON.stringify({
                    task: { title: "Inspect queue", prompt: "Inspect queue", priority: "user" },
                }),
                requiresHuman: false,
                status: "open",
                dedupeKey: "dedupe:open-1",
                bucket: "next_step",
                createdAt: new Date("2026-04-10T12:10:00Z"),
                actedAt: null,
                acceptSource: null,
                acceptAudit: null,
                autoAcceptStatus: null,
                autoAcceptReasonCode: null,
                autoAcceptFailureDetail: null,
            },
        ];

        const result = await worldSuggestionQuery("user-1", "project-1", {
            status: "open",
        });

        expect(result.map((item) => item.id)).toEqual(["sug-open-1"]);
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
                autoAcceptFailureDetail: null,
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
                autoAcceptFailureDetail: "dispatch_failed",
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
                autoAcceptFailureDetail: "dispatch_failed",
            }),
            expect.objectContaining({
                id: "sug-skip-1",
                autoAcceptStatus: "skipped",
                autoAcceptReasonCode: "quota_exhausted",
            }),
        ]);
    });
});
