import { describe, expect, it } from "vitest";
import {
    getMobileSessionPanelTabs,
    shouldShowMobileSessionPanelButton,
} from "./mobileSessionPanelState";

describe("mobileSessionPanelState", () => {
    it("shows mobile panel button only when desktop side panel is unavailable and session is online", () => {
        expect(
            shouldShowMobileSessionPanelButton({
                showSidePanelOuter: false,
                sessionIsOnline: true,
            }),
        ).toBe(true);

        expect(
            shouldShowMobileSessionPanelButton({
                showSidePanelOuter: true,
                sessionIsOnline: true,
            }),
        ).toBe(false);

        expect(
            shouldShowMobileSessionPanelButton({
                showSidePanelOuter: false,
                sessionIsOnline: false,
            }),
        ).toBe(false);
    });

    it("returns all mobile panel tabs in expected order", () => {
        expect(getMobileSessionPanelTabs()).toEqual([
            "files",
            "changes",
            "summary",
            "timeline",
            "terminal",
        ]);
    });
});
