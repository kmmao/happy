import {
    deriveCollectionViewState,
    type CollectionViewStateKind,
} from "@/utils/collectionViewState";

export type SharedCollectionState = CollectionViewStateKind;

interface ResolveSharedCollectionStateParams {
    readonly loading: boolean;
    readonly error?: string | null;
    readonly count: number;
}

export function resolveSharedCollectionState({
    loading,
    error,
    count,
}: ResolveSharedCollectionStateParams): SharedCollectionState {
    return deriveCollectionViewState({
        loading,
        error,
        count,
    }).kind;
}
