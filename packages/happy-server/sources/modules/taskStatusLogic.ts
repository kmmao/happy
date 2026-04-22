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
