/**
 * bindJobToSessionExit — the single home for "when this spawned session exits,
 * drive the scheduler job to its terminal state."
 *
 * Webhook, supervisor, task, and loop triggers each spawn a session, then wire
 * the same exit→scheduler handoff inline:
 *
 *   const tracked = (await import("./trackedSessions")).getTrackedSession(pid);
 *   if (tracked?.childProcess) {
 *     tracked.childProcess.on("exit", (code) => {
 *       code === 0 ? scheduler.markCompleted(jobId) : scheduler.markFailed(jobId, `exit code ${code}`);
 *       ...emit per-trigger status...
 *     });
 *   }
 *
 * Copied four times, it carried a silent failure: if the tracked session can't
 * be found, NO exit listener is attached, the job never reaches a terminal
 * state, and the scheduler's pump retries a "running" job forever. That bug
 * lived in the duplication, with no single place to fix it.
 *
 * This seam owns the constant core (resolve tracked session, mark
 * completed/failed on exit) and surfaces the per-trigger status notification as
 * an injected `onExit` callback. The missing-tracked-session case is no longer
 * silent — it logs a warning so the stuck job is visible.
 */

import { logger } from "../logger";
import type { TrackedSession } from "./trackedSessions";

/** The slice of AutomationScheduler this seam drives. */
export interface JobTerminalSink {
    markCompleted(jobId: string): void;
    markFailed(jobId: string, error: string): void;
}

export interface JobExitResult {
    /** Process exit code; null when the child was terminated by a signal. */
    code: number | null;
    status: "completed" | "failed";
}

/**
 * Attach the scheduler-terminal handoff to a spawned session's process exit.
 *
 * `getTrackedSession` is injectable for testing; production defaults to the
 * dynamic import the call sites used (kept to avoid the daemon import cycle).
 * `onExit` runs after the scheduler is marked, with the resolved status — use
 * it for the per-trigger notification (emit*Status / onJobTerminal).
 */
export async function bindJobToSessionExit(opts: {
    scheduler: JobTerminalSink;
    jobId: string;
    pid: number;
    onExit?: (result: JobExitResult) => void;
    getTrackedSession?: (pid: number) => TrackedSession | undefined;
}): Promise<void> {
    const { scheduler, jobId, pid, onExit } = opts;
    const getTracked =
        opts.getTrackedSession ?? (await import("./trackedSessions")).getTrackedSession;

    const tracked = getTracked(pid);
    if (!tracked?.childProcess) {
        // Previously a silent no-op: the job would hang in "running" forever.
        logger.warn(
            `[SCHEDULER] job ${jobId}: no tracked child for pid ${pid}; exit will not be observed`,
        );
        return;
    }

    tracked.childProcess.on("exit", (code) => {
        const status: "completed" | "failed" = code === 0 ? "completed" : "failed";
        if (code === 0) {
            scheduler.markCompleted(jobId);
        } else {
            scheduler.markFailed(jobId, `exit code ${code}`);
        }
        onExit?.({ code, status });
    });
}
