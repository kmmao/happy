export type SharedGroupHeaderVariant = "section" | "context";

export interface SharedGroupHeaderVariantMeta {
    supportsSubtitle: boolean;
    titleStyle: "section" | "context";
}

export function resolveSharedGroupHeaderVariantMeta(
    variant: SharedGroupHeaderVariant,
): SharedGroupHeaderVariantMeta {
    if (variant === "context") {
        return {
            supportsSubtitle: true,
            titleStyle: "context",
        };
    }

    return {
        supportsSubtitle: false,
        titleStyle: "section",
    };
}
