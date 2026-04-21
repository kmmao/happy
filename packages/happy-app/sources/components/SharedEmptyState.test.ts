import { describe, expect, it } from "vitest";
import { resolveSharedEmptyStateVariantMeta } from "./sharedEmptyStatePresentation";

describe("resolveSharedEmptyStateVariantMeta", () => {
    it("gives hero empty states more presence for onboarding surfaces", () => {
        expect(resolveSharedEmptyStateVariantMeta("hero")).toEqual({
            maxWidth: 420,
            titleStyle: "hero",
            alignItems: "center",
        });
    });

    it("keeps standard empty states tighter for list and tab surfaces", () => {
        expect(resolveSharedEmptyStateVariantMeta("standard")).toEqual({
            maxWidth: 360,
            titleStyle: "standard",
            alignItems: "center",
        });
    });
});
