import { describe, expect, it } from "vitest";
import {
    getLoopFormLayoutMode,
    getLoopModalMetrics,
    getQuickActionColumnCount,
} from "./loopsLayout";

describe("loopsLayout", () => {
    it("uses a single-column quick action layout on narrow screens", () => {
        expect(getQuickActionColumnCount({ viewportWidth: 430, isWeb: false })).toBe(1);
        expect(getQuickActionColumnCount({ viewportWidth: 430, isWeb: true })).toBe(1);
    });

    it("uses a two-column quick action layout on wide web screens", () => {
        expect(getQuickActionColumnCount({ viewportWidth: 1024, isWeb: true })).toBe(2);
    });

    it("expands modal width and height for mobile screens", () => {
        expect(
            getLoopModalMetrics({
                viewportWidth: 430,
                viewportHeight: 932,
                isWeb: false,
            }),
        ).toEqual({
            width: 406,
            maxHeight: 900,
            minWidth: undefined,
            borderRadius: 16,
            horizontalPadding: 16,
        });
    });

    it("keeps desktop modal constraints on wide web screens", () => {
        expect(
            getLoopModalMetrics({
                viewportWidth: 1280,
                viewportHeight: 900,
                isWeb: true,
            }),
        ).toEqual({
            width: 860,
            maxHeight: 828,
            minWidth: 720,
            borderRadius: 24,
            horizontalPadding: 20,
        });
    });

    it("uses stacked form layout on narrow screens", () => {
        expect(getLoopFormLayoutMode({ viewportWidth: 430, isWeb: false })).toEqual({
            modalHeaderStacked: true,
            fullWidthButtons: true,
            compactSpacing: true,
        });
    });

    it("uses roomier desktop form layout on web", () => {
        expect(getLoopFormLayoutMode({ viewportWidth: 1280, isWeb: true })).toEqual({
            modalHeaderStacked: false,
            fullWidthButtons: false,
            compactSpacing: false,
        });
    });
});
