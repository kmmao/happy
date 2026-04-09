import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    goalFindFirst: vi.fn(),
    taskFindMany: vi.fn(),
    goalUpdate: vi.fn(),
    emitEphemeral: vi.fn(),
    inboxCreate: vi.fn(),
}));

vi.mock("@/storage/db", () => ({
    db: {
        goal: {
            findFirst: mocks.goalFindFirst,
            update: mocks.goalUpdate,
        },
        task: {
            findMany: mocks.taskFindMany,
        },
    },
}));

vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitEphemeral: mocks.emitEphemeral },
    buildGoalProgressEphemeral: vi.fn((payload: unknown) => payload),
}));

vi.mock("./inboxCreate", () => ({
    inboxCreate: mocks.inboxCreate,
}));

vi.mock("@/utils/log", () => ({ log: vi.fn() }));

import { goalProgressUpdate } from "./goalProgressUpdate";

describe("goalProgressUpdate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.goalFindFirst.mockResolvedValue({
            id: "goal-1",
            accountId: "user-1",
            projectId: "project-1",
            title: "Goal 1",
            status: "in_progress",
            parentGoalId: null,
            plannerTaskId: null,
        });
    });

    it("should mark goal as cancelled when all tasks are cancelled", async () => {
        mocks.taskFindMany.mockResolvedValue([
            { status: "cancelled" },
            { status: "cancelled" },
        ]);

        await goalProgressUpdate({ goalId: "goal-1", accountId: "user-1" });

        expect(mocks.goalUpdate).toHaveBeenCalledWith({
            where: { id: "goal-1" },
            data: { progress: 0, status: "cancelled" },
        });
        expect(mocks.emitEphemeral).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({
                    goalId: "goal-1",
                    status: "cancelled",
                    progress: 0,
                }),
            }),
        );
        expect(mocks.inboxCreate).not.toHaveBeenCalled();
    });
});
