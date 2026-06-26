import { describe, expect, it, vi } from "vitest";
import {
    decideAutomationWatchdogTerminations,
    resolveWatchdogThresholds,
    runAutomationWatchdog,
    type WatchdogThresholds,
} from "./daemonAutomationWatchdog";
import type { TrackedSession } from "./types";
import type { AutomationJob } from "@/automation/types";

const THRESHOLDS: WatchdogThresholds = {
    maxRuntimeMs: 45 * 60_000,
    maxInactivityMs: 10 * 60_000,
};
const NOW = 1_000_000_000;
const fmt = (ms: number) => `${ms}ms`;

function job(over: Partial<AutomationJob> & { kind: AutomationJob["kind"] }): AutomationJob {
    return {
        id: "job-1",
        status: "running",
        sessionId: "sess-1",
        createdAt: NOW,
        dispatchedAt: NOW,
        payload: {},
        ...over,
    } as unknown as AutomationJob;
}

function session(over: Partial<TrackedSession> = {}): TrackedSession {
    return { startedBy: "daemon", pid: 4242, ...over } as TrackedSession;
}

function decide(jobs: AutomationJob[], sessions: Record<string, TrackedSession>) {
    return decideAutomationWatchdogTerminations({
        jobs,
        resolveSession: (id) => sessions[id],
        thresholds: THRESHOLDS,
        now: NOW,
        formatDurationMs: fmt,
    });
}

describe("decideAutomationWatchdogTerminations", () => {
    it("terminates a task session past the runtime cap", () => {
        const result = decide(
            [job({ kind: "task" })],
            { "sess-1": session({ startedAt: NOW - THRESHOLDS.maxRuntimeMs - 1, lastActivityAt: NOW }) },
        );
        expect(result).toHaveLength(1);
        expect(result[0].failureReason).toContain("of runtime");
    });

    it("terminates a session past the inactivity cap (runtime still fine)", () => {
        const result = decide(
            [job({ kind: "task" })],
            { "sess-1": session({ startedAt: NOW - 1000, lastActivityAt: NOW - THRESHOLDS.maxInactivityMs - 1 }) },
        );
        expect(result).toHaveLength(1);
        expect(result[0].failureReason).toContain("of inactivity");
    });

    it("leaves a session within both caps alone", () => {
        const result = decide(
            [job({ kind: "task" })],
            { "sess-1": session({ startedAt: NOW - 1000, lastActivityAt: NOW - 1000 }) },
        );
        expect(result).toHaveLength(0);
    });

    it("exempts a recovered-from-index session from the inactivity cap but not runtime", () => {
        const inactive = session({
            startedAt: NOW - 1000,
            lastActivityAt: NOW - THRESHOLDS.maxInactivityMs - 1,
            recoveredFromIndex: true,
            recoveredAt: NOW - 1000,
        });
        expect(decide([job({ kind: "task" })], { "sess-1": inactive })).toHaveLength(0);

        const oldRuntime = session({
            recoveredFromIndex: true,
            recoveredAt: NOW - THRESHOLDS.maxRuntimeMs - 1,
            lastActivityAt: NOW,
        });
        expect(decide([job({ kind: "task" })], { "sess-1": oldRuntime })).toHaveLength(1);
    });

    it("skips supervisor 'fix' jobs", () => {
        const over = NOW - THRESHOLDS.maxRuntimeMs - 1;
        expect(
            decide(
                [job({ kind: "supervisor", payload: { trigger: "fix" } as any })],
                { "sess-1": session({ startedAt: over }) },
            ),
        ).toHaveLength(0);
    });

    it("ignores non-supervisor/non-task kinds and non-running jobs", () => {
        const over = NOW - THRESHOLDS.maxRuntimeMs - 1;
        const sessions = { "sess-1": session({ startedAt: over }) };
        expect(decide([job({ kind: "agent_loop" })], sessions)).toHaveLength(0);
        expect(decide([job({ kind: "webhook" })], sessions)).toHaveLength(0);
        expect(decide([job({ kind: "task", status: "completed" })], sessions)).toHaveLength(0);
    });

    it("skips jobs whose session can't be resolved", () => {
        expect(decide([job({ kind: "task", sessionId: "missing" })], {})).toHaveLength(0);
    });
});

describe("resolveWatchdogThresholds", () => {
    it("defaults to 45m runtime / 10m inactivity", () => {
        expect(resolveWatchdogThresholds({})).toEqual({ maxRuntimeMs: 45 * 60_000, maxInactivityMs: 10 * 60_000 });
    });
    it("reads env overrides", () => {
        expect(
            resolveWatchdogThresholds({
                HAPPY_AUTOMATION_WATCHDOG_MAX_RUNTIME_MS: "1000",
                HAPPY_AUTOMATION_WATCHDOG_MAX_INACTIVITY_MS: "500",
            }),
        ).toEqual({ maxRuntimeMs: 1000, maxInactivityMs: 500 });
    });
});

describe("runAutomationWatchdog", () => {
    const baseDeps = () => ({
        resolveSession: (id: string) =>
            id === "sess-1" ? session({ startedAt: NOW - 60 * 60_000, lastActivityAt: NOW }) : undefined,
        formatDurationMs: fmt,
        forgetGuardianSession: vi.fn(async () => {}),
        requestTermination: vi.fn(() => true),
        now: () => NOW,
    });

    it("is a no-op when no scheduler is present", async () => {
        const deps = { ...baseDeps(), scheduler: null };
        await runAutomationWatchdog(deps);
        expect(deps.requestTermination).not.toHaveBeenCalled();
    });

    it("is a no-op when thresholds are non-positive", async () => {
        const deps = {
            ...baseDeps(),
            scheduler: { getJobsSnapshot: () => [job({ kind: "task" })] },
            env: { HAPPY_AUTOMATION_WATCHDOG_MAX_RUNTIME_MS: "0" } as NodeJS.ProcessEnv,
        };
        await runAutomationWatchdog(deps);
        expect(deps.requestTermination).not.toHaveBeenCalled();
    });

    it("terminates and forgets guardian state for an over-runtime supervisor job", async () => {
        const deps = {
            ...baseDeps(),
            scheduler: { getJobsSnapshot: () => [job({ kind: "supervisor", payload: { trigger: "scheduled" } as any })] },
        };
        await runAutomationWatchdog(deps);
        expect(deps.forgetGuardianSession).toHaveBeenCalledWith("sess-1");
        expect(deps.requestTermination).toHaveBeenCalledTimes(1);
        expect(deps.requestTermination).toHaveBeenCalledWith(
            4242,
            expect.any(Object),
            expect.objectContaining({ reason: "watchdog:job-1", terminalStatus: "failed" }),
        );
    });
});
