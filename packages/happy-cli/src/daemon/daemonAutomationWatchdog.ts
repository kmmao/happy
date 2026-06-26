/**
 * Automation watchdog — decides which long-running automation sessions the
 * daemon must abort, and (in the runner) carries out the abort.
 *
 * Extracted from `startDaemon.ts`, where the policy lived inline as a closure
 * over the scheduler, the tracked-session map, the guardian registry and the
 * terminator — untestable without standing up the whole daemon. Its siblings
 * (`onSessionHeartbeatAction`, `recoverTrackedSessionsFromIndexAction`, …) were
 * already extracted this way; this is the last fat watchdog closure to follow.
 *
 * The subtle part — the real bug habitat — is the *decision*: runtime vs
 * inactivity thresholds, the recovered-from-index inactivity exemption, the
 * supervisor-`fix` exemption, and which jobs are even eligible. That is split
 * into the pure {@link decideAutomationWatchdogTerminations} so it can be tested
 * directly against a jobs snapshot + clock. The runner is thin wiring: read the
 * env thresholds, call the decision, then run the effects (forget guardian +
 * terminate) per result.
 */

import type { TrackedSession } from "./types";
import type { AutomationJob } from "@/automation/types";
import { logger } from "@/ui/logger";

const DEFAULT_MAX_RUNTIME_MS = 45 * 60_000;
const DEFAULT_MAX_INACTIVITY_MS = 10 * 60_000;

export interface WatchdogThresholds {
    maxRuntimeMs: number;
    maxInactivityMs: number;
}

export interface WatchdogTermination {
    session: TrackedSession;
    job: AutomationJob;
    isSupervisor: boolean;
    failureReason: string;
}

/**
 * Pure policy: given the current jobs snapshot, a way to resolve a job's
 * tracked session, the thresholds and the clock, return the sessions that must
 * be terminated and why. No effects — deterministic in `now`.
 */
export function decideAutomationWatchdogTerminations(input: {
    jobs: AutomationJob[];
    resolveSession: (sessionId: string) => TrackedSession | undefined;
    thresholds: WatchdogThresholds;
    now: number;
    formatDurationMs: (ms: number) => string;
}): WatchdogTermination[] {
    const { jobs, resolveSession, thresholds, now, formatDurationMs } = input;
    const { maxRuntimeMs, maxInactivityMs } = thresholds;
    const terminations: WatchdogTermination[] = [];

    for (const job of jobs) {
        const isSupervisor = job.kind === "supervisor";
        const isTask = job.kind === "task";
        if (
            (!isSupervisor && !isTask) ||
            job.status !== "running" ||
            (isSupervisor && job.payload.trigger === "fix") ||
            !job.sessionId
        ) {
            continue;
        }

        const trackedSession = resolveSession(job.sessionId);
        if (!trackedSession) {
            continue;
        }

        const runtimeSince =
            trackedSession.recoveredAt ?? trackedSession.startedAt ?? job.dispatchedAt ?? job.createdAt;
        const activitySince =
            trackedSession.lastActivityAt ??
            trackedSession.lastOutputAt ??
            trackedSession.recoveredAt ??
            trackedSession.startedAt ??
            job.dispatchedAt ??
            job.createdAt;
        const runtimeMs = now - runtimeSince;
        const inactivityMs = now - activitySince;
        const inactivityExceeded =
            !trackedSession.recoveredFromIndex && inactivityMs > maxInactivityMs;
        if (runtimeMs <= maxRuntimeMs && !inactivityExceeded) {
            continue;
        }

        const failureReason =
            runtimeMs > maxRuntimeMs
                ? `Automation watchdog aborted session after ${formatDurationMs(runtimeMs)} of runtime`
                : `Automation watchdog aborted session after ${formatDurationMs(inactivityMs)} of inactivity`;
        terminations.push({ session: trackedSession, job, isSupervisor, failureReason });
    }

    return terminations;
}

/** Read the watchdog thresholds from env, applying defaults. */
export function resolveWatchdogThresholds(
    env: NodeJS.ProcessEnv = process.env,
): WatchdogThresholds {
    return {
        maxRuntimeMs: parseInt(
            env.HAPPY_AUTOMATION_WATCHDOG_MAX_RUNTIME_MS ?? `${DEFAULT_MAX_RUNTIME_MS}`,
        ),
        maxInactivityMs: parseInt(
            env.HAPPY_AUTOMATION_WATCHDOG_MAX_INACTIVITY_MS ?? `${DEFAULT_MAX_INACTIVITY_MS}`,
        ),
    };
}

/**
 * Effectful runner. Reads thresholds, computes the terminations via the pure
 * policy above, then forgets guardian state (supervisor jobs) and requests
 * termination for each. A null scheduler or non-positive thresholds disable the
 * watchdog (early return), matching the original inline behavior.
 */
export async function runAutomationWatchdog(deps: {
    scheduler: { getJobsSnapshot(): AutomationJob[] } | null | undefined;
    resolveSession: (sessionId: string) => TrackedSession | undefined;
    formatDurationMs: (ms: number) => string;
    forgetGuardianSession: (sessionId: string) => Promise<void>;
    requestTermination: (
        pid: number,
        session: TrackedSession,
        options: { reason: string; terminalStatus?: "completed" | "failed" | "cancelled"; terminalError?: string },
    ) => boolean;
    now?: () => number;
    env?: NodeJS.ProcessEnv;
}): Promise<void> {
    const { scheduler, resolveSession, formatDurationMs, forgetGuardianSession, requestTermination } = deps;
    if (!scheduler) {
        return;
    }

    const thresholds = resolveWatchdogThresholds(deps.env);
    if (thresholds.maxRuntimeMs <= 0 || thresholds.maxInactivityMs <= 0) {
        return;
    }

    const terminations = decideAutomationWatchdogTerminations({
        jobs: scheduler.getJobsSnapshot(),
        resolveSession,
        thresholds,
        now: deps.now ? deps.now() : Date.now(),
        formatDurationMs,
    });

    for (const { session, job, isSupervisor, failureReason } of terminations) {
        logger.warn(
            `[DAEMON RUN] Automation watchdog stopping ${job.kind} session ${job.sessionId} for job ${job.id}: ${failureReason}`,
        );
        if (isSupervisor && job.sessionId) {
            await forgetGuardianSession(job.sessionId).catch((error) => {
                logger.debug(`[DAEMON RUN] Failed to forget guardian session ${job.sessionId}: ${error}`);
            });
        }
        requestTermination(session.pid, session, {
            reason: `watchdog:${job.id}`,
            terminalStatus: "failed",
            terminalError: failureReason,
        });
    }
}
