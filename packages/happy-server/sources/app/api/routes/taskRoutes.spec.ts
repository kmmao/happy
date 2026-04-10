import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fastify } from "../types";

type TaskRecord = {
    id: string;
    accountId: string;
    projectId: string | null;
    machineId: string;
    prompt: string;
    priority: "urgent" | "user" | "background";
    status: "queued" | "dispatching" | "running" | "completed" | "failed" | "cancelled";
    attempt: number;
    maxAttempts: number;
    sessionId: string | null;
    errorMessage: string | null;
    dispatchedAt: Date | null;
    completedAt: Date | null;
    goalId: string | null;
    triggerType: string;
    triggerRef: string | null;
    createdAt: Date;
    updatedAt: Date;
};

const { state, dbMock, resetState, seedTask, goalProgressUpdateMock, authMock } = vi.hoisted(() => {
    const state = {
        tasks: [] as TaskRecord[],
    };

    const resetState = () => {
        state.tasks = [];
    };

    const seedTask = (input: Partial<TaskRecord> & Pick<TaskRecord, "id" | "accountId" | "machineId">) => {
        const now = new Date();
        state.tasks.push({
            id: input.id,
            accountId: input.accountId,
            projectId: input.projectId ?? "project-1",
            machineId: input.machineId,
            prompt: input.prompt ?? "encrypted-prompt",
            priority: input.priority ?? "user",
            status: input.status ?? "running",
            attempt: input.attempt ?? 0,
            maxAttempts: input.maxAttempts ?? 3,
            sessionId: input.sessionId ?? null,
            errorMessage: input.errorMessage ?? null,
            dispatchedAt: input.dispatchedAt ?? null,
            completedAt: input.completedAt ?? null,
            goalId: input.goalId ?? "goal-1",
            triggerType: input.triggerType ?? "manual",
            triggerRef: input.triggerRef ?? null,
            createdAt: input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
        });
    };

    const taskFindFirst = vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        return state.tasks.find((task) => (
            task.id === where.id
            && task.accountId === where.accountId
        )) ?? null;
    });

    const taskUpdate = vi.fn(async (args: any) => {
        const task = state.tasks.find((item) => item.id === args.where.id);
        if (!task) {
            throw new Error("Task not found");
        }
        Object.assign(task, args.data, { updatedAt: new Date() });
        return {
            ...task,
            skillBindings: [],
        };
    });

    const dbMock = {
        machine: {
            findFirst: vi.fn(async () => ({ id: "machine-1" })),
        },
        task: {
            findFirst: taskFindFirst,
            update: taskUpdate,
            create: vi.fn(async ({ data }: any) => ({ ...data, id: "task-created", createdAt: new Date(), updatedAt: new Date(), skillBindings: [] })),
            findMany: vi.fn(async () => []),
            count: vi.fn(async () => 0),
            delete: vi.fn(),
        },
        project: {
            findFirst: vi.fn(async () => ({ id: "project-1", path: "/repo" })),
        },
        skill: {
            findMany: vi.fn(async () => []),
        },
        taskSkillBinding: {
            findMany: vi.fn(async () => []),
        },
        repeatKey: {
            findUnique: vi.fn(async () => null),
            upsert: vi.fn(async () => ({})),
        },
        $transaction: vi.fn(async (fn: any) => fn(dbMock as any)),
    };

    const authMock = {
        verifyTaskResultToken: vi.fn(async () => null),
        createTaskResultToken: vi.fn(async ({ taskId }: { taskId: string }) => `task-token-for-${taskId}`),
    };

    const goalProgressUpdateMock = vi.fn();

    return { state, dbMock, resetState, seedTask, goalProgressUpdateMock, authMock };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/utils/log", () => ({ log: vi.fn() }));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitEphemeral: vi.fn() },
    buildTaskTriggerEphemeral: vi.fn((payload: unknown) => payload),
    buildTaskStatusChangedEphemeral: vi.fn((payload: unknown) => payload),
}));
vi.mock("@/modules/goalProgressUpdate", () => ({
    goalProgressUpdate: goalProgressUpdateMock,
}));
vi.mock("@/app/auth/auth", () => ({
    auth: authMock,
}));

import { taskRoutes } from "./taskRoutes";

async function createApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;

    typed.decorate("authenticate", async (request: any, reply: any) => {
        const userId = request.headers["x-user-id"];
        if (typeof userId !== "string") {
            return reply.code(401).send({ error: "Unauthorized" });
        }
        request.userId = userId;
    });

    taskRoutes(typed);
    await typed.ready();
    return typed;
}

describe("taskRoutes POST /v1/tasks", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it("rejects unknown projectId instead of silently falling back to home directory", async () => {
        dbMock.project.findFirst.mockImplementationOnce(async () => null as any);
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks",
            headers: { "x-user-id": "user-1" },
            payload: {
                machineId: "machine-1",
                projectId: "missing-project",
                prompt: "do work",
            },
        });

        expect(res.statusCode).toBe(404);
        expect(res.json().error).toContain("Project not found");
        expect(dbMock.task.create).not.toHaveBeenCalled();
    });

    it("includes a task-scoped result token in dispatched task trigger payload", async () => {
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks",
            headers: { "x-user-id": "user-1" },
            payload: {
                machineId: "machine-1",
                projectId: "project-1",
                prompt: "do work",
            },
        });

        expect(res.statusCode).toBe(201);
        const { buildTaskTriggerEphemeral } = await import("@/app/events/eventRouter");
        expect(buildTaskTriggerEphemeral).toHaveBeenCalled();
        const payload = (buildTaskTriggerEphemeral as any).mock.calls[0][0];
        expect(payload.resultToken).toBeTypeOf("string");
    });
});

describe("taskRoutes POST /v1/tasks/status", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it("maps blocked outcome to failed even when incoming status is non-terminal-compatible", async () => {
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "running",
            goalId: "goal-1",
        });
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks/status",
            headers: { "x-user-id": "user-1" },
            payload: {
                taskId: "task-1",
                status: "completed",
                outcome: "blocked",
                errorMessage: "Need human decision before continuing",
            },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().task.status).toBe("failed");
        expect(res.json().task.errorMessage).toContain("Need human decision");
        expect(state.tasks[0]?.status).toBe("failed");
    });

    it("treats repeated terminal status report as idempotent no-op", async () => {
        const completedAt = new Date("2026-04-09T00:00:00Z");
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "failed",
            completedAt,
            errorMessage: "original failure",
            goalId: "goal-1",
        });
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks/status",
            headers: { "x-user-id": "user-1" },
            payload: {
                taskId: "task-1",
                status: "failed",
                outcome: "failed",
                errorMessage: "duplicate failure",
            },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().ignored).toBe(true);
        expect(state.tasks[0]?.completedAt?.getTime()).toBe(completedAt.getTime());
        expect(state.tasks[0]?.errorMessage).toBe("original failure");
        expect(dbMock.task.update).toHaveBeenCalledTimes(0);
        expect(goalProgressUpdateMock).not.toHaveBeenCalled();
    });
});

describe("taskRoutes POST /v1/tasks/result", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it("accepts a valid task-scoped token without user auth decorator", async () => {
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "running",
            goalId: "goal-1",
        });
        authMock.verifyTaskResultToken.mockImplementationOnce(async () => ({
            userId: "user-1",
            taskId: "task-1",
            scope: "task-result",
            jti: "jti-1",
        } as any));
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks/result",
            headers: { authorization: "Bearer task-token-1" },
            payload: {
                taskId: "task-1",
                outcome: "blocked",
                summary: "Blocked: waiting for user decision on API direction",
                sessionId: "session-1",
            },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().task.status).toBe("failed");
    });

    it("rejects task-scoped token when taskId does not match", async () => {
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "running",
            goalId: "goal-1",
        });
        authMock.verifyTaskResultToken.mockImplementationOnce(async () => ({
            userId: "user-1",
            taskId: "other-task",
            scope: "task-result",
            jti: "jti-1",
        } as any));
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks/result",
            headers: { authorization: "Bearer task-token-1" },
            payload: {
                taskId: "task-1",
                outcome: "blocked",
                summary: "Blocked: waiting for user decision on API direction",
            },
        });

        expect(res.statusCode).toBe(403);
    });

    it("rejects replayed task token jti", async () => {
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "running",
            goalId: "goal-1",
        });
        authMock.verifyTaskResultToken.mockImplementationOnce(async () => ({
            userId: "user-1",
            taskId: "task-1",
            scope: "task-result",
            jti: "jti-replayed",
        } as any));
        dbMock.repeatKey.findUnique.mockResolvedValueOnce({ key: "task-result-jti:jti-replayed", value: "used", expiresAt: new Date(Date.now() + 60_000) });
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks/result",
            headers: { authorization: "Bearer task-token-1" },
            payload: {
                taskId: "task-1",
                outcome: "blocked",
                summary: "Blocked: waiting for user decision on API direction",
            },
        });

        expect(res.statusCode).toBe(409);
    });
});
