import { describe, expect, it } from "vitest";
import { resolveSharedGroupHeaderVariantMeta } from "./sharedGroupHeaderPresentation";

describe("resolveSharedGroupHeaderVariantMeta", () => {
    it("keeps section headers compact and label-like", () => {
        expect(resolveSharedGroupHeaderVariantMeta("section")).toEqual({
            supportsSubtitle: false,
            titleStyle: "section",
        });
    });

    it("allows context headers to carry subtitle information", () => {
        expect(resolveSharedGroupHeaderVariantMeta("context")).toEqual({
            supportsSubtitle: true,
            titleStyle: "context",
        });
    });
});
