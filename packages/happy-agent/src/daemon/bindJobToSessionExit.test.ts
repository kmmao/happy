import { describe, it, expect, vi } from "vitest";
import { bindJobToSessionExit, type JobTerminalSink } from "./bindJobToSessionExit";
import type { TrackedSession } from "./trackedSessions";

/** A fake tracked session whose childProcess captures the exit listener. */
function fakeTracked() {
    let exitCb: ((code: number | null) => void) | null = null;
    const tracked = {
        pid: 123,
        childProcess: {
            on: (evt: string, cb: (code: number | null) => void) => {
                if (evt === "exit") exitCb = cb;
            },
        },
    } as unknown as TrackedSession;
    return { tracked, fireExit: (code: number | null) => exitCb?.(code) };
}

function sink(): JobTerminalSink & { markCompleted: ReturnType<typeof vi.fn>; markFailed: ReturnType<typeof vi.fn> } {
    return { markCompleted: vi.fn(), markFailed: vi.fn() };
}

describe("bindJobToSessionExit", () => {
    it("marks the job completed and reports completed status on exit 0", async () => {
        const scheduler = sink();
        const onExit = vi.fn();
        const { tracked, fireExit } = fakeTracked();

        await bindJobToSessionExit({ scheduler, jobId: "j1", pid: 123, onExit, getTrackedSession: () => tracked });
        fireExit(0);

        expect(scheduler.markCompleted).toHaveBeenCalledWith("j1");
        expect(scheduler.markFailed).not.toHaveBeenCalled();
        expect(onExit).toHaveBeenCalledWith({ code: 0, status: "completed" });
    });

    it("marks the job failed with the exit code on a non-zero exit", async () => {
        const scheduler = sink();
        const onExit = vi.fn();
        const { tracked, fireExit } = fakeTracked();

        await bindJobToSessionExit({ scheduler, jobId: "j2", pid: 123, onExit, getTrackedSession: () => tracked });
        fireExit(7);

        expect(scheduler.markFailed).toHaveBeenCalledWith("j2", "exit code 7");
        expect(scheduler.markCompleted).not.toHaveBeenCalled();
        expect(onExit).toHaveBeenCalledWith({ code: 7, status: "failed" });
    });

    it("treats a signal-terminated child (null code) as failed", async () => {
        const scheduler = sink();
        const { tracked, fireExit } = fakeTracked();

        await bindJobToSessionExit({ scheduler, jobId: "j3", pid: 123, getTrackedSession: () => tracked });
        fireExit(null);

        expect(scheduler.markFailed).toHaveBeenCalledWith("j3", "exit code null");
    });

    it("does not hang silently when the tracked session is missing", async () => {
        const scheduler = sink();
        // Previously this path attached no listener and the job hung in "running".
        await expect(
            bindJobToSessionExit({ scheduler, jobId: "j4", pid: 999, getTrackedSession: () => undefined }),
        ).resolves.toBeUndefined();
        expect(scheduler.markCompleted).not.toHaveBeenCalled();
        expect(scheduler.markFailed).not.toHaveBeenCalled();
    });

    it("does nothing when the tracked session has no childProcess", async () => {
        const scheduler = sink();
        const tracked = { pid: 5 } as unknown as TrackedSession;
        await bindJobToSessionExit({ scheduler, jobId: "j5", pid: 5, getTrackedSession: () => tracked });
        expect(scheduler.markCompleted).not.toHaveBeenCalled();
        expect(scheduler.markFailed).not.toHaveBeenCalled();
    });
});
