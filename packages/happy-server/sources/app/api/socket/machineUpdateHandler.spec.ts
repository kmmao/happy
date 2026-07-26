import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    buildBriefPushBodyMock,
    dbMock,
    emitEphemeralMock,
    invalidateSessionMock,
    pushSendMock,
    resetState,
    seedSession,
    state,
} = vi.hoisted(() => {
    const state = {
        sessions: [] as Array<{
            id: string;
            accountId: string;
            active: boolean;
            lastActiveAt: Date;
        }>,
    };

    const resetState = () => {
        state.sessions = [];
    };

    const seedSession = (input: {
        id: string;
        accountId: string;
        active?: boolean;
        lastActiveAt?: Date;
    }) => {
        state.sessions.push({
            id: input.id,
            accountId: input.accountId,
            active: input.active ?? false,
            lastActiveAt: input.lastActiveAt ?? new Date(0),
        });
    };

    const matchesSessionWhere = (session: (typeof state.sessions)[number], where: any) => {
        const ids = where?.id?.in;
        return (
            Array.isArray(ids) &&
            ids.includes(session.id) &&
            session.accountId === where.accountId
        );
    };

    const dbMock = {
        machine: {
            findFirst: vi.fn(),
            updateMany: vi.fn(),
        },
        session: {
            updateManyAndReturn: vi.fn(async ({ where, data }: any) => {
                const updated: typeof state.sessions = [];
                for (const session of state.sessions) {
                    if (!matchesSessionWhere(session, where)) continue;
                    Object.assign(session, data);
                    updated.push({ ...session });
                }
                return updated;
            }),
            updateMany: vi.fn(async ({ where, data }: any) => {
                let count = 0;
                for (const session of state.sessions) {
                    if (!matchesSessionWhere(session, where)) continue;
                    Object.assign(session, data);
                    count += 1;
                }
                return { count };
            }),
        },
        sessionEvent: { findFirst: vi.fn() },
    };

    const emitEphemeralMock = vi.fn();
    const invalidateSessionMock = vi.fn();
    const pushSendMock = vi.fn();
    const buildBriefPushBodyMock = vi.fn(() => "Goal: Keep the project healthy and surface regressions before users hit them. Current focus: Verify…");

    return {
        buildBriefPushBodyMock,
        dbMock,
        emitEphemeralMock,
        invalidateSessionMock,
        pushSendMock,
        resetState,
        seedSession,
        state,
    };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/utils/log", () => ({ log: vi.fn() }));
vi.mock("@/storage/seq", () => ({ allocateUserSeq: vi.fn(async () => 1) }));
vi.mock("@/utils/randomKeyNaked", () => ({ randomKeyNaked: vi.fn(() => "update-id") }));
vi.mock("@/modules/supervisorScheduler", () => ({ checkAndTriggerScheduledRuns: vi.fn() }));
vi.mock("@/modules/supervisorFixWatchdog", () => ({ cleanupStaleFixActions: vi.fn() }));
vi.mock("@/modules/triggerScheduleRunner", () => ({ checkAndTriggerSchedules: vi.fn() }));
vi.mock("@/modules/pushSend", () => ({
    buildBriefPushBody: buildBriefPushBodyMock,
    pushSend: pushSendMock,
}));
vi.mock("@/storage/inTx", () => ({ inTx: vi.fn() }));
vi.mock("@/app/monitoring/metrics2", () => ({
    machineAliveEventsCounter: { inc: vi.fn() },
    websocketEventsCounter: { inc: vi.fn() },
}));
vi.mock("@/app/presence/sessionCache", () => ({
    activityCache: {
        isMachineValid: vi.fn(async () => true),
        queueMachineUpdate: vi.fn(),
        invalidateSession: invalidateSessionMock,
    },
}));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { _emitEphemeralInternal: emitEphemeralMock, _emitUpdateInternal: vi.fn() },
    buildMachineActivityEphemeral: vi.fn((machineId: string, active: boolean, activeAt: number) => ({
        type: "machine-activity",
        id: machineId,
        active,
        activeAt,
    })),
    buildSessionActivityEphemeral: vi.fn((sessionId: string, active: boolean, activeAt: number, thinking: boolean) => ({
        type: "activity",
        id: sessionId,
        active,
        activeAt,
        thinking,
    })),
    buildUpdateMachineUpdate: vi.fn(() => ({ id: "update-id", body: { t: "update-machine" } })),
}));

import { machineUpdateHandler } from "./machineUpdateHandler";

function createMockSocket() {
    const handlers = new Map<string, (...args: any[]) => any>();
    return {
        on: vi.fn((event: string, handler: (...args: any[]) => any) => {
            handlers.set(event, handler);
        }),
        trigger(event: string, ...args: any[]) {
            const handler = handlers.get(event);
            if (!handler) throw new Error(`No handler registered for ${event}`);
            return handler(...args);
        },
    };
}

describe("machineUpdateHandler session-sync", () => {
    const userId = "user-1";
    let socket: ReturnType<typeof createMockSocket>;

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
        socket = createMockSocket();
        machineUpdateHandler(userId, socket as any);
    });

    it("reactivates daemon-reported live sessions and emits activity updates after server restart", async () => {
        seedSession({ id: "session-live", accountId: userId, active: false });
        seedSession({ id: "session-other-user", accountId: "user-2", active: false });
        const callback = vi.fn();

        await socket.trigger(
            "session-sync",
            { sessionIds: ["session-live", "session-other-user", "session-live"] },
            callback,
        );

        expect(state.sessions.find((session) => session.id === "session-live")?.active).toBe(true);
        expect(state.sessions.find((session) => session.id === "session-other-user")?.active).toBe(false);
        expect(invalidateSessionMock).toHaveBeenCalledWith("session-live");
        expect(emitEphemeralMock).toHaveBeenCalledWith({
            userId,
            payload: expect.objectContaining({
                type: "activity",
                id: "session-live",
                active: true,
            }),
            recipientFilter: { type: "user-scoped-only" },
        });
        expect(callback).toHaveBeenCalledWith({ ok: true, reactivated: 1 });
    });

    it("sends loop brief push body from goal and current focus", async () => {
        dbMock.machine.findFirst.mockResolvedValue({
            id: "machine-1",
            accountId: userId,
            daemonStateVersion: 0,
            daemonState: null,
        });
        dbMock.machine.updateMany.mockResolvedValue({ count: 1 });
        const callback = vi.fn();

        await socket.trigger(
            "machine-update-state",
            {
                machineId: "machine-1",
                expectedVersion: 0,
                daemonState: JSON.stringify({
                    recentBriefs: [{
                        loopId: "loop-1",
                        loopName: "Nightly review",
                        status: "completed",
                        summary: "Nightly review completed — old summary",
                        detail: [
                            "Goal: Keep the project healthy and surface regressions before users hit them.",
                            "Current focus: Verify session ready notifications now include useful structured context.",
                        ].join("\n\n"),
                        generatedAt: 1000,
                        sessionId: "session-1",
                    }],
                }),
            },
            callback,
        );

        await socket.trigger(
            "machine-update-state",
            {
                machineId: "machine-1",
                expectedVersion: 0,
                daemonState: JSON.stringify({
                    recentBriefs: [{
                        loopId: "loop-1",
                        loopName: "Nightly review",
                        status: "completed",
                        summary: "Nightly review completed — old summary",
                        detail: [
                            "Goal: Keep the project healthy and surface regressions before users hit them.",
                            "Current focus: Verify session ready notifications now include useful structured context.",
                        ].join("\n\n"),
                        generatedAt: 2000,
                        sessionId: "session-1",
                    }],
                }),
            },
            callback,
        );

        expect(buildBriefPushBodyMock).toHaveBeenCalledWith(expect.objectContaining({
            loopId: "loop-1",
            detail: expect.stringContaining("Current focus:"),
        }));
        expect(pushSendMock).toHaveBeenCalledTimes(1);
        expect(pushSendMock).toHaveBeenCalledWith(userId, expect.objectContaining({
            title: "Loop Brief: Nightly review",
            body: "Goal: Keep the project healthy and surface regressions before users hit them. Current focus: Verify…",
            data: {
                type: "loop_brief",
                loopId: "loop-1",
                status: "completed",
            },
        }));
    });
});
