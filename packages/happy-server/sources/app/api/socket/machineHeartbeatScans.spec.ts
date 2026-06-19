import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    checkAndTriggerScheduledRunsMock,
    cleanupStaleFixActionsMock,
    checkAndTriggerSchedulesMock,
    tickDueGenericAgentLoopsMock,
    logMock,
} = vi.hoisted(() => ({
    checkAndTriggerScheduledRunsMock: vi.fn(async () => {}),
    cleanupStaleFixActionsMock: vi.fn(async () => {}),
    checkAndTriggerSchedulesMock: vi.fn(async () => {}),
    tickDueGenericAgentLoopsMock: vi.fn(async () => {}),
    logMock: vi.fn(),
}));

vi.mock("@/utils/log", () => ({ log: logMock }));
vi.mock("@/modules/supervisorScheduler", () => ({
    checkAndTriggerScheduledRuns: checkAndTriggerScheduledRunsMock,
}));
vi.mock("@/modules/supervisorFixWatchdog", () => ({
    cleanupStaleFixActions: cleanupStaleFixActionsMock,
}));
vi.mock("@/modules/triggerScheduleRunner", () => ({
    checkAndTriggerSchedules: checkAndTriggerSchedulesMock,
}));
vi.mock("@/modules/agentLoopEngine", () => ({
    tickDueGenericAgentLoops: tickDueGenericAgentLoopsMock,
}));

import {
    __resetHeartbeatThrottleForTests,
    runDueMachineHeartbeatScans,
} from "./machineHeartbeatScans";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runDueMachineHeartbeatScans", () => {
    const machineId = "machine-1";
    const userId = "user-1";

    beforeEach(() => {
        vi.clearAllMocks();
        __resetHeartbeatThrottleForTests();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("dispatches every registered scan with the uniform (machineId, userId) order", async () => {
        const dispatched = runDueMachineHeartbeatScans(machineId, userId);
        await flush();

        expect(dispatched).toBe(true);
        expect(checkAndTriggerScheduledRunsMock).toHaveBeenCalledWith(machineId, userId);
        // cleanupStaleFixActions has the inverted (userId, machineId) signature —
        // the seam adapts it so the registry stays uniform.
        expect(cleanupStaleFixActionsMock).toHaveBeenCalledWith(userId, machineId);
        expect(checkAndTriggerSchedulesMock).toHaveBeenCalledWith(machineId, userId);
        expect(tickDueGenericAgentLoopsMock).toHaveBeenCalledWith(machineId, userId);
    });

    it("throttles a second immediate call for the same machine", () => {
        expect(runDueMachineHeartbeatScans(machineId, userId)).toBe(true);
        expect(runDueMachineHeartbeatScans(machineId, userId)).toBe(false);
        expect(checkAndTriggerScheduledRunsMock).toHaveBeenCalledTimes(1);

        // A different machine is tracked independently.
        expect(runDueMachineHeartbeatScans("machine-2", userId)).toBe(true);
        expect(checkAndTriggerScheduledRunsMock).toHaveBeenCalledTimes(2);
    });

    it("re-dispatches once the throttle window has elapsed", () => {
        vi.useFakeTimers();
        // Base well past 0 — a brand-new machine defaults to last=0, so a real
        // (large) clock always clears the window on the first call.
        const base = 1_000_000;
        vi.setSystemTime(base);

        expect(runDueMachineHeartbeatScans(machineId, userId)).toBe(true);
        vi.setSystemTime(base + 15 * 1000);
        expect(runDueMachineHeartbeatScans(machineId, userId)).toBe(false);
        vi.setSystemTime(base + 30 * 1000);
        expect(runDueMachineHeartbeatScans(machineId, userId)).toBe(true);
        expect(checkAndTriggerScheduledRunsMock).toHaveBeenCalledTimes(2);
    });

    it("isolates a failing scan — others still run and the failure is logged", async () => {
        checkAndTriggerScheduledRunsMock.mockRejectedValueOnce(new Error("boom"));

        runDueMachineHeartbeatScans(machineId, userId);
        await flush();

        expect(tickDueGenericAgentLoopsMock).toHaveBeenCalledTimes(1);
        expect(checkAndTriggerSchedulesMock).toHaveBeenCalledTimes(1);
        expect(logMock).toHaveBeenCalledWith(
            { module: "supervisor", level: "error" },
            expect.stringContaining("Schedule check error"),
        );
    });
});
