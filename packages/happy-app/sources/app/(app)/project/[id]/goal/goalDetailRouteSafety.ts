export type GoalDetailRouteState =
    | { kind: "ready"; projectId: string; goalId: string }
    | { kind: "invalid" };

function isSafeId(value: string | undefined): value is string {
    return Boolean(value && /^[A-Za-z0-9_-]+$/.test(value));
}

export function buildGoalDetailRouteState(input: {
    projectId?: string;
    goalId?: string;
}): GoalDetailRouteState {
    if (!isSafeId(input.projectId) || !isSafeId(input.goalId)) {
        return { kind: "invalid" };
    }

    return {
        kind: "ready",
        projectId: input.projectId,
        goalId: input.goalId,
    };
}
