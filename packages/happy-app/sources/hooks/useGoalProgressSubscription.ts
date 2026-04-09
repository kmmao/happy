import * as React from "react";
import { sync } from "@/sync/sync";

export interface GoalProgressSubscriptionOptions {
    isActive: boolean;
    projectId?: string | null;
    goalId?: string | null;
    onPatch: (event: {
        goalId: string;
        projectId: string;
        status: string;
        progress: number;
    }) => void;
    onRefresh: () => void;
}

const ALLOWED_GOAL_STATUSES = new Set([
    "planning",
    "in_progress",
    "blocked",
    "completed",
    "cancelled",
]);

export function useGoalProgressSubscription(options: GoalProgressSubscriptionOptions): void {
    const {
        isActive,
        projectId,
        goalId,
        onPatch,
        onRefresh,
    } = options;

    React.useEffect(() => {
        if (!isActive || !projectId || !goalId) {
            return;
        }

        return sync.onGoalProgress((event) => {
            if (event.projectId !== projectId || event.goalId !== goalId) {
                return;
            }
            if (!ALLOWED_GOAL_STATUSES.has(event.status)) {
                return;
            }

            const normalizedEvent = {
                ...event,
                progress: Math.max(0, Math.min(100, event.progress)),
            };

            onPatch(normalizedEvent);
            if (
                normalizedEvent.status === "blocked"
                || normalizedEvent.status === "completed"
            ) {
                void onRefresh();
            }
        });
    }, [goalId, isActive, onPatch, onRefresh, projectId]);
}
