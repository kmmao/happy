import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { Modal } from "@/modal";
import { t } from "@/text";
import {
    cancelGoal,
    createGoal,
    decomposeGoal,
    deleteGoal,
    replanGoal,
    type GoalSummary,
} from "@/sync/apiProjects";
import {
    prependById,
    removeById,
    replaceById,
    resetGoalToPlanning,
} from "@/components/project/worldCrudState";

export interface CreateWorldGoalInput {
    readonly title: string;
    readonly description?: string;
    readonly priority: "urgent" | "normal" | "low";
    readonly autoDecompose: boolean;
}

interface UseWorldGoalsCrudParams {
    readonly projectServerId: string | null | undefined;
    readonly machineId: string;
    readonly setGoals: React.Dispatch<React.SetStateAction<GoalSummary[]>>;
}

interface UseWorldGoalsCrudResult {
    readonly createGoal: (input: CreateWorldGoalInput) => Promise<boolean>;
    readonly cancelGoal: (goal: GoalSummary) => Promise<boolean>;
    readonly deleteGoal: (goal: GoalSummary) => Promise<boolean>;
    readonly decomposeGoal: (goal: GoalSummary) => Promise<boolean>;
    readonly replanGoal: (goal: GoalSummary) => Promise<boolean>;
}

export function useWorldGoalsCrud({
    projectServerId,
    machineId,
    setGoals,
}: UseWorldGoalsCrudParams): UseWorldGoalsCrudResult {
    const createGoalAction = React.useCallback(
        async (input: CreateWorldGoalInput): Promise<boolean> => {
            if (!input.title.trim() || !projectServerId) return false;

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return false;

                const goal = await createGoal(credentials, projectServerId, {
                    title: input.title.trim(),
                    description: input.description?.trim() || undefined,
                    priority: input.priority,
                    machineId,
                    autoDecompose: input.autoDecompose,
                });

                setGoals((previousGoals) => prependById(previousGoals, goal));
                Modal.toast(t("goals.created"));
                return true;
            } catch {
                Modal.toast(t("goals.createError"));
                return false;
            }
        },
        [machineId, projectServerId, setGoals],
    );

    const cancelGoalAction = React.useCallback(
        async (goal: GoalSummary): Promise<boolean> => {
            if (!projectServerId) return false;

            const confirmed = await Modal.confirm(
                t("goals.cancelGoal"),
                t("goals.cancelGoalConfirm"),
            );
            if (!confirmed) return false;

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return false;

                const updatedGoal = await cancelGoal(credentials, projectServerId, goal.id);
                setGoals((previousGoals) => replaceById(previousGoals, updatedGoal));
                Modal.toast(t("goals.cancelled"));
                return true;
            } catch {
                Modal.toast(t("goals.createError"));
                return false;
            }
        },
        [projectServerId, setGoals],
    );

    const deleteGoalAction = React.useCallback(
        async (goal: GoalSummary): Promise<boolean> => {
            if (!projectServerId) return false;

            const confirmed = await Modal.confirm(
                t("goals.deleteGoal"),
                t("goals.deleteGoalConfirm"),
            );
            if (!confirmed) return false;

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return false;

                await deleteGoal(credentials, projectServerId, goal.id);
                setGoals((previousGoals) => removeById(previousGoals, goal.id));
                Modal.toast(t("goals.deleted"));
                return true;
            } catch {
                Modal.toast(t("goals.createError"));
                return false;
            }
        },
        [projectServerId, setGoals],
    );

    const decomposeGoalAction = React.useCallback(
        async (goal: GoalSummary): Promise<boolean> => {
            if (!projectServerId) return false;

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return false;

                const updatedGoal = await decomposeGoal(credentials, projectServerId, goal.id);
                setGoals((previousGoals) => replaceById(previousGoals, updatedGoal));
                Modal.toast(t("goals.decomposeTriggered"));
                return true;
            } catch {
                Modal.toast(t("goals.decomposeError"));
                return false;
            }
        },
        [projectServerId, setGoals],
    );

    const replanGoalAction = React.useCallback(
        async (goal: GoalSummary): Promise<boolean> => {
            if (!projectServerId) return false;

            const confirmed = await Modal.confirm(
                t("goals.replan"),
                t("goals.replanConfirm"),
            );
            if (!confirmed) return false;

            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return false;

                await replanGoal(credentials, projectServerId, goal.id);
                setGoals((previousGoals) => resetGoalToPlanning(previousGoals, goal.id));
                Modal.toast(t("goals.replanTriggered"));
                return true;
            } catch {
                Modal.toast(t("goals.replanError"));
                return false;
            }
        },
        [projectServerId, setGoals],
    );

    return {
        createGoal: createGoalAction,
        cancelGoal: cancelGoalAction,
        deleteGoal: deleteGoalAction,
        decomposeGoal: decomposeGoalAction,
        replanGoal: replanGoalAction,
    };
}
