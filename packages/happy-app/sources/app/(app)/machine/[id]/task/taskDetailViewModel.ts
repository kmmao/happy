import type { ServerTask } from "@/sync/apiTasks";

export const TASK_FILTERS = ["all", "active", "completed", "failed"] as const;

export function getTaskFilterLabel(filter: string, t: (key: string) => string): string {
    if (filter === "all") return t("tasks.filterAll");
    if (filter === "active") return t("tasks.filterActive");
    if (filter === "completed") return t("tasks.statusCompleted");
    if (filter === "failed") return t("tasks.statusFailed");
    return filter;
}

export function getTaskStatusBadgeColor(status: string): string {
    if (status === "running" || status === "dispatching") return "#007AFF";
    if (status === "completed") return "#34C759";
    if (status === "failed") return "#FF3B30";
    if (status === "cancelled") return "#8E8E93";
    return "#AEAEB2";
}

export function getTaskStatusLabel(status: string, t: (key: string) => string): string {
    const map: Record<string, string> = {
        queued: t("tasks.statusQueued"),
        dispatching: t("tasks.statusDispatching"),
        running: t("tasks.statusRunning"),
        completed: t("tasks.statusCompleted"),
        failed: t("tasks.statusFailed"),
        cancelled: t("tasks.statusCancelled"),
    };
    return map[status] ?? status;
}

export function getTaskPriorityLabel(priority: string, t: (key: string) => string): string {
    const map: Record<string, string> = {
        urgent: t("tasks.priorityUrgent"),
        user: t("tasks.priorityUser"),
        background: t("tasks.priorityBackground"),
    };
    return map[priority] ?? priority;
}

export function formatTaskDate(value: number | null): string {
    return value == null ? "-" : new Date(value).toLocaleString();
}

export function isTaskActive(status: string): boolean {
    return ["queued", "dispatching", "running"].includes(status);
}

export function isTaskTerminal(status: string): boolean {
    return ["completed", "failed", "cancelled"].includes(status);
}

export function matchesTaskFilter(task: ServerTask, filter: string | undefined): boolean {
    if (!filter) return true;
    if (filter === "active") return isTaskActive(task.status);
    return task.status === filter;
}

export function sortTasksByUpdatedAt(tasks: ServerTask[]): ServerTask[] {
    return [...tasks].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function buildTaskDetailActions(task: ServerTask): {
    canCancel: boolean;
    canRetry: boolean;
    canDelete: boolean;
    canEdit: boolean;
    canRestore: boolean;
    sessionHref: string | null;
} {
    const isActive = isTaskActive(task.status);
    const isFailed = task.status === "failed";
    const isTerminal = isTaskTerminal(task.status);

    return {
        canCancel: isActive,
        canRetry: isFailed,
        canDelete: isTerminal,
        canEdit: task.status === "queued",
        canRestore: task.status === "cancelled",
        sessionHref: task.sessionId ? `/session/${task.sessionId}` : null,
    };
}
