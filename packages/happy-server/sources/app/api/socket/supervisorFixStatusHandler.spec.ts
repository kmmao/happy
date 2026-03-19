import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any module import that touches them
// ---------------------------------------------------------------------------

const {
    dbMock,
    emitEphemeralMock,
    invalidateSessionMock,
    pushMock,
    resetState,
    seedAction,
    seedSession,
    state,
} = vi.hoisted(() => {
    const state = {
        actions: [] as any[],
        sessions: [] as any[],
    };

    const resetState = () => {
        state.actions = [];
        state.sessions = [];
    };

    const seedAction = (input: {
        id: string;
        projectId: string;
        accountId: string;
        runId: string;
        title: string;
        approval: string;
        fixStatus?: string;
        fixSessionId?: string | null;
    }) => {
        state.actions.push({
            id: input.id,
            projectId: input.projectId,
            accountId: input.accountId,
            runId: input.runId,
            title: input.title,
            approval: input.approval,
            fixStatus: input.fixStatus ?? "pending",
            fixSessionId: input.fixSessionId ?? null,
        });
    };

    const seedSession = (input: { id: string; active: boolean }) => {
        state.sessions.push({ id: input.id, active: input.active });
    };

    const dbMock = {
        supervisorAction: {
            findFirst: vi.fn(async ({ where, select }: any) => {
                return state.actions.find(
                    (a: any) =>
                        a.id === where.id &&
                        a.projectId === where.projectId &&
                        a.accountId === where.accountId &&
                        a.approval === where.approval,
                ) ?? null;
            }),
            update: vi.fn(async ({ where, data }: any) => {
                const action = state.actions.find((a: any) => a.id === where.id);
                if (action) Object.assign(action, data);
                return action;
            }),
        },
        session: {
            updateMany: vi.fn(async ({ where, data }: any) => {
                const session = state.sessions.find(
                    (s: any) => s.id === where.id && s.active === where.active,
                );
                if (session) Object.assign(session, data);
                return { count: session ? 1 : 0 };
            }),
        },
    };

    const emitEphemeralMock = vi.fn();
    const invalidateSessionMock = vi.fn();
    const pushMock = vi.fn().mockResolvedValue(undefined);

    return {
        dbMock,
        emitEphemeralMock,
        invalidateSessionMock,
        pushMock,
        resetState,
        seedAction,
        seedSession,
        state,
    };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/utils/log", () => ({ log: vi.fn() }));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitEphemeral: emitEphemeralMock },
    buildSupervisorStatusEphemeral: vi.fn(
        (runId: string, projectId: string, status: string) => ({
            type: "supervisor-status",
            runId,
            projectId,
            status,
        }),
    ),
    buildSessionActivityEphemeral: vi.fn(
        (sessionId: string, active: boolean, activeAt: number, thinking: boolean) => ({
            type: "session-activity",
            sessionId,
            active,
            activeAt,
            thinking,
        }),
    ),
}));
vi.mock("@/app/presence/sessionCache", () => ({
    activityCache: { invalidateSession: invalidateSessionMock },
}));
vi.mock("@/modules/pushSend", () => ({
    pushSupervisorNotification: pushMock,
}));

import { supervisorFixStatusHandler } from "./supervisorFixStatusHandler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSocket() {
    const handlers = new Map<string, (...args: any[]) => void>();
    return {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
            handlers.set(event, handler);
        }),
        /** Simulate the CLI emitting an event */
        emit(event: string, data: unknown) {
            const handler = handlers.get(event);
            if (!handler) throw new Error(`No handler for event: ${event}`);
            return handler(data);
        },
    };
}

const USER_ID = "user-1";
const PROJECT_ID = "proj-1";
const ACTION_ID = "action-1";
const RUN_ID = "run-1";
const FIX_SESSION_ID = "fix-session-1";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("supervisorFixStatusHandler", () => {
    let socket: ReturnType<typeof createMockSocket>;

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
        socket = createMockSocket();
        supervisorFixStatusHandler(socket as any, USER_ID);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should archive fix session when fixStatus is completed", async () => {
        seedAction({
            id: ACTION_ID,
            projectId: PROJECT_ID,
            accountId: USER_ID,
            runId: RUN_ID,
            title: "Fix something",
            approval: "approved",
            fixSessionId: FIX_SESSION_ID,
        });
        seedSession({ id: FIX_SESSION_ID, active: true });

        await socket.emit("supervisor-fix-status", {
            actionId: ACTION_ID,
            projectId: PROJECT_ID,
            fixStatus: "completed",
            fixSessionId: FIX_SESSION_ID,
        });

        // Session should be archived (active: false)
        expect(dbMock.session.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    id: FIX_SESSION_ID,
                    active: true,
                }),
                data: expect.objectContaining({
                    active: false,
                }),
            }),
        );

        // Activity cache should be invalidated
        expect(invalidateSessionMock).toHaveBeenCalledWith(FIX_SESSION_ID);

        // Session activity ephemeral should be emitted
        expect(emitEphemeralMock).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: USER_ID,
                payload: expect.objectContaining({
                    type: "session-activity",
                    sessionId: FIX_SESSION_ID,
                    active: false,
                }),
            }),
        );
    });

    it("should archive fix session when fixStatus is failed", async () => {
        seedAction({
            id: ACTION_ID,
            projectId: PROJECT_ID,
            accountId: USER_ID,
            runId: RUN_ID,
            title: "Fix something",
            approval: "approved",
            fixSessionId: FIX_SESSION_ID,
        });
        seedSession({ id: FIX_SESSION_ID, active: true });

        await socket.emit("supervisor-fix-status", {
            actionId: ACTION_ID,
            projectId: PROJECT_ID,
            fixStatus: "failed",
            fixSessionId: FIX_SESSION_ID,
        });

        expect(dbMock.session.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    id: FIX_SESSION_ID,
                    active: true,
                }),
                data: expect.objectContaining({
                    active: false,
                }),
            }),
        );
        expect(invalidateSessionMock).toHaveBeenCalledWith(FIX_SESSION_ID);
    });

    it("should resolve fixSessionId from DB when not in event payload", async () => {
        seedAction({
            id: ACTION_ID,
            projectId: PROJECT_ID,
            accountId: USER_ID,
            runId: RUN_ID,
            title: "Fix something",
            approval: "approved",
            fixSessionId: FIX_SESSION_ID,
        });
        seedSession({ id: FIX_SESSION_ID, active: true });

        // No fixSessionId in the event payload
        await socket.emit("supervisor-fix-status", {
            actionId: ACTION_ID,
            projectId: PROJECT_ID,
            fixStatus: "completed",
        });

        // Should still archive using the fixSessionId from DB
        expect(dbMock.session.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    id: FIX_SESSION_ID,
                    active: true,
                }),
            }),
        );
    });

    it("should NOT archive session when fixStatus is running", async () => {
        seedAction({
            id: ACTION_ID,
            projectId: PROJECT_ID,
            accountId: USER_ID,
            runId: RUN_ID,
            title: "Fix something",
            approval: "approved",
        });

        await socket.emit("supervisor-fix-status", {
            actionId: ACTION_ID,
            projectId: PROJECT_ID,
            fixStatus: "running",
            fixSessionId: FIX_SESSION_ID,
        });

        expect(dbMock.session.updateMany).not.toHaveBeenCalled();
        expect(invalidateSessionMock).not.toHaveBeenCalled();
    });

    it("should still send push notification on completion", async () => {
        seedAction({
            id: ACTION_ID,
            projectId: PROJECT_ID,
            accountId: USER_ID,
            runId: RUN_ID,
            title: "Fix the bug",
            approval: "approved",
            fixSessionId: FIX_SESSION_ID,
        });
        seedSession({ id: FIX_SESSION_ID, active: true });

        await socket.emit("supervisor-fix-status", {
            actionId: ACTION_ID,
            projectId: PROJECT_ID,
            fixStatus: "completed",
        });

        expect(pushMock).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
            type: "fix_complete",
            title: "Fix Applied Successfully",
        }));
    });

    it("should not crash when action has no fixSessionId", async () => {
        seedAction({
            id: ACTION_ID,
            projectId: PROJECT_ID,
            accountId: USER_ID,
            runId: RUN_ID,
            title: "Fix something",
            approval: "approved",
            fixSessionId: null,
        });

        await socket.emit("supervisor-fix-status", {
            actionId: ACTION_ID,
            projectId: PROJECT_ID,
            fixStatus: "completed",
        });

        // Should not attempt to archive any session
        expect(dbMock.session.updateMany).not.toHaveBeenCalled();
        expect(invalidateSessionMock).not.toHaveBeenCalled();

        // Push should still be sent
        expect(pushMock).toHaveBeenCalled();
    });
});
