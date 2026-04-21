interface Identifiable {
    readonly id: string;
}

export function prependById<T extends Identifiable>(
    items: readonly T[],
    nextItem: T,
): T[] {
    return [
        nextItem,
        ...items.filter((item) => item.id !== nextItem.id),
    ];
}

export function replaceById<T extends Identifiable>(
    items: readonly T[],
    nextItem: T,
): T[] {
    return items.map((item) => (item.id === nextItem.id ? nextItem : item));
}

export function removeById<T extends Identifiable>(
    items: readonly T[],
    itemId: string,
): T[] {
    return items.filter((item) => item.id !== itemId);
}

export function resetGoalToPlanning<T extends Identifiable & {
    readonly status: string;
    readonly progress: number;
}>(
    goals: readonly T[],
    goalId: string,
): T[] {
    return goals.map((goal) =>
        goal.id === goalId
            ? {
                ...goal,
                status: "planning",
                progress: 0,
            }
            : goal,
    );
}
