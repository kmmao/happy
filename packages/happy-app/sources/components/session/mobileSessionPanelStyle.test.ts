import { describe, expect, it } from "vitest";
import {
    getMobilePanelLayoutConfig,
    getMobilePanelTabChipMinWidth,
} from "./mobileSessionPanelStyle";

describe("mobileSessionPanelStyle", () => {
    it("returns fullscreen page-like layout values with compact title row", () => {
        expect(getMobilePanelLayoutConfig()).toEqual({
            sheetHeightPercent: 1,
            tabBarMinHeight: 52,
            tabGap: 8,
            tabBorderRadius: 14,
            headerHandleWidth: 0,
            topBarHeight: 40,
            backButtonSize: 32,
            titleLeftGap: 8,
        });
    });

    it("keeps tab chips readable without stretching into vertical blocks", () => {
        expect(getMobilePanelTabChipMinWidth()).toBe(72);
    });
});
