export type SharedStateKind = "loading" | "error" | "empty";

export interface SharedStateKindMeta {
    accent: "neutral" | "error";
    iconName: "alert-circle-outline" | "sparkles-outline" | null;
}

export function resolveSharedStateKindMeta(
    kind: SharedStateKind,
): SharedStateKindMeta {
    if (kind === "loading") {
        return {
            accent: "neutral",
            iconName: null,
        };
    }

    if (kind === "error") {
        return {
            accent: "error",
            iconName: "alert-circle-outline",
        };
    }

    return {
        accent: "neutral",
        iconName: "sparkles-outline",
    };
}
