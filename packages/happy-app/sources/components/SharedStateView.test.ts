import { describe, expect, it } from "vitest";
import { resolveSharedStateKindMeta } from "./sharedStatePresentation";

describe("resolveSharedStateKindMeta", () => {
    it("uses a neutral loading treatment so spinners do the talking", () => {
        expect(resolveSharedStateKindMeta("loading")).toEqual({
            accent: "neutral",
            iconName: null,
        });
    });

    it("uses a destructive accent for error states", () => {
        expect(resolveSharedStateKindMeta("error")).toEqual({
            accent: "error",
            iconName: "alert-circle-outline",
        });
    });

    it("keeps empty states neutral and lightweight", () => {
        expect(resolveSharedStateKindMeta("empty")).toEqual({
            accent: "neutral",
            iconName: "sparkles-outline",
        });
    });
});
