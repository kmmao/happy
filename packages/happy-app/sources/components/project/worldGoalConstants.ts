/**
 * Shared constants and label helpers for the Goal UI components.
 */

import { t } from "@/text";
import type { GoalSummary } from "@/sync/apiProjects";

export const STATUS_COLORS: Record<string, string> = {
    planning: "#8B5CF6",
    in_progress: "#3B82F6",
    blocked: "#F59E0B",
    completed: "#10B981",
    cancelled: "#6B7280",
};

export const STATUS_ICONS: Record<string, string> = {
    planning: "hourglass-outline",
    in_progress: "play-circle",
    blocked: "warning-outline",
    completed: "checkmark-circle",
    cancelled: "close-circle",
};

export const PRIORITY_COLORS: Record<string, string> = {
    urgent: "#DC2626",
    normal: "#3B82F6",
    low: "#6B7280",
};

export const TASK_STATUS_COLORS: Record<string, string> = {
    dispatching: "#F59E0B",
    queued: "#8B5CF6",
    running: "#3B82F6",
    completed: "#10B981",
    failed: "#EF4444",
    cancelled: "#6B7280",
};

export const TASK_STATUS_ICONS: Record<string, string> = {
    dispatching: "push-outline",
    queued: "time-outline",
    running: "play-circle",
    completed: "checkmark-circle",
    failed: "alert-circle",
    cancelled: "close-circle",
};

export const PLANNER_TIMEOUT_MS = 10 * 60 * 1000;
export type GoalFilterKey = "all" | "blocked" | "active" | "done";

export function statusLabel(goal: GoalSummary): string {
    if (goal.status === "planning") {
        return goal.plannerTaskId ? t("goals.statusPlanningRunning") : t("goals.statusPlanningPending");
    }
    const map: Record<string, () => string> = {
        in_progress: () => t("goals.statusInProgress"),
        blocked: () => t("goals.statusBlocked"),
        completed: () => t("goals.statusCompleted"),
        cancelled: () => t("goals.statusCancelled"),
    };
    return map[goal.status]?.() ?? goal.status;
}

export function priorityLabel(priority: string): string {
    const map: Record<string, () => string> = {
        urgent: () => t("goals.priorityUrgent"),
        normal: () => t("goals.priorityNormal"),
        low: () => t("goals.priorityLow"),
    };
    return map[priority]?.() ?? priority;
}

export function filterLabel(filter: GoalFilterKey): string {
    const labels: Record<GoalFilterKey, string> = {
        all: t("goals.title"),
        blocked: t("goals.statusBlocked"),
        active: t("goals.statusInProgress"),
        done: t("goals.statusCompleted"),
    };
    return labels[filter];
}

export function isSafeId(value: string | undefined): value is string {
    return Boolean(value && /^[A-Za-z0-9_-]+$/.test(value));
}

export function isPlannerTimeoutBlocked(goal: GoalSummary): boolean {
    return goal.status === "blocked" && Boolean(goal.plannerTaskId) && goal.taskCount === 0;
}
