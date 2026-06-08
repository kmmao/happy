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
    directory: string | null;
    priority: "urgent" | "user" | "background";
    status: "queued" | "dispatching" | "running" | "completed" | "failed" | "cancelled";
    attempt: number;
    maxAttempts: number;
    sessionId: string | null;
    errorMessage: string | null;
    dispatchedAt: Date | null;
    completedAt: Date | null;
    triggerType: string;
    triggerRef: string | null;
    createdAt: Date;
    updatedAt: Date;
};

const { state, dbMock, resetState, seedTask, authMock } = vi.hoisted(() => {
    const state = {
        tasks: [] as TaskRecord[],
        repeatKeys: new Map<string, { key: string; value: string; expiresAt: Date; createdAt: Date }>(),
    };

    const resetState = () => {
        state.tasks = [];
        state.repeatKeys = new Map();
    };

    const seedTask = (input: Partial<TaskRecord> & Pick<TaskRecord, "id" | "accountId" | "machineId">) => {
        const now = new Date();
        state.tasks.push({
            id: input.id,
            accountId: input.accountId,
            projectId: input.projectId ?? "project-1",
            machineId: input.machineId,
            prompt: input.prompt ?? "encrypted-prompt",
            directory: input.directory ?? "/repo",
            priority: input.priority ?? "user",
            status: input.status ?? "running",
            attempt: input.attempt ?? 0,
            maxAttempts: input.maxAttempts ?? 3,
            sessionId: input.sessionId ?? null,
            errorMessage: input.errorMessage ?? null,
            dispatchedAt: input.dispatchedAt ?? null,
            completedAt: input.completedAt ?? null,
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
        sessionEvent: {
            create: vi.fn(async ({ data }: any) => ({ id: "session-event-1", createdAt: new Date(), ...data })),
        },
        agentMessage: {
            updateMany: vi.fn(async () => ({ count: 0 })),
        },
        repeatKey: {
            findUnique: vi.fn(async ({ where }: any) => {
                const record = state.repeatKeys.get(where.key) ?? null;
                if (!record) return null;
                if (where.expiresAt?.gte && record.expiresAt < where.expiresAt.gte) return null;
                if (where.expiresAt?.lte && record.expiresAt > where.expiresAt.lte) return null;
                return record;
            }),
            upsert: vi.fn(async ({ where, create, update }: any) => {
                const existing = state.repeatKeys.get(where.key);
                const next = {
                    key: where.key,
                    value: existing ? update.value : create.value,
                    expiresAt: existing ? update.expiresAt : create.expiresAt,
                    createdAt: existing?.createdAt ?? new Date(),
                };
                state.repeatKeys.set(where.key, next);
                return next;
            }),
            create: vi.fn(async ({ data }: any) => {
                if (state.repeatKeys.has(data.key)) {
                    const error = new Error("Unique constraint failed");
                    (error as any).code = "P2002";
                    throw error;
                }
                const record = { ...data, createdAt: new Date() };
                state.repeatKeys.set(data.key, record);
                return record;
            }),
            delete: vi.fn(async ({ where }: any) => {
                if (!state.repeatKeys.has(where.key)) {
                    const error = new Error("Record to delete does not exist");
                    (error as any).code = "P2025";
                    throw error;
                }
                state.repeatKeys.delete(where.key);
            }),
        },
        $transaction: vi.fn(async (fn: any) => fn(dbMock as any)),
    };

    const authMock = {
        verifyTaskResultToken: vi.fn(async () => null),
        createTaskResultToken: vi.fn(async ({ taskId }: { taskId: string }) => `task-token-for-${taskId}`),
    };

    return { state, dbMock, resetState, seedTask, authMock };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/utils/log", () => ({ log: vi.fn() }));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { _emitEphemeralInternal: vi.fn() },
    buildTaskTriggerEphemeral: vi.fn((payload: unknown) => payload),
    buildTaskStatusChangedEphemeral: vi.fn((payload: unknown) => payload),
}));
vi.mock("@/app/auth/auth", () => ({
    auth: authMock,
}));
vi.mock("@/storage/inTx", () => ({
    inTx: vi.fn(async (fn: any) => fn(dbMock as any)),
}));
vi.mock("@/storage/repeatKey", () => ({
    fetchRepeatKey: vi.fn(async (dbArg: any, key: string) => dbArg.repeatKey.findUnique({ where: { key } })),
    saveRepeatKey: vi.fn(async (dbArg: any, key: string, value: string, expiresAt: number) => dbArg.repeatKey.upsert({ where: { key }, update: { value, expiresAt: new Date(expiresAt) }, create: { key, value, expiresAt: new Date(expiresAt) } })),
    claimRepeatKey: vi.fn(async (dbArg: any, key: string, value: string, expiresAt: number) => {
        const existing = await dbArg.repeatKey.findUnique({ where: { key } });
        if (existing && existing.expiresAt >= new Date()) {
            return false;
        }
        if (existing) {
            try {
                await dbArg.repeatKey.delete({ where: { key } });
            } catch (error) {
                if ((error as { code?: string }).code === "P2025") {
                    return false;
                }
                throw error;
            }
        }
        try {
            await dbArg.repeatKey.create({ data: { key, value, expiresAt: new Date(expiresAt) } });
            return true;
        } catch (error) {
            if ((error as { code?: string }).code === "P2002") {
                return false;
            }
            throw error;
        }
    }),
}));
vi.mock("@/modules/taskStatusLogic", () => ({
    normalizeTaskStatusReport: vi.fn(({ status, outcome, errorMessage }: any) => {
        if (outcome === "blocked") {
            return { status: "failed", errorMessage: errorMessage ?? "Blocked" };
        }
        if (outcome === "failed") {
            return { status: "failed", errorMessage };
        }
        if (outcome === "completed") {
            return { status: "completed", errorMessage };
        }
        return { status, errorMessage };
    }),
    shouldApplyTaskStatus: vi.fn((current: string, next: string) => {
        if (["completed", "failed", "cancelled"].includes(current) && current === next) return true;
        if (["completed", "failed", "cancelled"].includes(current)) return false;
        return true;
    }),
    decideTaskTransition: vi.fn(({ current, resolvedStatus, now }: any) => {
        const terminal = ["completed", "failed", "cancelled"];
        if (current.status === resolvedStatus && terminal.includes(current.status)) {
            return { apply: false, reason: "duplicate-terminal" };
        }
        if (terminal.includes(current.status) && current.status !== resolvedStatus) {
            return { apply: false, reason: "stale" };
        }
        const isTerminal = terminal.includes(resolvedStatus);
        const timestamps: { dispatchedAt?: Date; completedAt?: Date } = {};
        if (resolvedStatus === "running" && !current.dispatchedAt) timestamps.dispatchedAt = now;
        if (isTerminal) timestamps.completedAt = now;
        return { apply: true, isTerminal, timestamps };
    }),
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

    it("persists validated directory override on task record", async () => {
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks",
            headers: { "x-user-id": "user-1" },
            payload: {
                machineId: "machine-1",
                projectId: "project-1",
                prompt: "do work",
                directory: "/repo/.dev/worktree/task-123",
            },
        });

        expect(res.statusCode).toBe(201);
        expect(dbMock.task.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ directory: "/repo/.dev/worktree/task-123" }),
        }));
        expect(res.json().task.directory).toBe("/repo/.dev/worktree/task-123");
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
        const { buildTaskStatusChangedEphemeral } = await import("@/app/events/eventRouter");
        const payload = (buildTaskStatusChangedEphemeral as any).mock.calls[0][0];
        expect(payload.machineId).toBe("machine-1");
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
        const { buildTaskStatusChangedEphemeral } = await import("@/app/events/eventRouter");
        const payload = (buildTaskStatusChangedEphemeral as any).mock.calls[0][0];
        expect(payload.machineId).toBe("machine-1");
    });

    it("rejects task-scoped token when taskId does not match", async () => {
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "running",
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
        });
        authMock.verifyTaskResultToken.mockImplementationOnce(async () => ({
            userId: "user-1",
            taskId: "task-1",
            scope: "task-result",
            jti: "jti-replayed",
        } as any));
        dbMock.repeatKey.create.mockImplementationOnce(async () => {
            const error = new Error("Unique constraint failed");
            (error as any).code = "P2002";
            throw error;
        });
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

    it("returns 409 and does not persist task completion when repeat key claim loses the race", async () => {
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "running",
            sessionId: "session-1",
        });
        authMock.verifyTaskResultToken.mockImplementationOnce(async () => ({
            userId: "user-1",
            taskId: "task-1",
            scope: "task-result",
            jti: "jti-race",
        } as any));
        dbMock.repeatKey.create.mockImplementationOnce(async () => {
            const error = new Error("Unique constraint failed");
            (error as any).code = "P2002";
            throw error;
        });
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks/result",
            headers: { authorization: "Bearer task-token-1" },
            payload: {
                taskId: "task-1",
                outcome: "completed",
                summary: "Completed OAuth callback hardening and verified the auth regression tests pass.",
            },
        });

        expect(res.statusCode).toBe(409);
        expect(dbMock.task.update).not.toHaveBeenCalled();
        expect(dbMock.sessionEvent.create).not.toHaveBeenCalled();
    });

    it("returns 409 when the same task result token is replayed after a successful completion", async () => {
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "running",
            sessionId: "session-1",
        });
        authMock.verifyTaskResultToken.mockImplementation(async () => ({
            userId: "user-1",
            taskId: "task-1",
            scope: "task-result",
            jti: "jti-repeat-after-success",
        } as any));
        app = await createApp();

        const first = await app.inject({
            method: "POST",
            url: "/v1/tasks/result",
            headers: { authorization: "Bearer task-token-1" },
            payload: {
                taskId: "task-1",
                outcome: "completed",
                summary: "Completed OAuth callback hardening and verified the auth regression tests pass.",
            },
        });
        const second = await app.inject({
            method: "POST",
            url: "/v1/tasks/result",
            headers: { authorization: "Bearer task-token-1" },
            payload: {
                taskId: "task-1",
                outcome: "completed",
                summary: "Completed OAuth callback hardening and verified the auth regression tests pass.",
            },
        });

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(409);
        expect(dbMock.task.update).toHaveBeenCalledTimes(1);
        expect(dbMock.sessionEvent.create).toHaveBeenCalledTimes(1);
    });

    it("does not copy success summary into errorMessage for completed outcome", async () => {
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "running",
            errorMessage: null,
        });
        authMock.verifyTaskResultToken.mockImplementationOnce(async () => ({
            userId: "user-1",
            taskId: "task-1",
            scope: "task-result",
            jti: "jti-success",
        } as any));
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks/result",
            headers: { authorization: "Bearer task-token-1" },
            payload: {
                taskId: "task-1",
                outcome: "completed",
                summary: "Finished cleanly",
                sessionId: "session-1",
            },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().task.status).toBe("completed");
        expect(res.json().task.errorMessage).toBeNull();
        expect(state.tasks[0]?.errorMessage).toBeNull();
    });

    it("persists a session_end timeline event for completed task results with summary and sessionId", async () => {
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "running",
            errorMessage: null,
        });
        authMock.verifyTaskResultToken.mockImplementationOnce(async () => ({
            userId: "user-1",
            taskId: "task-1",
            scope: "task-result",
            jti: "jti-success-summary",
        } as any));
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks/result",
            headers: { authorization: "Bearer task-token-1" },
            payload: {
                taskId: "task-1",
                outcome: "completed",
                summary: "Completed OAuth callback hardening and verified the auth regression tests pass.",
                sessionId: "session-1",
            },
        });

        expect(res.statusCode).toBe(200);
        expect(dbMock.sessionEvent.create).toHaveBeenCalledWith({
            data: {
                sessionId: "session-1",
                eventType: "session_end",
                summary: "Completed OAuth callback hardening and verified the auth regression tests pass.",
            },
        });
    });

    it("persists session_end timeline event using task sessionId when result omits sessionId", async () => {
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "running",
            sessionId: "session-existing",
        });
        authMock.verifyTaskResultToken.mockImplementationOnce(async () => ({
            userId: "user-1",
            taskId: "task-1",
            scope: "task-result",
            jti: "jti-success-existing-session",
        } as any));
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks/result",
            headers: { authorization: "Bearer task-token-1" },
            payload: {
                taskId: "task-1",
                outcome: "completed",
                summary: "Completed OAuth callback hardening and verified the auth regression tests pass.",
            },
        });

        expect(res.statusCode).toBe(200);
        expect(dbMock.sessionEvent.create).toHaveBeenCalledWith({
            data: {
                sessionId: "session-existing",
                eventType: "session_end",
                summary: "Completed OAuth callback hardening and verified the auth regression tests pass.",
            },
        });
    });

    it("does not persist session_end timeline event for non-completed task results", async () => {
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "running",
        });
        authMock.verifyTaskResultToken.mockImplementationOnce(async () => ({
            userId: "user-1",
            taskId: "task-1",
            scope: "task-result",
            jti: "jti-blocked",
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
        expect(dbMock.sessionEvent.create).not.toHaveBeenCalled();
    });
});


describe("taskRoutes POST /v1/tasks/:id/retry", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it("reuses persisted task directory instead of resetting to project root", async () => {
        seedTask({
            id: "task-1",
            accountId: "user-1",
            machineId: "machine-1",
            status: "failed",
            projectId: "project-1",
            directory: "/repo/.dev/worktree/task-1",
        });
        app = await createApp();

        const res = await app.inject({
            method: "POST",
            url: "/v1/tasks/task-1/retry",
            headers: { "x-user-id": "user-1" },
        });

        expect(res.statusCode).toBe(200);
        const { buildTaskTriggerEphemeral } = await import("@/app/events/eventRouter");
        const payload = (buildTaskTriggerEphemeral as any).mock.calls[0][0];
        expect(payload.directory).toBe("/repo/.dev/worktree/task-1");
    });
});
