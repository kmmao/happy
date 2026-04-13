import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/storage/db";
import { availableSlotsForRole, dispatchQueuedTasksForRole } from "./roleConcurrencyCheck";
import { eventRouter } from "@/app/events/eventRouter";

vi.mock("@/storage/db", () => ({
    db: {
        agentRole: {
            findFirst: vi.fn(),
        },
        task: {
            count: vi.fn(),
            findMany: vi.fn(),
            update: vi.fn(),
        },
    },
}));

vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: {
        emitEphemeral: vi.fn(),
    },
    buildTaskTriggerEphemeral: vi.fn((opts) => ({ type: "task-trigger", ...opts })),
}));

describe("roleConcurrencyCheck", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("availableSlotsForRole", () => {
        it("should return Infinity if role not found", async () => {
            vi.mocked(db.agentRole.findFirst).mockResolvedValue(null);

            const slots = await availableSlotsForRole({
                accountId: "acc1",
                projectId: "proj1",
                roleType: "builder",
            });

            expect(slots).toBe(Infinity);
        });

        it("should return available slots when under limit", async () => {
            vi.mocked(db.agentRole.findFirst).mockResolvedValue({
                maxConcurrency: 3,
            } as any);
            vi.mocked(db.task.count).mockResolvedValue(1);

            const slots = await availableSlotsForRole({
                accountId: "acc1",
                projectId: "proj1",
                roleType: "builder",
            });

            expect(slots).toBe(2);
            expect(db.task.count).toHaveBeenCalledWith({
                where: {
                    accountId: "acc1",
                    projectId: "proj1",
                    roleType: "builder",
                    status: { in: ["dispatching", "running", "waiting_decision"] },
                },
            });
        });

        it("should return 0 when at limit", async () => {
            vi.mocked(db.agentRole.findFirst).mockResolvedValue({
                maxConcurrency: 2,
            } as any);
            vi.mocked(db.task.count).mockResolvedValue(2);

            const slots = await availableSlotsForRole({
                accountId: "acc1",
                projectId: "proj1",
                roleType: "builder",
            });

            expect(slots).toBe(0);
        });

        it("should account for alreadyActive counter", async () => {
            vi.mocked(db.agentRole.findFirst).mockResolvedValue({
                maxConcurrency: 5,
            } as any);
            vi.mocked(db.task.count).mockResolvedValue(2);

            const slots = await availableSlotsForRole({
                accountId: "acc1",
                projectId: "proj1",
                roleType: "builder",
                alreadyActive: 1,
            });

            expect(slots).toBe(2); // 5 - 2 - 1 = 2
        });
    });

    describe("dispatchQueuedTasksForRole", () => {
        it("should do nothing if role not found", async () => {
            vi.mocked(db.agentRole.findFirst).mockResolvedValue(null);

            await dispatchQueuedTasksForRole({
                accountId: "acc1",
                projectId: "proj1",
                roleType: "builder",
                machineId: "m1",
            });

            expect(db.task.findMany).not.toHaveBeenCalled();
        });

        it("should do nothing if no available slots", async () => {
            vi.mocked(db.agentRole.findFirst).mockResolvedValue({
                maxConcurrency: 2,
                agentType: null,
                modelOverride: null,
            } as any);
            vi.mocked(db.task.count).mockResolvedValue(2);

            await dispatchQueuedTasksForRole({
                accountId: "acc1",
                projectId: "proj1",
                roleType: "builder",
                machineId: "m1",
            });

            expect(db.task.findMany).not.toHaveBeenCalled();
        });

        it("should dispatch queued tasks when slots available", async () => {
            vi.mocked(db.agentRole.findFirst).mockResolvedValue({
                maxConcurrency: 3,
                agentType: "claude",
                modelOverride: "claude-opus-4",
            } as any);
            vi.mocked(db.task.count).mockResolvedValue(1);
            vi.mocked(db.task.findMany).mockResolvedValue([
                {
                    id: "task1",
                    prompt: "Build feature X",
                    directory: "/project",
                    priority: "user",
                    projectId: "proj1",
                    machineId: "m1",
                },
                {
                    id: "task2",
                    prompt: "Build feature Y",
                    directory: "/project",
                    priority: "urgent",
                    projectId: "proj1",
                    machineId: "m1",
                },
            ] as any);
            vi.mocked(db.task.update).mockResolvedValue({} as any);

            await dispatchQueuedTasksForRole({
                accountId: "acc1",
                projectId: "proj1",
                roleType: "builder",
                machineId: "m1",
            });

            expect(db.task.findMany).toHaveBeenCalledWith({
                where: { accountId: "acc1", projectId: "proj1", roleType: "builder", status: "queued" },
                orderBy: { createdAt: "asc" },
                take: 2,
            });

            expect(db.task.update).toHaveBeenCalledTimes(2);
            expect(db.task.update).toHaveBeenCalledWith({
                where: { id: "task1" },
                data: { status: "dispatching" },
            });

            expect(eventRouter.emitEphemeral).toHaveBeenCalledTimes(2);
            expect(eventRouter.emitEphemeral).toHaveBeenCalledWith({
                userId: "acc1",
                payload: expect.objectContaining({
                    type: "task-trigger",
                    taskId: "task1",
                    agentType: "claude",
                    modelOverride: "claude-opus-4",
                }),
                recipientFilter: {
                    type: "machine-scoped-only",
                    machineId: "m1",
                },
            });
        });

        it("should respect slot limit when dispatching", async () => {
            vi.mocked(db.agentRole.findFirst).mockResolvedValue({
                maxConcurrency: 2,
                agentType: null,
                modelOverride: null,
            } as any);
            vi.mocked(db.task.count).mockResolvedValue(1);
            vi.mocked(db.task.findMany).mockResolvedValue([
                { id: "task1", prompt: "A", directory: "/p", priority: "user", projectId: "proj1", machineId: "m1" },
                { id: "task2", prompt: "B", directory: "/p", priority: "user", projectId: "proj1", machineId: "m1" },
                { id: "task3", prompt: "C", directory: "/p", priority: "user", projectId: "proj1", machineId: "m1" },
            ] as any);
            vi.mocked(db.task.update).mockResolvedValue({} as any);

            await dispatchQueuedTasksForRole({
                accountId: "acc1",
                projectId: "proj1",
                roleType: "builder",
                machineId: "m1",
            });

            expect(db.task.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ take: 1 }),
            );
        });
    });
});
