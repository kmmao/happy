import { describe, expect, it } from "vitest";

import { getDiffPreviewMaxHeight } from "./toolDiffPreview";

describe("getDiffPreviewMaxHeight", () => {
    it("returns undefined when preview limit is disabled", () => {
        expect(getDiffPreviewMaxHeight(undefined)).toBeUndefined();
    });

    it("caps the preview to five visible diff lines by default", () => {
        expect(getDiffPreviewMaxHeight(5)).toBe(100);
    });

    it("scales with the requested visible line count", () => {
        expect(getDiffPreviewMaxHeight(3)).toBe(60);
        expect(getDiffPreviewMaxHeight(8)).toBe(160);
    });
});
