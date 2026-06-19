import { describe, it, expect, vi } from "vitest";
import { createProcessTreeKiller, type ProcessTreeKillDeps } from "./daemonProcessTree";

function deps(overrides: Partial<ProcessTreeKillDeps> = {}): ProcessTreeKillDeps & {
    calls: Array<[number, NodeJS.Signals | 0]>;
} {
    const calls: Array<[number, NodeJS.Signals | 0]> = [];
    return {
        calls,
        kill: overrides.kill ?? ((pid, signal) => calls.push([pid, signal])),
        schedule: overrides.schedule ?? ((fn) => fn()), // run synchronously by default
        logger: overrides.logger ?? { debug: vi.fn() },
    };
}

describe("killProcessTree", () => {
    it("targets the process group first (negative pid)", () => {
        const d = deps();
        createProcessTreeKiller(d).killProcessTree(1234, "SIGTERM");
        expect(d.calls).toEqual([[-1234, "SIGTERM"]]);
    });

    it("falls back to the single pid when the group kill throws", () => {
        const d = deps({
            kill: vi.fn((pid: number, _signal: NodeJS.Signals | 0) => {
                if (pid < 0) throw new Error("ESRCH: no such group");
            }),
        });
        const killer = createProcessTreeKiller(d);
        killer.killProcessTree(1234, "SIGTERM");
        expect(d.kill).toHaveBeenNthCalledWith(1, -1234, "SIGTERM");
        expect(d.kill).toHaveBeenNthCalledWith(2, 1234, "SIGTERM");
    });

    it("logs (does not throw) when both group and single kills fail", () => {
        const debug = vi.fn();
        const d = deps({
            kill: () => {
                throw new Error("boom");
            },
            logger: { debug },
        });
        expect(() => createProcessTreeKiller(d).killProcessTree(99)).not.toThrow();
        expect(debug).toHaveBeenCalledOnce();
    });

    it("defaults to SIGTERM", () => {
        const d = deps();
        createProcessTreeKiller(d).killProcessTree(7);
        expect(d.calls).toEqual([[-7, "SIGTERM"]]);
    });
});

describe("scheduleKillEscalation", () => {
    it("SIGKILLs the group when the process is still alive after the grace period", () => {
        const calls: Array<[number, NodeJS.Signals | 0]> = [];
        const d = deps({
            // liveness probe (signal 0) succeeds → process still alive.
            kill: (pid, signal) => {
                calls.push([pid, signal]);
            },
        });
        createProcessTreeKiller(d).scheduleKillEscalation(555, 5000);
        // probe (555, 0) then group SIGKILL (-555).
        expect(calls).toContainEqual([555, 0]);
        expect(calls).toContainEqual([-555, "SIGKILL"]);
    });

    it("does nothing when the liveness probe shows the process already exited", () => {
        const sigkills: Array<[number, NodeJS.Signals | 0]> = [];
        const d = deps({
            kill: (pid, signal) => {
                if (signal === 0) throw new Error("ESRCH"); // already dead
                sigkills.push([pid, signal]);
            },
        });
        createProcessTreeKiller(d).scheduleKillEscalation(555);
        expect(sigkills).toHaveLength(0);
    });

    it("uses the provided grace period for the schedule delay", () => {
        const schedule = vi.fn();
        const d = deps({ schedule });
        createProcessTreeKiller(d).scheduleKillEscalation(1, 12345);
        expect(schedule).toHaveBeenCalledWith(expect.any(Function), 12345);
    });
});
