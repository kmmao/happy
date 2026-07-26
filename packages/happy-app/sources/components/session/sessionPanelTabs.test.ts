import { describe, expect, it } from "vitest";

import {
    getSessionPanelTabDefinitions,
    getSessionPanelTabs,
    resolveSessionPanelActiveTab,
} from "./sessionPanelTabs";

describe("sessionPanelTabs", () => {
    it("returns session first", () => {
        const tabs = getSessionPanelTabs({ enablePreviewTab: true });

        expect(tabs[0]).toBe("session");
    });

    it("includes preview only when enabled", () => {
        expect(
            getSessionPanelTabs({ enablePreviewTab: true }),
        ).toContain("preview");
        expect(
            getSessionPanelTabs({ enablePreviewTab: false }),
        ).not.toContain("preview");
    });

    it("no longer exposes 'code' as a top-level tab", () => {
        expect(
            getSessionPanelTabs({ enablePreviewTab: true }),
        ).not.toContain("code" as never);
    });

    it("returns shared label keys for each tab", () => {
        expect(
            getSessionPanelTabDefinitions({ enablePreviewTab: true }),
        ).toEqual([
            { key: "session", labelKey: "sidePanel.session" },
            { key: "changes", labelKey: "sidePanel.changes" },
            { key: "files", labelKey: "sidePanel.files" },
            { key: "preview", labelKey: "sidePanel.preview" },
            { key: "terminal", labelKey: "sidePanel.terminal" },
            { key: "claude", labelKey: "sidePanel.claude" },
        ]);
    });

    it("falls back to the first available tab when current tab is unavailable", () => {
        expect(
            resolveSessionPanelActiveTab(
                "preview",
                getSessionPanelTabs({ enablePreviewTab: false }),
            ),
        ).toBe("session");
    });

    it("keeps current tab when still available", () => {
        expect(
            resolveSessionPanelActiveTab(
                "changes",
                getSessionPanelTabs({ enablePreviewTab: true }),
            ),
        ).toBe("changes");
    });
});
