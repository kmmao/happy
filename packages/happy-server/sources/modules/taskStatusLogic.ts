export type TaskStatus = "queued" | "dispatching" | "running" | "completed" | "failed" | "cancelled";
export type TaskOutcome = "completed" | "failed" | "blocked";

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(["completed", "failed", "cancelled"]);
const TASK_STATUS_PROGRESS: Record<Exclude<TaskStatus, "completed" | "failed" | "cancelled">, number> = {
    queued: 0,
    dispatching: 1,
    running: 2,
};

export function normalizeTaskStatusReport(input: {
    status: TaskStatus;
    outcome?: TaskOutcome;
}): { status: TaskStatus; outcome?: TaskOutcome } {
    if (input.outcome === "blocked") {
        return {
            status: "failed",
            outcome: "blocked",
        };
    }

    if (input.outcome) {
        return {
            status: input.outcome,
            outcome: input.outcome,
        };
    }

    return {
        status: input.status,
        outcome: undefined,
    };
}

export function shouldApplyTaskStatus(current: string, incoming: string): boolean {
    if (current === incoming) return true;
    if (TERMINAL_TASK_STATUSES.has(current as TaskStatus)) {
        return false;
    }
    if (TERMINAL_TASK_STATUSES.has(incoming as TaskStatus)) {
        return true;
    }

    const currentOrder = TASK_STATUS_PROGRESS[current as keyof typeof TASK_STATUS_PROGRESS];
    const incomingOrder = TASK_STATUS_PROGRESS[incoming as keyof typeof TASK_STATUS_PROGRESS];
    if (currentOrder == null || incomingOrder == null) {
        return true;
    }
    return incomingOrder >= currentOrder;
}

export type TaskTransitionDecision =
    | { apply: false; reason: "duplicate-terminal" | "stale" }
    | { apply: true; isTerminal: boolean; timestamps: { dispatchedAt?: Date; completedAt?: Date } };

/**
 * Decide a single Task status transition.
 *
 * The Task state machine (queued → dispatching → running → terminal) and the
 * timestamp side-effects of crossing its edges (when dispatchedAt / completedAt
 * are stamped) are one invariant. Both the socket handler and the result/status
 * routes apply the same transition, so this is the single place that owns it —
 * callers must not re-derive "is this stale / terminal / which timestamps move"
 * inline. Each caller keeps its own *outward* side-effects (inbox, sessionEvent,
 * ephemeral, response shape) and just consumes the decision.
 *
 * Returns `apply: false` (with the reason a stale transition was rejected vs. a
 * redundant terminal report) or `apply: true` with `isTerminal` and the subset
 * of timestamp fields that should change — callers spread `timestamps` into the
 * update so untouched fields keep their stored value.
 */
export function decideTaskTransition(input: {
    current: { status: string; dispatchedAt: Date | null };
    resolvedStatus: TaskStatus;
    now: Date;
}): TaskTransitionDecision {
    const { current, resolvedStatus, now } = input;

    if (current.status === resolvedStatus && TERMINAL_TASK_STATUSES.has(current.status as TaskStatus)) {
        return { apply: false, reason: "duplicate-terminal" };
    }
    if (!shouldApplyTaskStatus(current.status, resolvedStatus)) {
        return { apply: false, reason: "stale" };
    }

    const isTerminal = TERMINAL_TASK_STATUSES.has(resolvedStatus);
    const timestamps: { dispatchedAt?: Date; completedAt?: Date } = {};
    if (resolvedStatus === "running" && !current.dispatchedAt) {
        timestamps.dispatchedAt = now;
    }
    if (isTerminal) {
        timestamps.completedAt = now;
    }
    return { apply: true, isTerminal, timestamps };
}
