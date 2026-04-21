export type CollectionViewStateKind = "loading" | "error" | "empty" | "ready";

export interface CollectionViewState {
    readonly kind: CollectionViewStateKind;
    readonly error: string | null;
    readonly hasData: boolean;
}

interface DeriveCollectionViewStateParams {
    readonly loading: boolean;
    readonly error?: string | null;
    readonly count: number;
}

function normalizeCollectionError(error?: string | null): string | null {
    const normalized = error?.trim();
    return normalized ? normalized : null;
}

export function deriveCollectionViewState({
    loading,
    error,
    count,
}: DeriveCollectionViewStateParams): CollectionViewState {
    const normalizedError = normalizeCollectionError(error);

    if (loading && count === 0) {
        return {
            kind: "loading",
            error: null,
            hasData: false,
        };
    }

    if (!loading && normalizedError && count === 0) {
        return {
            kind: "error",
            error: normalizedError,
            hasData: false,
        };
    }

    if (!loading && count === 0) {
        return {
            kind: "empty",
            error: null,
            hasData: false,
        };
    }

    return {
        kind: "ready",
        error: normalizedError,
        hasData: true,
    };
}
