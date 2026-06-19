/**
 * Process-tree termination mechanics for the daemon's tracked sessions.
 *
 * Extracted from the `startDaemon` closure so the OS-level kill behaviour — the
 * part that is easy to get subtly wrong — is one testable seam instead of inline
 * closure helpers. Two behaviours live here:
 *
 *   - `killProcessTree` targets the process GROUP first (`kill(-pid)`, which a
 *     daemon-spawned session is the leader of via `detached`) so children die
 *     with it, then falls back to the single pid when there is no group.
 *   - `scheduleKillEscalation` probes liveness with signal 0 after a grace
 *     period and escalates to SIGKILL only if the process is still alive.
 *
 * Dependencies (`kill`, `schedule`, `logger`) are injected so a test can drive
 * the group→single fallback and the liveness-gated escalation without spawning
 * real processes. Production wires `process.kill` + `setTimeout`.
 */

export interface ProcessTreeKillDeps {
    /** `process.kill` — signal 0 is a liveness probe (throws if dead). */
    kill: (pid: number, signal: NodeJS.Signals | 0) => void;
    /** `setTimeout` — fires the escalation after the grace period. */
    schedule: (fn: () => void, ms: number) => void;
    logger: { debug: (msg: string, ...args: unknown[]) => void };
}

export interface ProcessTreeKiller {
    /** Kill the process group (falling back to the single pid). */
    killProcessTree: (pid: number, signal?: NodeJS.Signals) => void;
    /** SIGKILL the pid after `gracePeriodMs` if it is still alive. */
    scheduleKillEscalation: (pid: number, gracePeriodMs?: number) => void;
}

export function createProcessTreeKiller(deps: ProcessTreeKillDeps): ProcessTreeKiller {
    const { kill, schedule, logger } = deps;

    const killProcessTree = (pid: number, signal: NodeJS.Signals = "SIGTERM"): void => {
        try {
            // Negative pid → the whole process group (daemon sessions are group
            // leaders), so children are taken down with the parent.
            kill(-pid, signal);
        } catch {
            try {
                kill(pid, signal);
            } catch (e) {
                logger.debug(`[DAEMON RUN] Failed to kill PID ${pid} with ${signal}:`, e);
            }
        }
    };

    const scheduleKillEscalation = (pid: number, gracePeriodMs = 5000): void => {
        schedule(() => {
            try {
                kill(pid, 0); // liveness probe — throws once the process is gone
                logger.debug(
                    `[DAEMON RUN] PID ${pid} still alive after grace period, sending SIGKILL`,
                );
                killProcessTree(pid, "SIGKILL");
            } catch {
                // process already exited, nothing to do
            }
        }, gracePeriodMs);
    };

    return { killProcessTree, scheduleKillEscalation };
}
