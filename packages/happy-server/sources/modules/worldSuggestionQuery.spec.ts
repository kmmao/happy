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
                        .slice(0, args.take ?? state.suggestions.length)
                        .map((row) => ({
                            id: row.id,
                            type: row.type,
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
});
