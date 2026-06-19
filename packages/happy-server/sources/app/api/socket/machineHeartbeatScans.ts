import { log } from "@/utils/log";
import { checkAndTriggerScheduledRuns } from "@/modules/supervisorScheduler";
import { cleanupStaleFixActions } from "@/modules/supervisorFixWatchdog";
import { checkAndTriggerSchedules } from "@/modules/triggerScheduleRunner";
import { tickDueGenericAgentLoops } from "@/modules/agentLoopEngine";

/**
 * Machine heartbeat scans — the single registry of due-work checks fired when
 * a Daemon reports `machine-alive`. Each scan is independent and best-effort:
 * a failure is logged under its own module label and never blocks the other
 * scans or the heartbeat. Adding a heartbeat-driven scan means appending one
 * entry to HEARTBEAT_SCANS, not another `.catch` in the socket handler.
 *
 * The seam also owns the per-machine throttle, so "what runs on heartbeat, and
 * how often" lives in one testable place rather than being inlined in the
 * websocket handler.
 */

interface HeartbeatScan {
    /** `log` module label for this scan's failures. */
    module: string;
    /** Human-readable failure prefix written to the error log. */
    label: string;
    run: (machineId: string, userId: string) => Promise<void>;
}

const HEARTBEAT_SCANS: HeartbeatScan[] = [
    {
        module: "supervisor",
        label: "Schedule check error",
        run: (machineId, userId) => checkAndTriggerScheduledRuns(machineId, userId),
    },
    {
        module: "supervisor",
        label: "Stale fix cleanup error",
        // cleanupStaleFixActions takes (userId, machineId) — the registry hides
        // that arg-order inconsistency behind the uniform (machineId, userId).
        run: (machineId, userId) => cleanupStaleFixActions(userId, machineId),
    },
    {
        module: "trigger",
        label: "Trigger schedule check error",
        run: (machineId, userId) => checkAndTriggerSchedules(machineId, userId),
    },
    {
        // ADR-0022 Phase 3b — fire due generic AgentLoops on this machine. The
        // (role, enabled, nextRunAt) composite index makes this an index scan
        // over the small set of due loops, not a full table scan.
        module: "agent-loop",
        label: "Agent loop tick error",
        run: (machineId, userId) => tickDueGenericAgentLoops(machineId, userId),
    },
];

// Throttle scans per machine. The composite indexes behind each scan make them
// index scans, so a 30s window keeps loop/schedule triggers timely without
// measurable db load (a loop whose intervalMs equals the throttle used to drift
// up to one full period when the two values matched).
const SCHEDULE_CHECK_INTERVAL = 30 * 1000;
const lastScheduleCheck = new Map<string, number>();

/**
 * Run every due heartbeat scan for a machine if its per-machine throttle window
 * has elapsed. Fire-and-forget: returns immediately while each scan settles on
 * its own. Returns true when scans were dispatched, false when throttled.
 */
export function runDueMachineHeartbeatScans(machineId: string, userId: string): boolean {
    const now = Date.now();
    const last = lastScheduleCheck.get(machineId) ?? 0;
    if (now - last < SCHEDULE_CHECK_INTERVAL) return false;
    lastScheduleCheck.set(machineId, now);

    for (const scan of HEARTBEAT_SCANS) {
        scan.run(machineId, userId).catch((err) =>
            log({ module: scan.module, level: "error" }, `${scan.label}: ${err}`),
        );
    }
    return true;
}

/** Test-only: clear the per-machine throttle so each test starts fresh. */
export function __resetHeartbeatThrottleForTests(): void {
    lastScheduleCheck.clear();
}
