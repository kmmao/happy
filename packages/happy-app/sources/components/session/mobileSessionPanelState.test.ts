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
        expect(
            getSessionPanelTabs({
                enablePreviewTab: true,
                knowledgeBaseEnabled: true,
            }),
        ).toEqual([
            "session",
            "knowledge",
            "changes",
            "files",
            "preview",
            "terminal",
            "claude",
        ]);
    });

    it("uses the shared preview gating for mobile", () => {
        expect(
            getSessionPanelTabs({
                enablePreviewTab: false,
                knowledgeBaseEnabled: true,
            }),
        ).toEqual([
            "session",
            "knowledge",
            "changes",
            "files",
            "terminal",
            "claude",
        ]);
    });

    it("drops the knowledge tab when the project knowledge base is disabled", () => {
        expect(
            getSessionPanelTabs({
                enablePreviewTab: false,
                knowledgeBaseEnabled: false,
            }),
        ).toEqual([
            "session",
            "changes",
            "files",
            "terminal",
            "claude",
        ]);
    });
});
