export type SharedEmptyStateVariant = "hero" | "standard";

export interface SharedEmptyStateVariantMeta {
    maxWidth: number;
    titleStyle: "hero" | "standard";
    alignItems: "center";
}

export function resolveSharedEmptyStateVariantMeta(
    variant: SharedEmptyStateVariant,
): SharedEmptyStateVariantMeta {
    if (variant === "hero") {
        return {
            maxWidth: 420,
            titleStyle: "hero",
            alignItems: "center",
        };
    }

    return {
        maxWidth: 360,
        titleStyle: "standard",
        alignItems: "center",
    };
}
