import { describe, expect, it } from "vitest";

import { getSessionPanelTabs } from "./sessionPanelTabs";
import { shouldShowMobileSessionPanelButton } from "./mobileSessionPanelState";

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

    it("uses the shared tab definition for mobile ordering", () => {
        expect(getSessionPanelTabs(true)).toEqual([
            "changes",
            "files",
            "code",
            "preview",
            "summary",
            "terminal",
        ]);
    });

    it("uses the shared preview gating for mobile", () => {
        expect(getSessionPanelTabs(false)).toEqual([
            "changes",
            "files",
            "code",
            "summary",
            "terminal",
        ]);
    });
});
