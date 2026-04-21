import * as React from "react";
import type { GoalSummary } from "@/sync/apiProjects";
import { fetchGoals } from "@/sync/apiProjects";
import { sync } from "@/sync/sync";
import { useProjectScopedAsyncData } from "./useProjectScopedAsyncData";

interface UseWorldGoalsDataResult {
    readonly goals: GoalSummary[];
    readonly setGoals: React.Dispatch<React.SetStateAction<GoalSummary[]>>;
    readonly loading: boolean;
    readonly error: string | null;
    readonly refresh: () => Promise<void>;
}

const createEmptyGoals = () => [] as GoalSummary[];

export function useWorldGoalsData(
    projectServerId: string | null | undefined,
    isActive: boolean,
): UseWorldGoalsDataResult {
    const loadGoals = React.useCallback(
        (credentials: Parameters<typeof fetchGoals>[0], activeProjectId: string) =>
            fetchGoals(credentials, activeProjectId),
        [],
    );

    const {
        data: goals,
        setData: setGoals,
        loading,
        error,
        refresh,
    } = useProjectScopedAsyncData({
        projectServerId,
        isActive,
        createEmptyData: createEmptyGoals,
        load: loadGoals,
    });

    React.useEffect(() => {
        if (!isActive || !projectServerId) return;

        return sync.onGoalProgress((event) => {
            if (event.projectId !== projectServerId) return;

            let shouldRefresh = false;
            setGoals((previousGoals) =>
                previousGoals.map((goal) => {
                    if (goal.id !== event.goalId) return goal;

                    shouldRefresh = [
                        goal.status === "planning" && event.status === "in_progress",
                        goal.status === "planning" && event.status === "blocked",
                        goal.status === "in_progress" && event.status === "completed",
                    ].some(Boolean);

                    return {
                        ...goal,
                        status: event.status,
                        progress: event.progress,
                    };
                }),
            );

            if (shouldRefresh) {
                void refresh();
            }
        });
    }, [isActive, projectServerId, refresh, setGoals]);

    return {
        goals,
        setGoals,
        loading,
        error,
        refresh,
    };
}
