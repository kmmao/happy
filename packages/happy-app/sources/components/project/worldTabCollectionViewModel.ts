import {
    deriveCollectionViewState,
    type CollectionViewState,
} from "@/utils/collectionViewState";

export interface WorldTabCollectionScreenState {
    readonly screenKind: "loading" | "error" | "empty" | "ready";
    readonly requestState: CollectionViewState;
}

interface DeriveWorldTabCollectionScreenStateInput {
    readonly loading: boolean;
    readonly error?: string | null;
    readonly totalCount: number;
    readonly visibleCount?: number;
}

export function deriveWorldTabCollectionScreenState({
    loading,
    error,
    totalCount,
    visibleCount = totalCount,
}: DeriveWorldTabCollectionScreenStateInput): WorldTabCollectionScreenState {
    const requestState = deriveCollectionViewState({
        loading,
        error,
        count: totalCount,
    });

    if (requestState.kind === "loading" || requestState.kind === "error") {
        return {
            screenKind: requestState.kind,
            requestState,
        };
    }

    if (visibleCount === 0) {
        return {
            screenKind: "empty",
            requestState,
        };
    }

    return {
        screenKind: "ready",
        requestState,
    };
}
