import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    emitEphemeral,
    buildTaskTriggerEphemeral,
    buildWorldSuggestionUpdatedEphemeral,
    createTaskResultToken,
    tx,
    dbMock,
} = vi.hoisted(() => ({
    emitEphemeral: vi.fn(),
    buildTaskTriggerEphemeral: vi.fn((payload: unknown) => payload),
    buildWorldSuggestionUpdatedEphemeral: vi.fn((payload: unknown) => payload),
    createTaskResultToken: vi.fn(async ({ taskId }: { taskId: string }) => `task-token-for-${taskId}`),
    tx: {
        worldSuggestion: {
            findFirst: vi.fn(async () => ({ id: "suggestion-1" })),
            update: vi.fn(async () => ({})),
        },
        task: {
            create: vi.fn(async ({ data }: any) => ({ id: "task-1", priority: data.priority, triggerType: data.triggerType })),
            update: vi.fn(async () => ({})),
        },
        skill: {
            create: vi.fn(async () => ({ id: "skill-1" })),
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
            findFirst: vi.fn(async (): Promise<any> => ({
                id: "suggestion-1",
                type: "suggested_task",
                title: "Fix build",
                payload: JSON.stringify({
                    task: {
                        title: "Fix build",
                        prompt: "Investigate failing build",
                        priority: "user",
                    },
                }),
                relatedGoalId: null,
                status: "open",
                acceptSource: null,
                acceptAudit: null,
            })),
            update: vi.fn(async () => ({})),
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

import { worldSuggestionAccept } from "./worldSuggestionAccept";

describe("worldSuggestionAccept", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("suspends suggested_goal when goal creation fails after processing claim", async () => {
        dbMock.worldSuggestion.findFirst.mockResolvedValueOnce({
            id: "suggestion-goal-1",
            type: "suggested_goal",
            title: "Ship feature",
            payload: JSON.stringify({
                goal: {
                    title: "Ship feature",
                    detail: "Finish the remaining work",
                    priority: "urgent",
                },
            }),
            relatedGoalId: null,
            status: "open",
            acceptSource: null,
            acceptAudit: null,
        });
        goalCreate.mockRejectedValueOnce(new Error("planner unavailable"));

        await expect(worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-goal-1",
        })).rejects.toThrow("planner unavailable");

        expect(tx.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "suggestion-goal-1" },
            data: { status: "processing", actedAt: expect.any(Date), acceptSource: "human", acceptAudit: null },
        });
        expect(dbMock.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "suggestion-goal-1" },
            data: { status: "suspended" },
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
        expect(createTaskResultToken).toHaveBeenCalledWith({
            userId: "user-1",
            taskId: "task-1",
        });
        expect(buildTaskTriggerEphemeral).toHaveBeenCalledWith(expect.objectContaining({
            taskId: "task-1",
            resultToken: "task-token-for-task-1",
        }));
    });

    it("marks manual accepts with human audit source and manual trigger type", async () => {
        await worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-1",
        });

        expect(tx.task.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                triggerType: "manual",
            }),
        });
        expect(tx.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "suggestion-1" },
            data: { status: "accepted", actedAt: expect.any(Date), acceptSource: "human", acceptAudit: null },
        });
    });

    it("stores auto-accept audit snapshot with system audit source and suggestion_auto trigger type", async () => {
        await worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-1",
            acceptSource: "system_auto",
            acceptAudit: {
                rule: "safe_suggested_task_auto_accept",
                checks: [
                    "type:suggested_task",
                    "bucket:next_step",
                ],
            },
        });

        expect(tx.task.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                triggerType: "suggestion_auto",
            }),
        });
        expect(tx.worldSuggestion.update).toHaveBeenCalledWith({
            where: { id: "suggestion-1" },
            data: {
                status: "accepted",
                actedAt: expect.any(Date),
                acceptSource: "system_auto",
                acceptAudit: JSON.stringify({
                    rule: "safe_suggested_task_auto_accept",
                    checks: [
                        "type:suggested_task",
                        "bucket:next_step",
                    ],
                }),
            },
        });
    });

    it("rejects suggested_goal when stored payload does not match goal branch", async () => {
        dbMock.worldSuggestion.findFirst.mockResolvedValueOnce({
            id: "suggestion-goal-fallback",
            type: "suggested_goal",
            title: "Recovered goal title",
            payload: JSON.stringify({
                task: {
                    title: "Wrong task payload",
                    prompt: "Should not be used",
                },
            }),
            relatedGoalId: null,
            status: "open",
            acceptSource: null,
            acceptAudit: null,
        });

        await expect(worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-goal-fallback",
        })).rejects.toThrow("Suggestion payload does not match suggestion type");
    });


    it("rejects suggested_task when stored payload does not match task branch", async () => {
        dbMock.worldSuggestion.findFirst.mockResolvedValueOnce({
            id: "suggestion-task-invalid",
            type: "suggested_task",
            title: "Recovered task title",
            payload: JSON.stringify({
                goal: {
                    title: "Wrong goal payload",
                },
            }),
            relatedGoalId: null,
            status: "open",
            acceptSource: null,
            acceptAudit: null,
        });

        await expect(worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-task-invalid",
        })).rejects.toThrow("Suggestion payload does not match suggestion type");
    });

    it("accepts suggested_decision when existing decision is still pending", async () => {
        dbMock.worldSuggestion.findFirst.mockResolvedValueOnce({
            id: "suggestion-2",
            type: "suggested_decision",
            title: "What next?",
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
            acceptSource: null,
            acceptAudit: null,
        });
        tx.decision.findFirst.mockResolvedValueOnce({ id: "decision-2", status: "pending" });

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
    });

    it("rejects accepting suggested_decision when existing decision is not pending in project", async () => {
        dbMock.worldSuggestion.findFirst.mockResolvedValueOnce({
            id: "suggestion-2",
            type: "suggested_decision",
            title: "What next?",
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
            acceptSource: null,
            acceptAudit: null,
        });
        tx.decision.findFirst.mockResolvedValueOnce(null);

        await expect(worldSuggestionAccept({
            accountId: "user-1",
            projectId: "project-1",
            suggestionId: "suggestion-2",
        })).rejects.toThrow("Decision not found or no longer pending");
    });
});
