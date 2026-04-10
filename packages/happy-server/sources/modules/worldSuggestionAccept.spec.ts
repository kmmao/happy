import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    emitEphemeral,
    buildTaskTriggerEphemeral,
    buildWorldSuggestionUpdatedEphemeral,
    createTaskResultToken,
    decisionCreate,
    tx,
    dbMock,
} = vi.hoisted(() => ({
    emitEphemeral: vi.fn(),
    buildTaskTriggerEphemeral: vi.fn((payload: unknown) => payload),
    buildWorldSuggestionUpdatedEphemeral: vi.fn((payload: unknown) => payload),
    createTaskResultToken: vi.fn(async ({ taskId }: { taskId: string }) => `task-token-for-${taskId}`),
    decisionCreate: vi.fn(),
    tx: {
        worldSuggestion: {
            findFirst: vi.fn(async () => ({ id: "suggestion-1" })),
            update: vi.fn(async () => ({})),
        },
        task: {
            create: vi.fn(async ({ data }: any) => ({ id: "task-1", priority: data.priority })),
            update: vi.fn(async () => ({})),
        },
        skill: {
            create: vi.fn(),
        },
        decision: {
            create: vi.fn(async ({ data }: any) => ({ id: data.question === "What next?" ? "decision-2" : "decision-1" })),
            findFirst: vi.fn(),
            update: vi.fn(async () => ({})),
        },
    },
    dbMock: {
        project: {
            findFirst: vi.fn(async () => ({ path: "/repo" })),
        },
        worldSuggestion: {
            findFirst: vi.fn(async () => ({
                id: "suggestion-1",
                type: "suggested_task",
                payload: JSON.stringify({
                    task: {
                        title: "Fix build",
                        prompt: "Investigate failing build",
                        priority: "user",
                    },
                }),
                relatedGoalId: null,
                status: "open",
            })),
            update: vi.fn(async () => ({})),
        },
        decision: {
            findFirst: vi.fn(),
        },
        task: {
            findFirst: vi.fn(async () => ({ machineId: "machine-1" })),
            update: vi.fn(async () => ({})),
        },
    },
}));

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/storage/inTx", () => ({
    inTx: vi.fn(async (fn: any) => fn(tx)),
    afterTx: vi.fn((_tx: any, callback: () => void) => callback()),
}));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitEphemeral },
    buildTaskTriggerEphemeral,
    buildWorldSuggestionUpdatedEphemeral,
}));
vi.mock("@/app/auth/auth", () => ({
    auth: { createTaskResultToken },
}));
const { goalCreate } = vi.hoisted(() => ({
    goalCreate: vi.fn(async () => ({ id: "goal-1" })),
}));

vi.mock("./goalCreate", () => ({ goalCreate }));
vi.mock("./decisionCreate", () => ({ decisionCreate }));

import { worldSuggestionAccept } from "./worldSuggestionAccept";

describe("worldSuggestionAccept", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("suspends suggested_goal when goal creation fails after processing claim", async () => {
        dbMock.worldSuggestion.findFirst.mockResolvedValueOnce({
            id: "suggestion-goal-1",
            type: "suggested_goal",
            payload: JSON.stringify({
                goal: {
                    title: "Ship feature",
                    detail: "Finish the remaining work",
                    priority: "urgent",
                },
            }),
            relatedGoalId: null,
            status: "open",
        });
        goalCreate.mockRejectedValueOnce(new Error("planner unavailable"));

        await expect(worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-goal-1",
        })).rejects.toThrow("planner unavailable");

        expect(tx.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "suggestion-goal-1" },
            data: { status: "processing", actedAt: expect.any(Date) },
        });
        expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "suggestion-goal-1" },
            data: { status: "suspended" },
        });
        expect(buildWorldSuggestionUpdatedEphemeral).toHaveBeenCalledWith({
            projectId: "project-1",
            suggestionId: "suggestion-goal-1",
            status: "processing",
        });
        expect(buildWorldSuggestionUpdatedEphemeral).toHaveBeenCalledWith({
            projectId: "project-1",
            suggestionId: "suggestion-goal-1",
            status: "suspended",
        });
    });

    it("includes resultToken when dispatching accepted suggested task", async () => {
        const result = await worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-1",
        });

        await Promise.resolve();

        expect(result.createdEntityType).toBe("task");
        expect(buildWorldSuggestionUpdatedEphemeral).toHaveBeenCalledWith({
            projectId: "project-1",
            suggestionId: "suggestion-1",
            status: "accepted",
        });
        expect(createTaskResultToken).toHaveBeenCalledWith({
            userId: "user-1",
            taskId: "task-1",
        });
        expect(buildTaskTriggerEphemeral).toHaveBeenCalledWith(expect.objectContaining({
            taskId: "task-1",
            resultToken: "task-token-for-task-1",
        }));
    });

    it("marks accepted suggested task as failed when dispatch setup throws", async () => {
        createTaskResultToken.mockRejectedValueOnce(new Error("token failed"));

        await worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-1",
        });

        await Promise.resolve();
        await Promise.resolve();

        expect(dbMock.task.update).toHaveBeenCalledWith({
            where: { id: "task-1" },
            data: { status: "failed", errorMessage: "Task dispatch failed: token failed" },
        });
        expect(buildWorldSuggestionUpdatedEphemeral).toHaveBeenCalledWith({
            projectId: "project-1",
            suggestionId: "suggestion-1",
            status: "accepted",
        });
    });

    it("accepts suggested_decision when existing decision is still pending", async () => {
        dbMock.worldSuggestion.findFirst.mockResolvedValueOnce({
            id: "suggestion-2",
            type: "suggested_decision",
            payload: JSON.stringify({
                decision: {
                    question: "What next?",
                    existingDecisionId: "decision-2",
                    options: [
                        { id: "a", description: "A" },
                        { id: "b", description: "B" },
                    ],
                },
            }),
            relatedGoalId: null,
            status: "open",
        });
        tx.decision.findFirst.mockResolvedValueOnce({ id: "decision-2" });

        const result = await worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-2",
        });

        expect(result).toEqual({
            suggestionId: "suggestion-2",
            createdEntityType: "decision",
            createdEntityId: "decision-2",
        });
        expect(tx.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "suggestion-2" },
            data: { status: "accepted", actedAt: expect.any(Date) },
        });
    });

    it("creates a new decision when suggested_decision has no existing decision id", async () => {
        dbMock.worldSuggestion.findFirst.mockResolvedValueOnce({
            id: "suggestion-3",
            type: "suggested_decision",
            payload: JSON.stringify({
                decision: {
                    question: "What next?",
                    options: [
                        { id: "a", description: "A" },
                        { id: "b", description: "B" },
                    ],
                    context: "Need a call",
                    precedentKey: "next-step",
                    goalId: "goal-7",
                },
            }),
            relatedGoalId: null,
            status: "open",
        });

        const result = await worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-3",
        });

        expect(tx.decision.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                accountId: "user-1",
                projectId: "project-1",
                question: "What next?",
                context: "Need a call",
                precedentKey: "next-step",
                goalId: "goal-7",
            }),
        });
        expect(result).toEqual({
            suggestionId: "suggestion-3",
            createdEntityType: "decision",
            createdEntityId: "decision-2",
        });
        expect(tx.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "suggestion-3" },
            data: { status: "accepted", actedAt: expect.any(Date) },
        });
    });

    it("accepts suggested_decision when existing decision is expired", async () => {
        dbMock.worldSuggestion.findFirst.mockResolvedValueOnce({
            id: "suggestion-expired-decision",
            type: "suggested_decision",
            payload: JSON.stringify({
                decision: {
                    question: "What next?",
                    existingDecisionId: "decision-expired",
                    options: [
                        { id: "a", description: "A" },
                        { id: "b", description: "B" },
                    ],
                },
            }),
            relatedGoalId: null,
            status: "open",
        });
        tx.decision.findFirst.mockResolvedValueOnce({ id: "decision-expired", status: "expired" });

        const result = await worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-expired-decision",
        });

        expect(result).toEqual({
            suggestionId: "suggestion-expired-decision",
            createdEntityType: "decision",
            createdEntityId: "decision-expired",
        });
        expect(tx.decision.findFirst).toHaveBeenCalledWith({
            where: {
                id: "decision-expired",
                accountId: "user-1",
                projectId: "project-1",
                status: { in: ["pending", "expired"] },
            },
            select: { id: true, status: true },
        });
        expect(tx.decision.update).toHaveBeenCalledWith({
            where: { id: "decision-expired" },
            data: {
                status: "pending",
                expiresAt: expect.any(Date),
            },
        });
    });

    it("rejects accepting suggested_decision when existing decision is not pending in project", async () => {
        dbMock.worldSuggestion.findFirst.mockResolvedValueOnce({
            id: "suggestion-2",
            type: "suggested_decision",
            payload: JSON.stringify({
                decision: {
                    question: "What next?",
                    existingDecisionId: "decision-2",
                    options: [
                        { id: "a", description: "A" },
                        { id: "b", description: "B" },
                    ],
                },
            }),
            relatedGoalId: null,
            status: "open",
        });
        tx.decision.findFirst.mockResolvedValueOnce(null);

        await expect(worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-2",
        })).rejects.toThrow("Decision not found or no longer pending");

        expect(tx.worldSuggestion.update).not.toHaveBeenCalled();
        expect(decisionCreate).not.toHaveBeenCalled();
    });
});
