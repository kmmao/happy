import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory `db.task` whose findFirst/update operate over `state.tasks`,
// plus a spy for the App notification, so taskStatusApply is exercised through
// its interface (input → result + emitted ephemeral) without Prisma or sockets.
const { dbMock, emitEphemeralMock, resetState, seedTask } =
    vi.hoisted(() => {
        const state = { tasks: [] as any[] };
        const resetState = () => {
            state.tasks = [];
        };
        const seedTask = (task: Partial<Record<string, unknown>> & { id: string; accountId: string }) => {
            state.tasks.push({
                status: "queued",
                dispatchedAt: null,
                completedAt: null,
                sessionId: null,
                errorMessage: null,
                machineId: "machine-1",
                triggerType: "manual",
                title: null,
                ...task,
            });
        };

        const dbMock = {
            task: {
                findFirst: vi.fn(async ({ where }: any) =>
                    state.tasks.find(
                        (t) => t.id === where.id && t.accountId === where.accountId,
                    ) ?? null,
                ),
                update: vi.fn(async ({ where, data }: any) => {
                    const task = state.tasks.find((t) => t.id === where.id);
                    Object.assign(task, data);
                    return { ...task };
                }),
            },
        };

        const emitEphemeralMock = vi.fn();

        return { dbMock, emitEphemeralMock, resetState, seedTask, state };
    });

vi.mock("@/storage/db", () => ({ db: dbMock }));
// PR 1.5.f: build*Ephemeral functions moved into syncEphemeral.ts as private
// helpers. We mock only the transport sink and assert on the wire payload
// that reaches it.
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { _emitEphemeralInternal: emitEphemeralMock },
}));

import { taskStatusApply } from "./taskStatusApply";

describe("taskStatusApply", () => {
    const userId = "user-1";

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it("rejects with not-found when no task matches the user, without writing or emitting", async () => {
        seedTask({ id: "t1", accountId: "someone-else" });

        const result = await taskStatusApply({ userId, taskId: "t1", resolvedStatus: "running" });

        expect(result).toEqual({ ok: false, reason: "not-found" });
        expect(dbMock.task.update).not.toHaveBeenCalled();
        expect(emitEphemeralMock).not.toHaveBeenCalled();
    });

    it("applies a running transition, stamps dispatchedAt, and emits the App notification", async () => {
        seedTask({ id: "t1", accountId: userId, status: "queued", dispatchedAt: null });
        const now = new Date("2026-01-01T00:00:00Z");

        const result = await taskStatusApply({
            userId,
            taskId: "t1",
            resolvedStatus: "running",
            sessionId: "sess-9",
            now,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.isTerminal).toBe(false);
        expect(result.task.status).toBe("running");
        expect(result.task.dispatchedAt).toEqual(now);
        expect(result.task.sessionId).toBe("sess-9");
        expect(emitEphemeralMock).toHaveBeenCalledTimes(1);
        // PR 1.5.f: the wire payload is the assertion target now, not the
        // intermediate builder call. task-status-changed → `type: "task-status-changed"`.
        const payload = emitEphemeralMock.mock.calls[0][0].payload;
        expect(payload).toEqual(expect.objectContaining({
            type: "task-status-changed",
            taskId: "t1",
            status: "running",
            sessionId: "sess-9",
        }));
    });

    it("marks isTerminal and stamps completedAt for a terminal transition", async () => {
        seedTask({ id: "t1", accountId: userId, status: "running", dispatchedAt: new Date(0) });
        const now = new Date("2026-02-02T00:00:00Z");

        const result = await taskStatusApply({ userId, taskId: "t1", resolvedStatus: "completed", now });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.isTerminal).toBe(true);
        expect(result.task.completedAt).toEqual(now);
    });

    it("rejects a backward transition as stale, echoing the unchanged task and not emitting", async () => {
        seedTask({ id: "t1", accountId: userId, status: "running" });

        const result = await taskStatusApply({ userId, taskId: "t1", resolvedStatus: "queued" });

        expect(result).toMatchObject({ ok: false, reason: "stale" });
        if (result.ok || result.reason === "not-found") throw new Error("expected stale rejection");
        expect(result.task.status).toBe("running");
        expect(dbMock.task.update).not.toHaveBeenCalled();
        expect(emitEphemeralMock).not.toHaveBeenCalled();
    });

    it("rejects a re-reported terminal status as duplicate-terminal", async () => {
        seedTask({ id: "t1", accountId: userId, status: "completed" });

        const result = await taskStatusApply({ userId, taskId: "t1", resolvedStatus: "completed" });

        expect(result).toMatchObject({ ok: false, reason: "duplicate-terminal" });
        expect(dbMock.task.update).not.toHaveBeenCalled();
        expect(emitEphemeralMock).not.toHaveBeenCalled();
    });

    it("preserves the stored sessionId/errorMessage when the input omits them", async () => {
        seedTask({
            id: "t1",
            accountId: userId,
            status: "running",
            sessionId: "stored-sess",
            errorMessage: "stored-err",
        });

        const result = await taskStatusApply({ userId, taskId: "t1", resolvedStatus: "completed" });

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.task.sessionId).toBe("stored-sess");
        expect(result.task.errorMessage).toBe("stored-err");
    });
});
